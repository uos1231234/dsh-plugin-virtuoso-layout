#!/usr/bin/env node
/**
 * virtuoso.js — VM + Cadence Virtuoso bridge lifecycle, zero dependencies.
 *
 * This file is the SINGLE implementation. `tools/virtuoso.mjs` is a thin CLI
 * shim over `main()` below, so the CLI and the DSH plugin can never drift.
 *
 * Node builtins only, so the CLI half runs without any DSH restart.
 *
 * Every function returns a structured result instead of throwing, because the
 * caller is usually a model that needs to read *why* something failed.
 *
 * ## Two channels into the guest
 *
 *  1. **The bridge CLI** (`bridge()`, `bridgeEval()`, `bridgeScreenshot()`): the
 *     rich, structured path. Spawns `virtuoso-bridge.exe`, which owns the SSH
 *     tunnel and formats results as JSON.
 *  2. **A direct TCP call to the tunnel's local port** (`daemonCall()`): the
 *     fast health path. The bridge daemon protocol is one JSON request
 *     (`{skill, timeout}`) followed by a half-close; the response ends with the
 *     0x15 delimiter. This needs no process spawn and no SSH, which makes it the
 *     right primitive for "is the CIW alive?" — the question `virtuoso_status`
 *     and `virtuoso_recover` ask constantly.
 *
 * ## Guest command quoting (learned the hard way)
 *
 * Remote commands are passed to `ssh` as an argv tail, which the remote shell
 * concatenates and re-parses. Two characters are therefore forbidden in any
 * guest command built here:
 *
 *  - `"` — the tools-side wrapper historically stripped double quotes;
 *  - `#` — becomes a shell comment and silently swallows the rest of the line.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')

/** The Harness home, matching DSH's own resolution. */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Locate the layout root.
 *
 * Deriving it from this file's own depth is WRONG once the package is installed:
 * `plugin_manager install_bundle` COPIES the package into
 * `~/.dsh/profiles/<profile>/node_modules/dsh-plugin-virtuoso-layout`, so `../..`
 * becomes the profile's `node_modules` — which is exactly the bug this function
 * exists to prevent (a live run resolved `bridgeRepo` to
 * `~/.dsh/profiles/desktop/node_modules/virtuoso-bridge-lite`).
 *
 * Rather than guess a depth, probe the known roots and accept the first one that
 * actually contains the bridge repo, because that is what these paths are for.
 */
function resolveLayoutRoot() {
  const explicit = process.env.DSH_VIRTUOSO_LAYOUT_ROOT
  const candidates = [
    explicit,
    // In-tree: <layoutRoot>/dsh-plugin-virtuoso-layout/lib -> <layoutRoot>.
    resolve(PLUGIN_ROOT, '..'),
    // Installed into a profile: the layout root lives elsewhere on this machine.
    join(homedir(), 'Documents', 'deepseek-harness', 'default-workspace', 'virtuoso-layout'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'virtuoso-bridge-lite'))) return candidate
  }
  return explicit ?? candidates[candidates.length - 1]
}

const LAYOUT_ROOT = resolveLayoutRoot()

/**
 * Configuration defaults, derived from the machine this was built on.
 *
 * `loadConfig()` overlays `<layoutRoot>/virtuoso.config.json` so the values can
 * change without editing code; `writeUserConfig()` persists a user-owned overlay
 * that `virtuoso_config` edits live, with no DSH restart.
 */
export const DEFAULT_CONFIG = {
  /** VMware Workstation CLI; product flag is always `-T ws`. */
  vmrun: 'D:\\<VM_DIR>\\vmrun.exe',
  /** The VM definition. */
  vmx: 'D:\\<VM_DIR>\\RHEL6_ic617\\RHEL6_WORK.vmx',
  /** Guest address on the VMware NAT network (VMnet8 = 192.168.233.1). */
  guestIp: '192.168.233.128',
  /** Guest account that owns Virtuoso and the RAMIC daemon. */
  sshUser: 'work',
  /** SSH port on the guest. */
  sshPort: 22,
  /** Repo holding the bridge client and its venv. */
  bridgeRepo: join(LAYOUT_ROOT, 'virtuoso-bridge-lite'),
  /** Where screenshots and exported logs are written. */
  artifactDir: join(LAYOUT_ROOT, 'artifacts'),
  /** Local end of the SSH tunnel, forwarded to the guest's daemon port. */
  localPort: 65453,
  /** The daemon port inside the guest (`VB_REMOTE_PORT`). */
  daemonPort: 65452,
  /** Where the tunnel listens (always loopback). */
  daemonHost: '127.0.0.1',
  /** Default `screenshot` target: ciw | current | schematic | layout | maestro | <window number>. */
  screenshotTarget: 'layout',
  /** Screensaver suspend before any XTEST-driven GUI work. */
  manageScreensaver: true,
}

/** Keys `virtuoso_config` is allowed to write, i.e. the settings surface. */
export const CONFIG_KEYS = [
  'vmrun',
  'vmx',
  'guestIp',
  'sshUser',
  'sshPort',
  'bridgeRepo',
  'artifactDir',
  'localPort',
  'daemonPort',
  'daemonHost',
  'screenshotTarget',
  'manageScreensaver',
]

/** Keys whose value must be a number when written. */
const NUMERIC_KEYS = new Set(['sshPort', 'localPort', 'daemonPort'])

/**
 * Config overlay locations, first existing wins.
 *
 * A user-level file is preferred over one inside the tree because it survives
 * reinstalling the package and is where `virtuoso_config` writes.
 * `DSH_VIRTUOSO_CONFIG` overrides both.
 */
const USER_CONFIG = join(dshHome(), 'virtuoso-layout.json')
const TREE_CONFIG = join(LAYOUT_ROOT, 'virtuoso.config.json')
const CONFIG_CANDIDATES = [
  process.env.DSH_VIRTUOSO_CONFIG,
  USER_CONFIG,
  TREE_CONFIG,
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)

/** The path `virtuoso_config` writes. */
export const CONFIG_PATH = process.env.DSH_VIRTUOSO_CONFIG ?? USER_CONFIG

/** Every overlay path, most specific first — reported by `virtuoso_config show`. */
export const CONFIG_SEARCH_PATH = [...CONFIG_CANDIDATES]

/**
 * Read the first existing config overlay. A malformed overlay is reported, not
 * fatal: a broken settings file must not take the whole toolchain down.
 */
export async function loadConfig() {
  const base = { ...DEFAULT_CONFIG }
  for (const candidate of CONFIG_CANDIDATES) {
    if (!existsSync(candidate)) continue
    try {
      const raw = await readFile(candidate, 'utf8')
      return { config: { ...base, ...JSON.parse(raw) }, path: candidate, error: undefined }
    } catch (error) {
      return { config: base, path: candidate, error: String(error?.message ?? error) }
    }
  }
  return { config: base, path: CONFIG_PATH, error: undefined }
}

/**
 * Which settings differ from the built-in defaults, and where each came from.
 *
 * This is what makes the settings surface legible: a value is either inherited
 * from code or written by the user, and the answer decides whether a reset is
 * even meaningful.
 */
export async function describeConfig() {
  const loaded = await loadConfig()
  const overridden = []
  for (const key of CONFIG_KEYS) {
    const current = loaded.config[key]
    const fallback = DEFAULT_CONFIG[key]
    if (JSON.stringify(current) !== JSON.stringify(fallback)) {
      overridden.push({ key, value: current, default: fallback })
    }
  }
  return {
    /** The overlay actually in force (or the path that would be created). */
    activePath: loaded.path,
    /** Every candidate, most specific first, with existence. */
    searchPath: CONFIG_SEARCH_PATH.map((candidate) => ({ path: candidate, exists: existsSync(candidate) })),
    /** The path writes go to. */
    writablePath: CONFIG_PATH,
    /** Present only when the active overlay is malformed. */
    error: loaded.error,
    overridden,
    effective: loaded.config,
  }
}

/**
 * Merge a patch into the writable overlay.
 *
 * Unknown keys are refused rather than stored: a typo in a settings call must not
 * silently persist a value that nothing reads.
 */
export async function writeUserConfig(patch, { path = CONFIG_PATH } = {}) {
  const unknown = Object.keys(patch).filter((key) => !CONFIG_KEYS.includes(key))
  if (unknown.length > 0) {
    return { ok: false, path, error: `unknown setting(s): ${unknown.join(', ')}`, known: CONFIG_KEYS }
  }
  let current = {}
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed
    } catch {
      // A malformed overlay is replaced rather than compounded: keeping the
      // broken bytes would leave the user with an unreadable settings file.
      current = {}
    }
  }
  const next = { ...current, ...patch }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { ok: true, path, written: patch, config: next }
}

/** Coerce one settings value from its wire form, rejecting garbage. */
export function coerceConfigValue(key, value) {
  if (NUMERIC_KEYS.has(key)) {
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0 || num > 65535) {
      return { ok: false, error: `${key} must be a port number between 1 and 65535` }
    }
    return { ok: true, value: Math.trunc(num) }
  }
  if (key === 'manageScreensaver') {
    if (typeof value === 'boolean') return { ok: true, value }
    const text = String(value).trim().toLowerCase()
    if (['true', 'yes', '1', 'on'].includes(text)) return { ok: true, value: true }
    if (['false', 'no', '0', 'off'].includes(text)) return { ok: true, value: false }
    return { ok: false, error: 'manageScreensaver must be a boolean' }
  }
  const text = String(value ?? '').trim()
  if (text.length === 0) return { ok: false, error: `${key} must not be empty` }
  return { ok: true, value: text }
}

/** Drop keys from the writable overlay, returning them to the built-in default. */
export async function unsetUserConfig(keys, { path = CONFIG_PATH } = {}) {
  const unknown = keys.filter((key) => !CONFIG_KEYS.includes(key))
  if (unknown.length > 0) {
    return { ok: false, path, error: `unknown setting(s): ${unknown.join(', ')}`, known: CONFIG_KEYS }
  }
  if (!existsSync(path)) return { ok: true, path, removed: [], config: {} }
  let current = {}
  try {
    current = JSON.parse(await readFile(path, 'utf8')) ?? {}
  } catch (error) {
    return { ok: false, path, error: `cannot parse ${path}: ${String(error?.message ?? error)}` }
  }
  const removed = []
  for (const key of keys) {
    if (Object.hasOwn(current, key)) {
      delete current[key]
      removed.push(key)
    }
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
  return { ok: true, path, removed, config: current }
}

/** The bridge console script inside the repo venv. */
export function bridgeExe(config) {
  return join(config.bridgeRepo, '.venv', 'Scripts', 'virtuoso-bridge.exe')
}

/** The venv's python, used for `-m virtuoso_bridge` style invocations. */
export function bridgePython(config) {
  return join(config.bridgeRepo, '.venv', 'Scripts', 'python.exe')
}

/**
 * Run a program and capture output. Never rejects: a non-zero exit is data.
 *
 * @returns `{ ok, code, stdout, stderr, error? }` — `ok` means exit code 0.
 */
export function run(file, args, { timeoutMs = 120_000, cwd } = {}) {
  return new Promise((settle) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error?.code ?? (error ? 1 : 0)
        settle({
          ok: !error,
          code: typeof code === 'number' ? code : 1,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          ...(error && !stdout && !stderr ? { error: String(error.message) } : {}),
        })
      },
    )
  })
}

/**
 * Run a program with text written to its stdin.
 *
 * `execFile` cannot feed stdin, and the SKILL channel is stdin-based by design
 * (`eval --stdin`): shipping a multi-line SKILL program as an argv tail is what
 * produced the quoting failures this channel exists to avoid. Streams are
 * accumulated here rather than inherited so the caller keeps one result shape.
 *
 * @returns the same shape as `run()`, plus `timedOut` when the budget expired.
 */
export function runWithInput(file, args, { input = '', timeoutMs = 120_000, cwd, onStdout } = {}) {
  return new Promise((settle) => {
    let child
    try {
      child = spawn(file, args, { cwd, windowsHide: true })
    } catch (error) {
      settle({ ok: false, code: 1, stdout: '', stderr: '', error: String(error?.message ?? error) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // The child may already be gone; the timeout is still the outcome.
      }
    }, timeoutMs)
    const finish = (code, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settle({
        ok: !timedOut && code === 0,
        code: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
        ...(timedOut ? { timedOut: true } : {}),
        ...(error !== undefined ? { error } : {}),
      })
    }
    child.stdout?.on('data', (buffer) => {
      const text = buffer.toString('utf8')
      stdout += text
      if (typeof onStdout === 'function') onStdout(text)
    })
    child.stderr?.on('data', (buffer) => {
      stderr += buffer.toString('utf8')
    })
    child.once('error', (error) => finish(1, String(error?.message ?? error)))
    child.once('close', (code) => finish(code))
    // A child that exits without reading stdin raises EPIPE; that is not an error
    // worth reporting, because the child's exit code already says what happened.
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

/** `vmrun -T ws <args...>`, with the product flag always pinned to Workstation. */
export function vmrun(config, args, options) {
  return run(config.vmrun, ['-T', 'ws', ...args], options)
}

/** Which VMs are running, parsed from `vmrun list`'s header line + path list. */
export async function vmStatus(config) {
  const result = await vmrun(config, ['list'])
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const header = lines.find((line) => /^Total running VMs:/i.test(line)) ?? ''
  const running = lines.filter((line) => /\.vmx$/i.test(line))
  return {
    ok: result.ok,
    running,
    count: running.length,
    header,
    targetRunning: running.some((path) => path.toLowerCase() === config.vmx.toLowerCase()),
    code: result.code,
    ...(result.ok ? {} : { stderr: result.stderr.trim() || result.error || '' }),
  }
}

/**
 * Can we open a TCP connection to the guest's sshd?
 *
 * A TCP connect is a strictly better readiness signal than ICMP: VMware's NAT
 * can answer ping before sshd is up, and `guestReady` is only meaningful if the
 * bridge can actually SSH in.
 */
export function guestReachable(config, timeoutMs = 3000) {
  return new Promise((settle) => {
    const socket = createConnection({ host: config.guestIp, port: config.sshPort })
    const done = (ok, detail) => {
      socket.removeAllListeners()
      socket.destroy()
      settle({ ok, detail })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true, 'tcp connect ok'))
    socket.once('timeout', () => done(false, `tcp connect timed out after ${timeoutMs}ms`))
    socket.once('error', (error) => done(false, String(error.code ?? error.message)))
  })
}

/** Poll `guestReachable` until it succeeds or the budget runs out. */
export async function waitForGuest(config, { timeoutMs = 300_000, intervalMs = 5000 } = {}) {
  const startedAt = Date.now()
  const attempts = []
  while (Date.now() - startedAt < timeoutMs) {
    const probe = await guestReachable(config)
    attempts.push({ atMs: Date.now() - startedAt, ok: probe.ok, detail: probe.detail })
    if (probe.ok) return { ok: true, waitedMs: Date.now() - startedAt, attempts }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return { ok: false, waitedMs: Date.now() - startedAt, attempts }
}

/** Start the VM. `gui` shows the VMware console; the guest desktop still boots either way. */
export async function vmStart(config, { gui = false, timeoutMs = 300_000 } = {}) {
  if (!existsSync(config.vmrun)) return { ok: false, error: `vmrun not found at ${config.vmrun}` }
  if (!existsSync(config.vmx)) return { ok: false, error: `vmx not found at ${config.vmx}` }
  const result = await vmrun(config, ['start', config.vmx, gui ? 'gui' : 'nogui'], { timeoutMs })
  return { ok: result.ok, code: result.code, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

/** Stop the VM. `hard` is the equivalent of pulling the power; prefer soft. */
export async function vmStop(config, { hard = false, timeoutMs = 180_000 } = {}) {
  const args = hard ? ['stop', config.vmx, 'hard'] : ['stop', config.vmx, 'soft']
  const result = await vmrun(config, args, { timeoutMs })
  return { ok: result.ok, code: result.code, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

/**
 * The argv for one guest command.
 *
 * `-o BatchMode=yes` makes a missing key an immediate error instead of a password
 * prompt that would hang a non-interactive caller.
 */
export function sshArgs(config, remoteCommand) {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `ConnectTimeout=10`,
    '-p', String(config.sshPort),
    `${config.sshUser}@${config.guestIp}`,
    remoteCommand,
  ]
}

/** Run one command inside the guest over SSH and collect its output. */
export async function ssh(config, remoteCommand, { timeoutMs = 120_000 } = {}) {
  const result = await run('ssh', sshArgs(config, remoteCommand), { timeoutMs })
  return { ok: result.ok, code: result.code, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

/**
 * Start one guest command and stream its output to callbacks.
 *
 * A long task cannot use `ssh()`: buffering means silence until the process ends,
 * so a five-minute DRC would show nothing for five minutes and could not be
 * stopped. This returns a live handle whose `done` promise settles with the same
 * shape `ssh()` produces, plus the accumulated text.
 *
 * @returns `{ pid, kill, done }` where `done` resolves (never rejects).
 */
export function spawnSsh(config, remoteCommand, { onStdout, onStderr, timeoutMs = 3_600_000 } = {}) {
  const child = spawn('ssh', sshArgs(config, remoteCommand), { windowsHide: true })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      child.kill()
    } catch {
      // Already gone; the timeout still describes the outcome.
    }
  }, timeoutMs)
  const done = new Promise((settle) => {
    child.stdout?.on('data', (buffer) => {
      const text = buffer.toString('utf8')
      stdout += text
      if (typeof onStdout === 'function') onStdout(text)
    })
    child.stderr?.on('data', (buffer) => {
      const text = buffer.toString('utf8')
      stderr += text
      if (typeof onStderr === 'function') onStderr(text)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      settle({ ok: false, code: 1, stdout, stderr, error: String(error?.message ?? error) })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      settle({
        ok: !timedOut && code === 0,
        code: typeof code === 'number' ? code : 1,
        stdout,
        stderr,
        ...(timedOut ? { timedOut: true } : {}),
      })
    })
  })
  return {
    pid: child.pid,
    kill: () => {
      try {
        child.kill()
      } catch {
        // Nothing to kill.
      }
    },
    done,
  }
}

/**
 * The settled payload for a **streamed** guest command.
 *
 * It deliberately carries no stdout. `spawnSsh` hands every chunk to
 * `onStdout`/`onStderr` as it arrives, and the job appends them, so the job
 * already owns the text. Adding `result: clip(result.stdout)` on top made a
 * finished job print its output a *second* time — found live, where
 * `echo OUT-ONLY; echo ERR-ONLY 1>&2` came back as `OUT-ONLY`, `[stderr]
 * ERR-ONLY`, `OUT-ONLY`. What the reading side genuinely cannot derive from the
 * bytes is why the process ended, so that is all this returns.
 *
 * @param {{ok?: boolean, code?: number, timedOut?: boolean, error?: string}} result
 *   the settled value of `spawnSsh(...).done`
 */
export function jobOutcome(result, timeoutMs = 3_600_000) {
  if (result?.timedOut) return { status: 'killed', detail: `exceeded ${timeoutMs}ms` }
  if (result?.ok) return { status: 'completed', detail: `ssh exited ${result.code ?? 0}` }
  // A spawn failure never reached a shell, so "ssh exited 1" would be a fiction.
  if (result?.error) return { status: 'failed', detail: `ssh could not start: ${result.error}` }
  return { status: 'failed', detail: `ssh exited ${result?.code ?? '?'}` }
}

/** Is a Virtuoso process alive in the guest? */
export async function virtuosoRunning(config) {
  const probe = await ssh(config, "pgrep -f virtuoso | head -5 || true")
  const pids = probe.stdout.split(/\s+/).filter(Boolean)
  return { ok: probe.ok, running: pids.length > 0, pids, stderr: probe.stderr }
}

/* ── The GUI-input trap ──────────────────────────────────────────────────────
 *
 * The bridge dismisses dialogs with XTEST, which delivers keys to whatever holds
 * the X input focus. A *locked or active screensaver* holds that focus, so every
 * `dismiss-*` call still prints "Dismissed: 0x..." — it reports the window it
 * targeted, not the window that received the keys. The modal then stays up,
 * blocks the CIW, and every later SKILL call degenerates into
 * `Socket timeout after 60s`. Suspending the screensaver before any XTEST work is
 * therefore not cosmetic; it is what makes dialog dismissal truthful.
 */

/**
 * Suspend the guest screensaver and the X blanking timers.
 *
 * Deliberately quote-free and comment-free: see the module header.
 */
export const GUEST_PREP_COMMAND =
  'export DISPLAY=:0; gnome-screensaver-command -d; xset s off; xset -dpms; gnome-screensaver-command -q'

/**
 * Suspend the screensaver, reporting what the guest said about it.
 *
 * `active` stays `undefined` when the guest has no gnome-screensaver at all, so a
 * different desktop environment is reported as unknown rather than as healthy.
 */
export async function guestPrep(config, { timeoutMs = 30_000 } = {}) {
  if (config.manageScreensaver === false) {
    return { ok: true, skipped: true, detail: 'manageScreensaver is false' }
  }
  const result = await ssh(config, GUEST_PREP_COMMAND, { timeoutMs })
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase()
  const inactive = text.includes('is inactive') || text.includes('not active')
  const active = text.includes('is active') ? true : inactive ? false : undefined
  return {
    ok: result.ok && active !== true,
    command: GUEST_PREP_COMMAND,
    stdout: result.stdout,
    stderr: result.stderr,
    screensaverActive: active,
    detail:
      active === true
        ? 'the screensaver still reports active; XTEST dialog dismissal cannot be trusted'
        : active === false
          ? 'screensaver inactive'
          : 'screensaver state unknown (no gnome-screensaver output)',
  }
}

/* ── Direct daemon channel ───────────────────────────────────────────────── */

/**
 * One request to the bridge daemon over the tunnel's local port.
 *
 * The daemon is single-threaded and reads until EOF, so the request MUST be
 * half-closed after the JSON — `socket.end()` sends exactly that FIN. Omitting it
 * leaves the daemon blocked in `recv`, and because its accept loop is sequential
 * every later connection is silently dropped. That single missing half-close is
 * the difference between a working bridge and a bridge that looks dead.
 */
export function daemonCall(config, skill, { timeoutSec = 6, host, port } = {}) {
  return new Promise((settle) => {
    const target = { host: host ?? config.daemonHost ?? '127.0.0.1', port: port ?? config.localPort }
    let socket
    try {
      socket = createConnection(target)
    } catch (error) {
      settle({ ok: false, raw: '', detail: String(error?.message ?? error) })
      return
    }
    const chunks = []
    let settled = false
    const startedAt = Date.now()
    // The daemon's own watchdog is `timeoutSec`; the extra budget covers the X11
    // round trip and the return trip through the tunnel.
    const budget = Math.max(4000, (timeoutSec + 5) * 1000)
    const timer = setTimeout(
      () => finish({ ok: false, raw: chunks.join(''), detail: `no response within ${budget}ms` }),
      budget,
    )
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      settle({ elapsedMs: Date.now() - startedAt, ...result })
    }
    socket.setNoDelay(true)
    socket.once('connect', () => {
      socket.write(JSON.stringify({ skill, timeout: timeoutSec }))
      socket.end()
    })
    socket.on('data', (buffer) => {
      chunks.push(buffer.toString('utf8'))
      const text = chunks.join('')
      if (text.includes('\u0015')) {
        finish({
          ok: !text.includes('TimeoutError'),
          raw: text,
          complete: true,
          detail: text.includes('TimeoutError') ? 'the daemon reported a timeout' : 'delimiter received',
        })
      }
    })
    socket.once('timeout', () => finish({ ok: false, raw: chunks.join(''), detail: 'socket timeout' }))
    socket.once('error', (error) =>
      finish({ ok: false, raw: chunks.join(''), detail: String(error?.code ?? error?.message ?? error) }),
    )
    // An observed response is a complete response. This daemon answers `1+1` with
    // a single STX-prefixed byte (`\x02` + `2`) and then closes WITHOUT the 0x15
    // delimiter, so treating "closed with bytes in hand" as a failure would throw
    // away a perfectly good answer. Only a close with zero bytes is a failure.
    socket.once('close', () => {
      const text = chunks.join('')
      if (text.length === 0) {
        finish({ ok: false, raw: '', detail: 'closed without any response' })
        return
      }
      finish({
        ok: !text.includes('TimeoutError'),
        raw: text,
        complete: true,
        detail: text.includes('TimeoutError') ? 'the daemon reported a timeout' : 'response completed by connection close',
      })
    })
  })
}

/**
 * Is the CIW answering SKILL?
 *
 * `1+1` is the cheapest evaluation that proves the whole chain
 * (tunnel -> daemon -> Virtuoso evaluator -> response) is live.
 *
 * Two channels, in this order, for a reason the implementation makes easy to get
 * wrong: **the bridge opens its SSH tunnel per CLI invocation and tears it down on
 * exit** — there is no persistent listener on `localPort` between commands. So
 * `ECONNREFUSED` on the direct socket means "no tunnel is open at this instant",
 * NOT "Virtuoso is down". Reporting it as a failure would make this probe cry wolf
 * every time it runs on an idle host, which is precisely when it is called. The
 * CLI fallback warms the tunnel itself and then proves real SKILL evaluation.
 */
export async function healthCheck(config, { timeoutSec = 6, viaSocketOnly = false } = {}) {
  const endpoint = `${config.daemonHost ?? '127.0.0.1'}:${config.localPort}`
  const socket = await daemonCall(config, '1+1', { timeoutSec })
  // Control bytes are framing, not payload: the daemon prefixes its answer with
  // STX, and a framing-aware match would break on the next protocol revision.
  const payload = socket.raw.replace(/[\u0000-\u001f]/g, '')
  if (socket.ok && /(^|[^0-9])2([^0-9]|$)/.test(payload)) {
    return {
      ok: true,
      via: 'socket',
      endpoint,
      detail: `CIW answered 1+1 = 2 directly over the tunnel in ${socket.elapsedMs ?? '?'}ms`,
      elapsedMs: socket.elapsedMs,
      raw: truncate(socket.raw, 200),
    }
  }
  if (viaSocketOnly) {
    return { ok: false, via: 'socket', endpoint, detail: socket.detail, raw: truncate(socket.raw, 400) }
  }
  const cli = await bridgeEval(config, '1+1', { timeoutSec })
  const answered = cli.status === 'success' && String(cli.output ?? '').trim() === '2'
  return {
    ok: answered,
    via: 'cli',
    endpoint,
    detail: answered
      ? 'CIW answered 1+1 = 2 over the bridge CLI (tunnel opened per invocation)'
      : `no answer: socket said ${socket.detail}; CLI status ${cli.status ?? 'unknown'}`,
    socketDetail: socket.detail,
    cliStatus: cli.status,
    elapsedMs: cli.elapsedMs,
    raw: truncate(socket.raw, 200),
  }
}

/**
 * Recursively drop values that are not lossless JSON.
 *
 * The harness validates a Tool's resolved value and rejects it with
 * `value is not lossless JSON`, which fails the whole *call*. An object property
 * explicitly set to `undefined` is enough to trigger it: `{ ok: true, parseError:
 * undefined }` is rejected even though `JSON.stringify` would have dropped the
 * key. Every tool therefore returns through this function, instead of relying on
 * each call site to remember which of its fields may be absent.
 *
 * Non-finite numbers become null, bigints become strings, and a cycle is marked
 * rather than recursed into forever. Array holes become null so indices keep
 * their meaning.
 */
export function jsonSafe(value, seen = new WeakSet()) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type === 'bigint') return String(value)
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined
  if (Array.isArray(value)) {
    return value.map((item) => {
      const safe = jsonSafe(item, seen)
      return safe === undefined ? null : safe
    })
  }
  if (type === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const safe = jsonSafe(item, seen)
      if (safe !== undefined) out[key] = safe
    }
    seen.delete(value)
    return out
  }
  return String(value)
}

/** Bound a string for a JSON tool result. */
function truncate(text, limit) {
  const value = String(text ?? '')
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

/**
 * Remove the bridge CLI's human-facing chatter from captured stdout.
 *
 * The CLI writes `using .env: …` and its `[cmd] …` spawn traces to **stdout**,
 * ahead of the JSON a caller actually wants. Parsing the raw stream therefore
 * fails with `Unexpected token 'u', "using .env"` — which reads like a broken
 * bridge rather than a parsing mistake, so it is worth naming here.
 */
export function stripBridgeTrace(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^using \.env:/.test(line) &&
        !/^\[cmd\]/.test(line) &&
        !/^tunnel\.warm/.test(line) &&
        !/^starting tunnel/i.test(line),
    )
    .join('\n')
    .trim()
}

/** Parse JSON out of CLI output, tolerating trace lines and surrounding prose. */
export function parseBridgeJson(text) {
  const cleaned = stripBridgeTrace(text)
  try {
    return { ok: true, value: JSON.parse(cleaned) }
  } catch (first) {
    // Last resort: the document is the outermost braces/brackets in the output.
    for (const [open, close] of [
      ['{', '}'],
      ['[', ']'],
    ]) {
      const start = cleaned.indexOf(open)
      const end = cleaned.lastIndexOf(close)
      if (start === -1 || end <= start) continue
      try {
        return { ok: true, value: JSON.parse(cleaned.slice(start, end + 1)) }
      } catch {
        // Try the next bracket pair.
      }
    }
    return { ok: false, error: String(first?.message ?? first) }
  }
}

/* ── Failure diagnosis ───────────────────────────────────────────────────── */

/**
 * The next concrete action for a raw failure string.
 *
 * Every signature below was observed on this machine, and each has exactly one
 * sensible response. Naming it at the failure site keeps the operational
 * knowledge inside the tool result instead of in a document the caller is not
 * reading while it is stuck.
 */
export function hintFor(text) {
  const t = String(text ?? '')
  if (t.length === 0) return ''
  if (/ECONNREFUSED/i.test(t)) {
    return (
      'The bridge tunnel is not listening on its local port. The tunnel is created per bridge ' +
      'invocation and torn down on exit, so a refused connection means "no tunnel right now", NOT ' +
      '"Virtuoso is down". Call virtuoso_status (it reports all four layers separately), then ' +
      'virtuoso_vm action "up" to repair it in one call.'
    )
  }
  if (/socket timeout|socket said|timed ?out/i.test(t)) {
    return (
      'The CIW stopped answering. Most often a modal dialog holds the X input focus: call ' +
      'virtuoso_recover, which suspends the screensaver BEFORE dismissing dialogs (dismissing while ' +
      'a screensaver is active reports success and silently does nothing), then re-check with ' +
      'virtuoso_status.'
    )
  }
  if (/error while loading file/i.test(t)) {
    return (
      'SKILL failed while loading the program. The reported line number is the END of the wrapper, ' +
      'not the failing line, so it does NOT locate the fault: treat this as a RUNTIME error, not a ' +
      'syntax error. The usual causes are an undefined function or variable, or `if(...)` used as a ' +
      'function argument (it swallows the closing paren of the argument list). Bisect by sending ' +
      'each statement alone, and rule parens out with `node .validate/paren-check.mjs <file.il>`.'
    )
  }
  if (/ENOENT|no such file or directory|cannot find the file|cannot find the path/i.test(t)) {
    return (
      'The path does not exist on the machine that read it. Check which side of the VM boundary it ' +
      'lives on: host paths are Windows (C:\\...), guest paths are POSIX (<GUEST_HOME>/...). A file ' +
      'created inside the guest is not visible to the host and vice versa.'
    )
  }
  if (/permission denied.*(publickey|password)|host key verification failed/i.test(t)) {
    return (
      'SSH authentication to the guest failed. Confirm the guest address and credentials with ' +
      'virtuoso_config action "show", and that the guest is up with virtuoso_status.'
    )
  }
  if (/not lossless JSON/i.test(t)) {
    return (
      'The tool produced a value the harness cannot serialise — one undefined-valued property is ' +
      'enough. This is a bug in the plugin rather than in the request; report the tool name.'
    )
  }
  return ''
}

/** Append a recognised hint to a failure message, so it survives an exception. */
export function withHint(message) {
  const hint = hintFor(message)
  return hint.length === 0 ? String(message) : `${String(message)}\nHint: ${hint}`
}

/**
 * Classify a failed bridge eval result.
 *
 * The bridge reports a SKILL failure as `("load" 0 t nil ("*Error* ..."))` — an
 * errset-shaped list whose first element is nil on failure. Unwrapping it turns
 * an opaque payload into a kind, the one human-readable line inside it, and an
 * actionable hint.
 */
export function diagnoseEvalResult(result) {
  const errors = Array.isArray(result?.errors) ? result.errors.map((entry) => String(entry)) : []
  const joined = errors.join(' ')
  const out = {}
  const errorText = joined.match(/\*Error\*[^)]*/)
  // The payload ends `at line 5"))`, so strip the quote the match dragged along.
  if (errorText) out.errorText = errorText[0].replace(/["\\\s]+$/, '').trim()
  if (result?.timedOut === true) {
    out.errorKind = 'timeout'
    out.hint = hintFor('socket timeout')
  } else if (/error while loading file/i.test(joined)) {
    out.errorKind = 'skill-load'
    out.hint = hintFor('error while loading file')
  } else if (errors.length > 0) {
    out.errorKind = 'skill'
    out.hint = hintFor(joined)
  } else if (result?.ok !== true) {
    out.errorKind = 'unknown'
    out.hint =
      'The bridge CLI failed without an error payload. Re-run the reported `command` by hand ' +
      '(tools/virtuoso.mjs) to see its stderr.'
  }
  return out
}

/* ── The bridge CLI ──────────────────────────────────────────────────────── */

/**
 * Run the bridge CLI.
 *
 * The bridge resolves its `.env` by walking up from the CWD, so the repo
 * directory is passed as `cwd` rather than relying on `~/.virtuoso-bridge/.env`
 * alone.
 */
export async function bridge(config, args, { timeoutMs = 180_000, input } = {}) {
  const exe = bridgeExe(config)
  if (!existsSync(exe)) return { ok: false, error: `bridge CLI not found at ${exe}` }
  const options = { timeoutMs, cwd: config.bridgeRepo }
  const result =
    input === undefined
      ? await run(exe, args, options)
      : await runWithInput(exe, args, { ...options, input })
  return { ok: result.ok, code: result.code, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

/** `virtuoso-bridge status` — the bridge's own health report. */
export const bridgeStatus = (config, options) => bridge(config, ['status'], options)

/**
 * Is the host-side tunnel listening?
 *
 * Readiness has FOUR layers, and this one is the layer that fails without
 * announcing itself. Observed live: the VM was running, sshd answered, Virtuoso
 * held five live pids, the guest daemon was listening on `0.0.0.0:65452` — and
 * every SKILL call still failed with `Connection refused to 127.0.0.1:65453`,
 * because `virtuoso-bridge start`'s `ssh -N -L` forward was simply not running.
 * Nothing in the *guest* can reveal this, so it needs its own probe.
 */
export function tunnelUp(config, timeoutMs = 1500) {
  return new Promise((settle) => {
    const port = config.localPort
    const socket = createConnection({ host: config.daemonHost ?? '127.0.0.1', port })
    const startedAt = Date.now()
    const done = (ok, detail) => {
      socket.removeAllListeners()
      socket.destroy()
      settle({ ok, detail, port, elapsedMs: Date.now() - startedAt })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true, `tunnel listening on 127.0.0.1:${port}`))
    socket.once('timeout', () => done(false, `nothing listening on 127.0.0.1:${port} (timed out after ${timeoutMs}ms)`))
    socket.once('error', (error) => done(false, `${String(error.code ?? error.message)} on 127.0.0.1:${port}`))
  })
}

/**
 * `virtuoso-bridge start` — deploy the daemon setup and open the SSH tunnel.
 *
 * This is the repair for the missing-tunnel layer, and it is safe to run when a
 * tunnel already exists (the bridge reuses its ControlMaster connection).
 */
export const bridgeStart = (config, { timeoutMs = 180_000 } = {}) => bridge(config, ['start'], { timeoutMs })

/** Close the SSH tunnel, leaving the VM and Virtuoso running. */
export const bridgeStop = (config, { timeoutMs = 60_000 } = {}) => bridge(config, ['stop'], { timeoutMs })

/**
 * Ensure the tunnel is up, starting it when it is not.
 *
 * Returns both halves of the story — what was observed before, and what the start
 * attempt produced — because "it is up now" and "I started it" are different
 * facts, and only the second explains a change in behaviour.
 */
export async function ensureTunnel(config, { timeoutMs = 180_000 } = {}) {
  const before = await tunnelUp(config)
  if (before.ok) return { ok: true, started: false, detail: 'tunnel already up', before }
  const started = await bridgeStart(config, { timeoutMs })
  const after = await tunnelUp(config)
  return {
    ok: after.ok,
    started: true,
    detail: after.ok ? 'tunnel was down and is now up' : `tunnel still down after start: ${after.detail}`,
    before,
    after,
    startOk: started.ok,
    startTail: truncate(started.stdout.split(/\r?\n/).filter(Boolean).slice(-4).join(' | '), 400),
    stderr: truncate(started.stderr, 300),
  }
}

/**
 * Evaluate SKILL over the bridge CLI's stdin channel.
 *
 * `eval --stdin` wraps the program in `progn(...)` and returns the last form as
 * JSON. This is the only channel that survives arbitrary SKILL: an inline argv
 * expression is re-quoted by the host shell and split by the CRT's argv parser,
 * which is what produced `unrecognized arguments:` failures.
 */
export async function bridgeEval(config, skill, { timeoutSec = 60 } = {}) {
  const startedAt = Date.now()
  const result = await bridge(config, ['eval', '--stdin', '--timeout', String(timeoutSec)], {
    input: skill,
    timeoutMs: (timeoutSec + 30) * 1000,
  })
  const elapsedMs = Date.now() - startedAt
  const decoded = parseBridgeJson(result.stdout)
  const parsed = decoded.ok === true ? decoded.value : undefined
  const parseError = decoded.ok === true ? undefined : decoded.error
  return {
    ok: result.ok && parsed?.status === 'success',
    elapsedMs,
    status: parsed?.status,
    output: parsed?.output,
    errors: parsed?.errors,
    warnings: parsed?.warnings,
    executionMs: parsed?.execution_time,
    parseError: parsed === undefined ? parseError : undefined,
    stdout: parsed === undefined ? truncate(result.stdout, 2000) : undefined,
    stderr: result.stderr === '' ? undefined : truncate(result.stderr, 1000),
    timedOut: result.timedOut === true,
    command: `virtuoso-bridge eval --stdin --timeout ${timeoutSec}`,
  }
}

/**
 * List the guest's Virtuoso X11 windows.
 *
 * The CLI writes a `[cmd] ...` trace to stderr, so stdout is scanned for the JSON
 * array rather than parsed wholesale.
 */
export async function listWindows(config, { topLevel = true, timeoutMs = 60_000 } = {}) {
  const args = ['list-windows', '--json']
  if (topLevel) args.push('--top-level')
  const result = await bridge(config, args, { timeoutMs })
  const decoded = parseBridgeJson(result.stdout)
  if (decoded.ok !== true) {
    return {
      ok: false,
      windows: [],
      detail: `no JSON window list in output: ${truncate(result.stdout, 300)}`,
      parseError: decoded.error,
      stderr: result.stderr,
    }
  }
  const windows = decoded.value
  return { ok: true, windows, count: Array.isArray(windows) ? windows.length : 0 }
}

/**
 * The SKILL window list.
 *
 * Authoritative, unlike the X11 list: it asks Virtuoso itself, so titles read
 * `Virtuoso® Layout Suite L Editing: LIB CELL layout`. The X11 list is only good
 * for window ids in this guest, because there is no window manager publishing
 * `WM_NAME` and the titles come back as fragments such as `": ("`.
 */
export async function skillWindows(config, { timeoutMs = 60_000 } = {}) {
  const result = await bridge(config, ['windows'], { timeoutMs })
  const titles = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\s+/.test(line))
  return { ok: result.ok, titles, count: titles.length, raw: result.stdout }
}

/** Dismiss one explicit X11 window id. `enter` accepts, `escape` cancels. */
export async function dismissWindow(config, windowId, action = 'enter', { timeoutMs = 60_000 } = {}) {
  const result = await bridge(config, ['dismiss-window', String(windowId), '--action', action], { timeoutMs })
  return {
    ok: result.ok,
    windowId: String(windowId),
    action,
    stdout: truncate(result.stdout, 400),
    stderr: truncate(result.stderr, 300),
  }
}

/** Find and dismiss whatever modal is blocking the CIW. */
export async function dismissDialog(config, { timeoutMs = 60_000 } = {}) {
  const result = await bridge(config, ['dismiss-dialog'], { timeoutMs })
  return {
    ok: result.ok,
    stdout: truncate(result.stdout, 400),
    stderr: truncate(result.stderr, 300),
  }
}

/**
 * Put the guest GUI back into a usable state, then prove it with a real
 * evaluation.
 *
 * The order matters and is the whole lesson of the screensaver incident:
 *   1. suspend the screensaver, otherwise every dismissal below is a no-op that
 *      still reports success;
 *   2. probe the CIW — a healthy CIW needs no dismissal at all, and blindly
 *      sending keys to a healthy desktop can activate things;
 *   3. dismiss the blocking dialog, then verify again;
 *   4. fall back to explicit per-window dismissal (enter, then escape) because
 *      the dialog sweep matches by title and a non-standard modal is invisible
 *      to it.
 */
export async function recoverGuest(config, { attempts = 2, timeoutSec = 6 } = {}) {
  const steps = []
  const prep = await guestPrep(config)
  steps.push({ step: 'screensaver-off', ok: prep.ok, detail: prep.detail, screensaverActive: prep.screensaverActive })

  let health = await healthCheck(config, { timeoutSec })
  steps.push({ step: 'health', ok: health.ok, detail: health.detail })
  if (health.ok) return { ok: true, recovered: false, steps, health }

  for (let attempt = 1; attempt <= attempts && !health.ok; attempt += 1) {
    const dismissed = await dismissDialog(config)
    steps.push({ step: `dismiss-dialog-${attempt}`, ok: dismissed.ok, detail: truncate(dismissed.stdout, 200) })
    health = await healthCheck(config, { timeoutSec })
    steps.push({ step: `health-after-dialog-${attempt}`, ok: health.ok, detail: health.detail })
  }

  if (!health.ok) {
    const listed = await listWindows(config)
    steps.push({ step: 'list-windows', ok: listed.ok, count: listed.count ?? 0, detail: listed.detail })
    for (const action of ['enter', 'escape']) {
      if (health.ok) break
      for (const entry of Array.isArray(listed.windows) ? listed.windows : []) {
        const id = entry?.windowId ?? entry?.window_id ?? entry?.id ?? entry?.wid
        if (id === undefined || id === null) continue
        const dismissed = await dismissWindow(config, id, action)
        steps.push({ step: `dismiss-window-${action}`, windowId: String(id), ok: dismissed.ok })
        health = await healthCheck(config, { timeoutSec })
        steps.push({ step: 'health', ok: health.ok, detail: health.detail })
        if (health.ok) break
      }
    }
  }
  return { ok: health.ok, recovered: health.ok, steps, health }
}

/**
 * Screenshot a Virtuoso window and copy it back to the host.
 *
 * `target` is `ciw`, `current`, a view name (`layout`, `schematic`, `maestro`) or
 * a window number. The CLI prints the final host path on stdout, and that path is
 * preferred over the requested one because the CLI may relocate the file.
 */
export async function bridgeScreenshot(config, target, { output, timeoutMs = 120_000 } = {}) {
  const chosen = target ?? config.screenshotTarget ?? 'ciw'
  const outDir = config.artifactDir
  await mkdir(outDir, { recursive: true })
  const requested = output ?? join(outDir, `${String(chosen).replace(/[^A-Za-z0-9_-]/g, '_')}-${stamp()}.png`)
  const result = await bridge(config, ['screenshot', String(chosen), '-o', requested], { timeoutMs })
  const reported = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\.png$/i.test(line))
    .pop()
  const path = reported !== undefined && existsSync(reported) ? reported : requested
  const exists = existsSync(path)
  return {
    ok: result.ok && exists,
    target: String(chosen),
    path,
    exists,
    bytes: exists ? (await stat(path)).size : undefined,
    hint: exists ? 'Read this PNG with the read_image tool to see the layout.' : undefined,
    stdout: truncate(result.stdout, 500),
    stderr: truncate(result.stderr, 300),
  }
}

/** A filesystem-safe local timestamp for artifact names. */
function stamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

export { stamp }

/** Take a desktop screenshot inside the guest and copy it back. */
export async function screenshot(config, { name = `layout-${stamp()}.png`, target } = {}) {
  return bridgeScreenshot(config, target ?? config.screenshotTarget ?? 'ciw', {
    output: join(config.artifactDir, name),
  })
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

async function main(argv) {
  const { config, path, error } = await loadConfig()
  if (error) console.error(`[config] ignoring malformed ${path}: ${error}`)
  const [command, ...rest] = argv
  const emit = (value) => console.log(JSON.stringify(value, null, 2))

  switch (command) {
    case 'config': {
      emit({ config, configPath: path, bridgeExe: bridgeExe(config) })
      return 0
    }
    case 'config-show': {
      emit(await describeConfig())
      return 0
    }
    case 'config-set': {
      // `config-set key=value [key=value ...]`
      const patch = {}
      for (const pair of rest) {
        const at = pair.indexOf('=')
        if (at <= 0) {
          console.error(`usage: config-set key=value, got "${pair}"`)
          return 1
        }
        const key = pair.slice(0, at)
        const coerced = coerceConfigValue(key, pair.slice(at + 1))
        if (coerced.ok !== true) {
          console.error(String(coerced.error))
          return 1
        }
        patch[key] = coerced.value
      }
      const written = await writeUserConfig(patch)
      emit(written)
      return written.ok === true ? 0 : 1
    }
    case 'config-unset': {
      emit(await unsetUserConfig(rest))
      return 0
    }
    case 'vm-status': {
      emit(await vmStatus(config))
      return 0
    }
    case 'vm-start': {
      emit(await vmStart(config, { gui: rest.includes('--gui') }))
      return 0
    }
    case 'vm-stop': {
      emit(await vmStop(config, { hard: rest.includes('--hard') }))
      return 0
    }
    case 'guest-ready': {
      const budget = Number(rest[0] ?? 5000)
      emit(budget > 6000 ? await waitForGuest(config, { timeoutMs: budget }) : await guestReachable(config, budget))
      return 0
    }
    case 'prep': {
      emit(await guestPrep(config))
      return 0
    }
    case 'health': {
      emit(await healthCheck(config, { timeoutSec: Number(rest[0] ?? 6) }))
      return 0
    }
    case 'recover': {
      const result = await recoverGuest(config, { attempts: Number(rest[0] ?? 2) })
      emit(result)
      return result.ok === true ? 0 : 1
    }
    case 'ssh': {
      emit(await ssh(config, rest.join(' ')))
      return 0
    }
    case 'virtuoso-running': {
      emit(await virtuosoRunning(config))
      return 0
    }
    case 'bridge-status': {
      emit(await bridgeStatus(config))
      return 0
    }
    case 'tunnel': {
      emit(await tunnelUp(config))
      return 0
    }
    case 'ensure-tunnel': {
      emit(await ensureTunnel(config))
      return 0
    }
    case 'bridge-start': {
      emit(await bridgeStart(config))
      return 0
    }
    case 'bridge-stop': {
      emit(await bridgeStop(config))
      return 0
    }
    case 'sk-windows': {
      // The SKILL-based list. Unlike the X11 list it reports real window titles,
      // which is what makes it possible to tell a dialog from an editor.
      const result = await bridge(config, ['windows'])
      emit({ ok: result.ok, stdout: truncate(result.stdout, 2000) })
      return 0
    }
    case 'windows': {
      emit(await listWindows(config))
      return 0
    }
    case 'screenshot': {
      emit(await bridgeScreenshot(config, rest[0] ?? config.screenshotTarget))
      return 0
    }
    case 'eval': {
      // Prefer `eval --file <path>`. An argv expression only survives when the
      // caller's shell does not re-quote it, and Windows PowerShell 5.1 strips
      // embedded `"` while building a native command line — which silently turns
      // `ddGetObj("VB_DEMO")` into `ddGetObj(VB_DEMO)` and makes the guest report
      // the mangled program back as a string. A file never passes through argv:
      // the program is read here and sent over the bridge's stdin channel.
      const fileIndex = rest.indexOf('--file')
      let skill
      if (fileIndex !== -1) {
        const path = rest[fileIndex + 1]
        if (path === undefined) {
          emit({ ok: false, error: 'eval --file needs a path to a .il file' })
          return 1
        }
        skill = await readFile(path, 'utf8')
      } else {
        skill = rest.join(' ')
      }
      emit(await bridgeEval(config, skill, { timeoutSec: 30 }))
      return 0
    }
    default: {
      console.log(
        'usage: node tools/virtuoso.mjs <config|config-show|config-set|config-unset|vm-status|' +
          'vm-start|vm-stop|guest-ready|prep|health|recover|ssh|virtuoso-running|bridge-status|' +
          'windows|screenshot|eval <skill>|eval --file <path.il>>',
      )
      return 1
    }
  }
}

export { main }

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
