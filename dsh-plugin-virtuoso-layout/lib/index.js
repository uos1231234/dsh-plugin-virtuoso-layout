/**
 * dsh-plugin-virtuoso-layout — host half.
 *
 * Tools:
 *
 *  - `workspace_create`   — the only model-reachable way to register a workspace.
 *  - `virtuoso_status`    — layered readiness (VM / sshd / tunnel / CIW / windows).
 *  - `virtuoso_config`    — the persisted settings surface, applied live.
 *  - `virtuoso_vm`        — VM + toolchain lifecycle, including the tunnel.
 *  - `virtuoso_recover`   — repair the guest GUI and prove it with a real eval.
 *  - `virtuoso_windows`   — what is open, with real titles.
 *  - `virtuoso_screenshot`— capture a window to a PNG the model can look at.
 *  - `host_window`        — enumerate / raise / capture Windows desktop windows.
 *  - `virtuoso_eval`      — run SKILL over the stdin channel.
 *  - `virtuoso_run`       — a long guest command as a background job.
 *  - `virtuoso_drc`       — structure Calibre DRC output into JSON.
 *
 * Dependency stance: **no external imports**. Everything below is either a Node
 * builtin reached through `./virtuoso.js` or a relative import of this package,
 * which keeps the plugin installable despite the live runtime (0.2.0-rc.2)
 * disagreeing with every published `@deepseek-ai/*` package (0.1.2-rc.1) on peer
 * versions. A tool definition is plain data plus a function — exactly the
 * `ToolDefinition` contract — so `defineTool` is a convenience, not a requirement.
 *
 * Registration is defensive: each tool registers inside its own try/catch, so one
 * bad definition degrades that tool instead of failing the whole row.
 */

import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { parseFile } from './drc.js'
import { installWriteGuard, permissionMode } from './guard.js'
import { captureHostWindow, hostWindowsSupported, listHostWindows, raiseHostWindow } from './host.js'
import {
  CONFIG_KEYS,
  bridgeEval,
  bridgeScreenshot,
  coerceConfigValue,
  describeConfig,
  diagnoseEvalResult,
  dismissDialog,
  dismissWindow,
  ensureTunnel,
  guestPrep,
  guestReachable,
  healthCheck,
  jobOutcome,
  jsonSafe,
  listWindows,
  loadConfig,
  recoverGuest,
  skillWindows,
  spawnSsh,
  ssh,
  tunnelUp,
  unsetUserConfig,
  vmStart,
  vmStatus,
  vmStop,
  virtuosoRunning,
  waitForGuest,
  withHint,
  writeUserConfig,
} from './virtuoso.js'

export const name = 'virtuoso-layout'

// Hard dependencies. `tools` is the registry every model-facing tool needs;
// `workspaceRegistry` is the host-only entity registry this plugin exposes.
// `jobs` is deliberately NOT here: it is read with `ctx.get('jobs')` so a
// composition without it still gets every other tool.
export const inject = ['tools', 'workspaceRegistry']

/** How many tools this half registers. Reported so a partial load is visible. */
const TOTAL_TOOLS = 12

/**
 * What the write gate reported when it registered. Module scope because
 * `virtuoso_status` is the only model-visible surface that can answer "is the gate
 * armed, and would it fire in this session?" — a gate nobody can observe is
 * indistinguishable from no gate at all.
 */
let writeGuard = { installed: false, detail: 'apply() has not run yet' }

/** Render a value as one text content block, which is what `output.render` returns. */
function asText(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/** Bound a string so one tool result cannot flood the transcript. */
function clip(text, limit = 4000) {
  const value = String(text ?? '')
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… truncated ${value.length - limit} chars`
}

/**
 * Register one tool without letting its failure break the other tools.
 *
 * Every `execute` is also wrapped so its resolved value passes through
 * `jsonSafe()`. The harness rejects a Tool result that is not lossless JSON
 * (`value is not lossless JSON`), and that rejection fails the *call* — a single
 * `undefined`-valued property is enough. Doing it here means a tool author cannot
 * forget, and a throwing `execute` still propagates untouched.
 *
 * The collected list is what `apply` reports, so the plugin's behaviour is
 * inspectable without a debugger.
 */
function registerSafely(ctx, definition, failures) {
  const execute = definition.execute
  const wrapped = {
    ...definition,
    async execute(args, exec) {
      try {
        return jsonSafe(await execute(args, exec))
      } catch (error) {
        // A failure that names the next action is worth more than the raw text,
        // and the map is applied here so no `execute` has to remember it. The
        // guard keeps a tool that already attached its own hint from getting two.
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('Hint: ')) throw error
        throw new Error(withHint(message))
      }
    },
  }
  try {
    ctx.tools.register(wrapped)
    return true
  } catch (error) {
    failures.push({ tool: definition.name, error: error instanceof Error ? error.message : String(error) })
    return false
  }
}

/**
 * When a DRC result file is missing, name the Calibre results that DO exist in
 * the same directory. A bare "ENOENT" costs a whole round trip; the candidate
 * list usually contains the file the caller actually meant.
 */
async function drcSiblings(path) {
  try {
    const directory = dirname(path)
    const entries = await readdir(directory)
    const found = entries.filter((entry) => /\.drc\.(summary|results)$/i.test(entry)).sort()
    if (found.length === 0) return ''
    return ` Calibre result file(s) present in ${directory}: ${found.slice(0, 8).join(', ')}`
  } catch {
    return ''
  }
}

/** Project a registry `Workspace` onto wire-safe primitives. */
function projectWorkspace(workspace, fallbackPath) {
  const source = workspace ?? {}
  const id = source.id ?? source.workspaceId ?? source.key
  const path = source.path ?? fallbackPath
  const { title } = source
  const out = { path: String(path) }
  if (id !== undefined && id !== null) out.id = String(id)
  if (title !== undefined && title !== null) out.title = String(title)
  return out
}

/**
 * One-line, strictly layered readiness verdict.
 *
 * Reporting a later layer as failed when an earlier one is down is noise, so each
 * layer is only claimed when the layer beneath it is proven.
 */
function statusSummary(status) {
  const parts = []
  parts.push(status.vm.targetRunning ? 'VM running' : `VM not running (${status.vm.count} running)`)
  parts.push(status.guest.ok ? 'guest sshd ok' : `guest unreachable (${status.guest.detail})`)
  if (!status.guest.ok) return parts.join('; ')
  parts.push(status.tunnel.ok ? 'tunnel up' : `tunnel DOWN (${status.tunnel.detail})`)
  if (!status.tunnel.ok) return parts.join('; ')
  if (status.health !== undefined) {
    parts.push(status.health.ok ? `CIW ok (${status.health.via}, ${status.health.elapsedMs ?? '?'}ms)` : `CIW NOT answering (${status.health.detail})`)
  }
  if (status.virtuoso !== undefined) {
    parts.push(status.virtuoso.running ? `Virtuoso up (pids ${status.virtuoso.pids.slice(0, 4).join(',')})` : 'Virtuoso not running')
  }
  if (status.screensaver?.active === true) parts.push('screensaver ACTIVE — dismissals will silently no-op')
  if (status.windows !== undefined) parts.push(`${status.windows.count} window(s)`)
  if (status.configError !== undefined) parts.push(`config overlay ignored: ${status.configError}`)
  return parts.join('; ')
}

/** Read-only screensaver query: `-q` asks, it does not suspend. */
async function screensaverState(config) {
  if (config.manageScreensaver === false) return { managed: false }
  const probe = await ssh(config, 'export DISPLAY=:0; gnome-screensaver-command -q', { timeoutMs: 25_000 })
  const text = `${probe.stdout}\n${probe.stderr}`.toLowerCase()
  const active = text.includes('is active') ? true : text.includes('inactive') ? false : undefined
  return { managed: true, active, raw: clip(probe.stdout, 200), ok: probe.ok }
}

export function apply(ctx) {
  const failures = []

  registerSafely(
    ctx,
    {
      name: 'workspace_create',
      description:
        'Register a DeepSeek Harness workspace for an existing directory, so it appears in the ' +
        'sidebar project list. Passing a path that already has a workspace returns that workspace ' +
        'unchanged. A path that does not exist, or that is a file rather than a directory, is ' +
        'rejected. The workspace registry is otherwise invisible to the model, so this is the only ' +
        'model-reachable way to add one.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Absolute path to an existing directory.' },
          title: { type: 'string', description: 'Optional display title; defaults to the directory name.' },
        },
        required: ['path'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { path: { type: 'string' }, id: { type: 'string' }, title: { type: 'string' } },
          required: ['path'],
        },
        render: (_args, value) => asText(value),
      },
      async execute(args) {
        const path = String(args?.path ?? '').trim()
        if (path.length === 0) throw new Error('workspace_create needs a non-empty `path`')
        const title = typeof args?.title === 'string' && args.title.trim().length > 0 ? args.title.trim() : undefined
        try {
          const workspace =
            title === undefined ? await ctx.workspaceRegistry.create(path) : await ctx.workspaceRegistry.create(path, title)
          return projectWorkspace(workspace, path)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          throw new Error(`cannot create a workspace at "${path}": ${detail}`)
        }
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_status',
      description:
        'Report whether the IC layout toolchain is usable, as four independent layers: the VMware VM, ' +
        'the guest sshd, the host-side SSH tunnel to the bridge daemon, and the CIW answering SKILL. ' +
        'Read-only and safe to call at any time; call it FIRST whenever a layout operation fails, ' +
        'because a missing tunnel, a dead guest and a blocked CIW all look identical from the ' +
        'caller`s side. The tunnel layer matters most: it is created per bridge invocation, so it is ' +
        'routinely absent while the VM and Virtuoso are perfectly healthy. The report also carries ' +
        '`writeGuard`, which says whether the plugin`s write gate is armed and whether THIS session ' +
        'would have to confirm a mutating SKILL or shell call.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deep: {
            type: 'boolean',
            description:
              'Also probe the CIW (1+1 over the tunnel), the Virtuoso pids, the screensaver and the ' +
              'open windows. Adds a few seconds. Defaults to true when the guest is reachable.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            vm: { type: 'object' },
            guest: { type: 'object' },
            tunnel: { type: 'object' },
            health: { type: 'object' },
            virtuoso: { type: 'object' },
            screensaver: { type: 'object' },
            windows: { type: 'object' },
            config: { type: 'object' },
            writeGuard: { type: 'object' },
          },
          required: ['summary', 'vm', 'guest', 'tunnel'],
        },
        render: (_args, value) => asText(value),
      },
      async execute(args, exec) {
        const { config, path, error } = await loadConfig()
        const status = {
          vm: await vmStatus(config),
          guest: await guestReachable(config),
          tunnel: await tunnelUp(config),
          config: {
            configPath: path,
            writablePath: (await describeConfig()).writablePath,
            vmx: config.vmx,
            guestIp: config.guestIp,
            sshUser: config.sshUser,
            localPort: config.localPort,
          },
        }
        if (error !== undefined) status.configError = error
        const deep = args?.deep !== false && status.guest.ok === true
        if (deep) {
          status.virtuoso = await virtuosoRunning(config)
          // Only worth interrogating the CIW when the path to it exists at all.
          if (status.tunnel.ok) status.health = await healthCheck(config, { timeoutSec: 6 })
          else status.health = { ok: false, via: 'none', detail: 'tunnel down; run virtuoso_vm action up or virtuoso_recover' }
          status.screensaver = await screensaverState(config)
          // Count from the SKILL list, which is authoritative. The X11 list
          // deduplicates frames and can report fewer windows than Virtuoso has.
          const windows = await skillWindows(config)
          status.windows = { ok: windows.ok, count: windows.count, titles: windows.titles }
        }
        // The gate is a host-side safety layer, not a toolchain layer, so it is
        // reported separately from the four readiness layers above. `enforcedNow`
        // is the answer that matters: would a write from THIS session be stopped?
        const sessionMode = permissionMode(ctx, exec)
        status.writeGuard = { ...writeGuard, sessionMode, enforcedNow: sessionMode !== 'danger-full-access' }
        status.summary = statusSummary(status)
        return status
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_config',
      description:
        'Read or change the layout toolchain settings: VM path, vmrun path, guest IP, ssh user/port, ' +
        'bridge repo, artifact directory, tunnel ports, default screenshot target. Values persist in ' +
        'a JSON file under the DSH home and are applied on the very next call — no restart, no ' +
        'rebuild. Use `show` first; it reports every setting, which path is in force, and which ' +
        'values you have overridden.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['show', 'set', 'unset'],
            description: 'show (default): read settings. set: write the given keys. unset: return keys to defaults.',
          },
          settings: {
            type: 'object',
            description: `For set: the keys to write. Known keys: ${CONFIG_KEYS.join(', ')}.`,
            additionalProperties: true,
          },
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'For unset: the keys to remove from the overlay, returning them to their defaults.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            activePath: { type: 'string' },
            writablePath: { type: 'string' },
            overridden: { type: 'array' },
            effective: { type: 'object' },
            written: { type: 'object' },
            removed: { type: 'array' },
            error: { type: 'string' },
          },
          required: ['action'],
        },
        render: (_args, value) => asText(value),
      },
      async execute(args) {
        const action = String(args?.action ?? 'show')
        if (action === 'show') {
          const described = await describeConfig()
          return { action, ...described }
        }
        if (action === 'set') {
          const settings = args?.settings
          if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
            throw new Error('virtuoso_config action "set" needs a `settings` object')
          }
          // Coerce before writing so a bad port never reaches the settings file.
          const patch = {}
          for (const [key, raw] of Object.entries(settings)) {
            if (!CONFIG_KEYS.includes(key)) {
              throw new Error(`unknown setting "${key}"; known keys: ${CONFIG_KEYS.join(', ')}`)
            }
            const coerced = coerceConfigValue(key, raw)
            if (coerced.ok !== true) throw new Error(String(coerced.error))
            patch[key] = coerced.value
          }
          const written = await writeUserConfig(patch)
          if (written.ok !== true) throw new Error(String(written.error))
          const described = await describeConfig()
          return { action, written: { path: written.path, values: patch }, ...described }
        }
        if (action === 'unset') {
          const keys = Array.isArray(args?.keys) ? args.keys.map(String) : []
          if (keys.length === 0) throw new Error('virtuoso_config action "unset" needs a non-empty `keys` array')
          const result = await unsetUserConfig(keys)
          if (result.ok !== true) throw new Error(String(result.error))
          const described = await describeConfig()
          return { action, removed: result.removed, ...described }
        }
        throw new Error(`unknown virtuoso_config action "${action}"`)
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_vm',
      description:
        'Bring the layout toolchain up or down. `up` is the one-call repair: start the VM if needed, ' +
        'wait for sshd, suspend the guest screensaver, open the bridge SSH tunnel, then prove the CIW ' +
        'answers. `status` reports the three host-visible layers without changing anything. `start` ' +
        'and `stop` touch only the VM. `down` stops the VM (soft).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['status', 'up', 'start', 'stop', 'down'], description: 'Defaults to status.' },
          gui: { type: 'boolean', description: 'For start/up: show the VMware console window. Defaults to false.' },
          timeoutMs: {
            type: 'number',
            description: 'Budget for waiting on the guest to finish booting, in ms. Defaults to 300000 (5 min).',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            ok: { type: 'boolean' },
            summary: { type: 'string' },
            vm: { type: 'object' },
            guest: { type: 'object' },
            tunnel: { type: 'object' },
            screensaver: { type: 'object' },
            health: { type: 'object' },
            steps: { type: 'array' },
          },
          required: ['action', 'ok'],
        },
        render: (_args, value) => asText(value),
      },
      timeoutMs: 600_000,
      async execute(args) {
        const { config } = await loadConfig()
        const action = String(args?.action ?? 'status')
        const budget = Number.isFinite(Number(args?.timeoutMs)) ? Number(args.timeoutMs) : 300_000
        const steps = []
        const snapshot = async () => ({
          vm: await vmStatus(config),
          guest: await guestReachable(config),
          tunnel: await tunnelUp(config),
        })

        if (action === 'status') {
          const layers = await snapshot()
          return { action, ok: layers.vm.targetRunning && layers.guest.ok, ...layers, summary: statusSummary(layers) }
        }
        if (action === 'stop' || action === 'down') {
          const stopped = await vmStop(config, { hard: false })
          steps.push({ step: 'vm-stop', ...stopped })
          const layers = await snapshot()
          return { action, ok: layers.vm.targetRunning === false, steps, ...layers }
        }
        if (action === 'start' || action === 'up') {
          const before = await vmStatus(config)
          if (before.targetRunning !== true) {
            const started = await vmStart(config, { gui: args?.gui === true })
            steps.push({ step: 'vm-start', ok: started.ok, detail: clip(started.stderr || started.stdout, 300) })
            if (started.ok !== true) {
              const layers = await snapshot()
              return { action, ok: false, steps, ...layers, summary: `vm-start failed: ${clip(started.stderr, 200)}` }
            }
          } else {
            steps.push({ step: 'vm-start', ok: true, detail: 'already running' })
          }
          if (action === 'start') {
            const layers = await snapshot()
            return { action, ok: layers.guest.ok, steps, ...layers, summary: statusSummary(layers) }
          }
          // `up` continues through the layers that a running VM does not imply.
          const ready = await waitForGuest(config, { timeoutMs: budget })
          steps.push({ step: 'guest-ready', ok: ready.ok, waitedMs: ready.waitedMs })
          if (ready.ok !== true) {
            const layers = await snapshot()
            return { action, ok: false, steps, ...layers, summary: `guest sshd never answered within ${budget}ms` }
          }
          const prep = await guestPrep(config)
          steps.push({ step: 'screensaver-off', ok: prep.ok, detail: prep.detail })
          const tunnel = await ensureTunnel(config)
          steps.push({ step: 'ensure-tunnel', ok: tunnel.ok, detail: tunnel.detail })
          const health = tunnel.ok ? await healthCheck(config, { timeoutSec: 6 }) : { ok: false, detail: 'tunnel down' }
          steps.push({ step: 'health', ok: health.ok, detail: health.detail })
          const layers = await snapshot()
          return {
            action,
            ok: health.ok === true,
            steps,
            ...layers,
            screensaver: { active: prep.screensaverActive },
            health,
            summary: statusSummary({ ...layers, health, screensaver: { active: prep.screensaverActive } }),
          }
        }
        throw new Error(`unknown virtuoso_vm action "${action}"`)
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_recover',
      description:
        'Put the guest GUI back into a usable state and PROVE it with a real SKILL evaluation. Run ' +
        'this when SKILL calls stop answering or report a socket timeout. It repairs in dependency ' +
        'order: open the bridge tunnel if it is missing, suspend the screensaver, then dismiss ' +
        'blocking modal dialogs, re-checking after every action. The screensaver step is not ' +
        'cosmetic: an active screensaver holds the X input focus, so XTEST-based dialog dismissal ' +
        'reports success while delivering keys to the screensaver, and the modal stays up forever.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attempts: { type: 'number', description: 'Dialog-dismissal rounds before falling back to per-window keys. Defaults to 2.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            recovered: { type: 'boolean' },
            steps: { type: 'array' },
            health: { type: 'object' },
          },
          required: ['ok', 'steps'],
        },
        render: (_args, value) => asText(value),
      },
      timeoutMs: 420_000,
      async execute(args) {
        const { config } = await loadConfig()
        const attempts = Number.isFinite(Number(args?.attempts)) ? Number(args.attempts) : 2
        // The tunnel comes first: without it every later probe fails for a reason
        // that has nothing to do with the GUI, and would send the recovery down
        // the wrong path entirely.
        const tunnel = await ensureTunnel(config)
        const result = await recoverGuest(config, { attempts })
        return {
          ok: result.ok === true,
          recovered: result.recovered === true,
          tunnel: { ok: tunnel.ok, started: tunnel.started === true, detail: tunnel.detail },
          steps: [{ step: 'ensure-tunnel', ok: tunnel.ok, detail: tunnel.detail }, ...result.steps],
          health: result.health,
        }
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_windows',
      description:
        'List what Virtuoso has open. Reports the SKILL window list (authoritative titles, e.g. ' +
        '"Layout Suite L Editing: LIB CELL layout") and the X11 window list (the ids that ' +
        'virtuoso_recover can dismiss). Use this before reaching for screenshots, to know which ' +
        'targets exist.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          properties: {
            titles: { type: 'array' },
            raw: { type: 'string' },
            x11: { type: 'array' },
            count: { type: 'number' },
          },
          required: ['titles'],
        },
        render: (_args, value) => asText(value),
      },
      async execute() {
        const { config } = await loadConfig()
        const titles = await skillWindows(config)
        const x11 = await listWindows(config)
        return {
          titles: titles.titles,
          raw: clip(titles.raw, 1500),
          x11: Array.isArray(x11.windows)
            ? x11.windows.map((w) => ({ windowId: w.window_id, dismissId: w.dismiss_id, mapped: w.mapped }))
            : [],
          count: titles.count,
        }
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_screenshot',
      description:
        'Screenshot one Virtuoso window and copy the PNG back to this machine, returning its path, ' +
        'byte size, and whether the file really exists and is non-empty. This is how layout work ' +
        'becomes visible. `target` accepts ciw, current, a view name (layout, schematic, maestro) or ' +
        'a window number, and defaults to the configured screenshotTarget. Returns { ok, target, ' +
        'path, exists, bytes, hint }. To actually look at the result, pass the path to the read_image ' +
        'tool — that works only when the running model accepts image input, so when it reports that ' +
        'the model does not declare image input, verify the render programmatically with ' +
        '`python .validate/image-census.py <path>` (size, background, and a saturated-pixel census ' +
        'per layer colour) and hand the file to the human, who can see it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', description: 'Defaults to the configured screenshotTarget (layout).' },
          name: { type: 'string', description: 'Optional file name; defaults to <target>-<timestamp>.png.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            target: { type: 'string' },
            path: { type: 'string' },
            exists: { type: 'boolean' },
            bytes: { type: 'number' },
            hint: { type: 'string' },
            stderr: { type: 'string' },
          },
          required: ['ok', 'path'],
        },
        render: (_args, value) => asText(value),
      },
      timeoutMs: 240_000,
      async execute(args) {
        const { config } = await loadConfig()
        const target = typeof args?.target === 'string' && args.target.trim().length > 0 ? args.target.trim() : undefined
        const name = typeof args?.name === 'string' && args.name.trim().length > 0 ? args.name.trim() : undefined
        // `name` is a file name, not a path: resolve it against the configured
        // artifact directory, so a bare name cannot land in the process CWD.
        const result = await bridgeScreenshot(
          config,
          target,
          name === undefined ? {} : { output: join(config.artifactDir, name) },
        )
        if (result.ok !== true) {
          // `hint` and `stderr` already carry the diagnosis; keep them in the
          // message so the failure is actionable on its own.
          const detail = clip(result.stderr || result.stdout || 'no window matched the target', 300)
          const advice = typeof result.hint === 'string' && result.hint.length > 0 ? ` Hint: ${result.hint}` : ''
          throw new Error(`screenshot of "${result.target}" failed: ${detail}${advice}`)
        }
        return result
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'host_window',
      description:
        'Enumerate, raise or capture top-level windows on the HOST Windows desktop — the VMware ' +
        'Workstation console that shows the same VM these tools drive, and anything else you need to ' +
        'show a human. This is the "show me" counterpart to virtuoso_screenshot, which can only see ' +
        'inside the guest. Actions: `list` (visible titled windows with pid, title, class, rect), ' +
        '`info` (the best-matching window rect and minimised/maximised state), `raise` (restore or ' +
        'maximise and bring to front), `capture` (raise, then copy the window to a PNG and report its ' +
        'byte size and sha256). Matching is by `match` (substring of title or class, case-insensitive ' +
        'on the PowerShell side via -like) or `pid`. When nothing matches, the result is ok:false with ' +
        'the candidate windows listed, so a miss is diagnosable rather than silent. A capture under ' +
        '1024 bytes is reported as a failure, because that is a blank image, not a picture of the ' +
        'window. Windows only; on other platforms it returns ok:false instead of throwing.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'info', 'raise', 'capture'],
            description: 'Defaults to list.',
          },
          match: {
            type: 'string',
            description: 'Substring of the window title or class, e.g. "VMware" or "RHEL6".',
          },
          pid: { type: 'number', description: 'Match one process id instead of a title substring.' },
          mode: {
            type: 'string',
            enum: ['focus', 'maximize', 'restore'],
            description: 'For raise/capture: how to present the window. Defaults to focus (raise only).',
          },
          name: {
            type: 'string',
            description:
              'For capture: file name only (resolved against the configured artifact directory), ' +
              'e.g. "vmware-now.png". Absolute paths are rejected.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            action: { type: 'string' },
            count: { type: 'number' },
            total: { type: 'number' },
            windows: { type: 'array' },
            pid: { type: 'number' },
            title: { type: 'string' },
            class: { type: 'string' },
            rect: { type: 'object' },
            path: { type: 'string' },
            bytes: { type: 'number' },
            sha256: { type: 'string' },
            candidates: { type: 'array' },
            available: { type: 'array' },
            error: { type: 'string' },
            hint: { type: 'string' },
          },
          required: ['ok', 'action'],
        },
        render: (_args, value) => asText(value),
      },
      timeoutMs: 120_000,
      async execute(args) {
        const action = String(args?.action ?? 'list')
        const support = hostWindowsSupported()
        if (support.ok !== true) {
          return { ok: false, action, error: support.detail, hint: 'This tool reads Windows desktop window state.' }
        }
        const match = typeof args?.match === 'string' && args.match.trim().length > 0 ? args.match.trim() : undefined
        const pid = Number.isFinite(Number(args?.pid)) && Number(args.pid) > 0 ? Number(args.pid) : undefined
        const mode = typeof args?.mode === 'string' && args.mode.length > 0 ? args.mode : 'focus'

        if (action === 'list') {
          const result = await listHostWindows({ pattern: match, processId: pid })
          if (result.ok !== true) {
            return {
              ok: false,
              action,
              error: result.error ?? 'could not enumerate host windows',
              hint: 'PowerShell may be unavailable, or the execution policy refused the script.',
            }
          }
          return { ok: true, action, count: result.count, total: result.total, windows: result.windows }
        }

        if (action === 'raise') {
          const result = await raiseHostWindow({ pattern: match, processId: pid, mode })
          if (result.ok !== true) {
            return {
              ok: false,
              action,
              error: result.error ?? 'no window matched',
              available: result.available,
              hint:
                result.available?.length > 0
                  ? 'No window matched that pattern; the candidates are in `available`.'
                  : 'Nothing matched and no titled window is open at all — the application may not be running.',
            }
          }
          return result
        }

        if (action === 'info') {
          const result = await raiseHostWindow({ pattern: match, processId: pid, mode: 'focus' })
          if (result.ok !== true) {
            return { ok: false, action, error: result.error ?? 'no window matched', available: result.available }
          }
          // `raise` with mode focus restores a minimised window; that IS the useful
          // answer for `info`, so it is reported rather than worked around.
          return { ...result, action: 'info' }
        }

        if (action === 'capture') {
          const { config } = await loadConfig()
          const rawName = typeof args?.name === 'string' && args.name.trim().length > 0 ? args.name.trim() : undefined
          // A capture name is a file name, never a path: resolving it against the
          // artifact directory keeps a relative name out of the process CWD and
          // keeps a caller from writing anywhere it likes.
          if (rawName !== undefined && (rawName.includes('..') || /[\\/]/.test(rawName))) {
            throw new Error('`name` must be a bare file name (no directory separator and no "..")')
          }
          const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
          const output = join(config.artifactDir, rawName ?? `host-${stamp}.png`)
          const result = await captureHostWindow({ match, pid, mode, output })
          if (result.ok !== true) {
            return {
              ok: false,
              action,
              error: result.error ?? 'capture failed',
              available: result.available,
              hint:
                result.available?.length > 0
                  ? 'No window matched; see `available` for what is open.'
                  : 'Start the application first (for the VM: `virtuoso_vm` with action up and gui true).',
            }
          }
          return result
        }

        throw new Error(`unknown action "${action}" — expected list, info, raise or capture`)
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_eval',
      description:
        'Evaluate a SKILL program in the guest CIW and return the parsed result (status, output, ' +
        'errors, warnings). The program is shipped over stdin, which is the only channel that ' +
        'survives arbitrary SKILL: `(progn ...)` wraps it and the value of the last form is ' +
        'returned. Use this to draw geometry (dbCreateRect), query the design database ' +
        '(geGetEditCellView, cv~>shapes) or drive the layout editor. Pass `skill` inline, or `file` ' +
        'to read a .il file from this machine. Prefer a guest-side file when the program is long.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          skill: { type: 'string', description: 'SKILL source to evaluate. Multiple statements are fine.' },
          file: { type: 'string', description: 'Absolute path to a .il file to send instead of `skill`.' },
          confirm: {
            type: 'string',
            description:
              'Only for a call that would WRITE (dbCreate*, dbSave, dbDelete*, ddCreateLib, ' +
              'techBindTechFile…): the confirmation token bound to this exact payload, which the ' +
              'write gate returned. ' +
              'Not needed for read-only SKILL, and not needed at all in danger-full-access mode.',
          },
          timeoutSec: { type: 'number', description: 'SKILL timeout in seconds. Defaults to 60.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            status: { type: 'string' },
            output: {},
            errors: { type: 'array' },
            warnings: { type: 'array' },
            errorKind: { type: 'string' },
            errorText: { type: 'string' },
            hint: { type: 'string' },
            executionMs: { type: 'number' },
            elapsedMs: { type: 'number' },
            timedOut: { type: 'boolean' },
            command: { type: 'string' },
          },
          required: ['ok'],
        },
        render: (_args, value) => asText(value),
      },
      timeoutMs: 300_000,
      async execute(args) {
        const { config } = await loadConfig()
        const file = typeof args?.file === 'string' ? args.file.trim() : ''
        let source = typeof args?.skill === 'string' ? args.skill : ''
        if (file.length > 0) {
          try {
            source = await readFile(file, 'utf8')
          } catch (error) {
            throw new Error(`cannot read SKILL file "${file}": ${String(error?.message ?? error)}`)
          }
        }
        if (source.trim().length === 0) throw new Error('virtuoso_eval needs `skill` or `file`')
        const timeoutSec = Number.isFinite(Number(args?.timeoutSec)) ? Math.max(5, Number(args.timeoutSec)) : 60
        // A missing tunnel is the single most common cause of a false "CIW is
        // wedged" verdict, so repair it before spending the timeout.
        await ensureTunnel(config)
        const result = await bridgeEval(config, source, { timeoutSec })
        if (result.ok !== true && result.timedOut === true) {
          throw new Error(
            `SKILL did not finish within ${timeoutSec}s. The CIW may be blocked by a modal dialog: ` +
              'call virtuoso_recover, which suspends the screensaver before dismissing it.',
          )
        }
        if (result.ok !== true) {
          // Return the payload rather than throwing — the caller usually wants
          // the SKILL output as well. The diagnosis turns the errset-shaped
          // `("load" 0 t nil (...))` payload into a kind, the one readable line
          // inside it, and the next action.
          return { ...result, ...diagnoseEvalResult(result) }
        }
        return result
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_run',
      description:
        'Run a long shell command inside the guest as a background job and return immediately with ' +
        'a job id. Read it with the job_output tool. Use this for anything slow — Calibre DRC, ' +
        'extraction, batch SKILL — so the conversation is not blocked and the output is not lost. ' +
        'When the job registry is unavailable the command runs synchronously instead and says so in ' +
        'the result.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string', description: 'Shell command to run in the guest.' },
          label: { type: 'string', description: 'Short label for the job list. Defaults to the command.' },
          timeoutMs: { type: 'number', description: 'Wall-clock budget in ms. Defaults to 3600000 (1 hour).' },
          background: { type: 'boolean', description: 'Set false to force synchronous execution. Defaults to true.' },
          confirm: {
            type: 'string',
            description:
              'Only for a command that would WRITE in the guest (a `>`/`>>` redirection, or rm/mv/cp/mkdir/' +
              'touch/chmod/tee/sed -i): the confirmation token bound to this exact command, which ' +
              'the write gate returned. ' +
              'Not needed for read-only commands, and not needed at all in danger-full-access mode.',
          },
        },
        required: ['command'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            mode: { type: 'string' },
            jobId: { type: 'string' },
            label: { type: 'string' },
            ok: { type: 'boolean' },
            code: { type: 'number' },
            stdout: { type: 'string' },
            stderr: { type: 'string' },
            detail: { type: 'string' },
            hint: { type: 'string' },
          },
          required: ['mode'],
        },
        render: (_args, value) => asText(value),
      },
      timeoutMs: 3_600_000,
      async execute(args, exec) {
        const { config } = await loadConfig()
        const command = String(args?.command ?? '').trim()
        if (command.length === 0) throw new Error('virtuoso_run needs a non-empty `command`')
        const timeoutMs = Number.isFinite(Number(args?.timeoutMs)) ? Number(args.timeoutMs) : 3_600_000
        const label = typeof args?.label === 'string' && args.label.trim().length > 0 ? args.label.trim() : clip(command, 60)

        const jobs = ctx.get('jobs')
        const owner = exec?.agent?.id
        if (args?.background !== false && jobs !== undefined && owner !== undefined) {
          try {
            const jobId = jobs.start({
              kind: 'bash',
              label,
              owner,
              outputLimitBytes: 4 * 1024 * 1024,
              run(job) {
                const handle = spawnSsh(config, command, {
                  timeoutMs,
                  onStdout: (text) => job.append(text, { channel: 'stdout' }),
                  onStderr: (text) => job.append(text, { channel: 'stderr' }),
                })
                job.updateProgress(`ssh pid ${handle.pid ?? '?'}`)
                // Settle with WHY, never with the bytes: every chunk already went
                // out through job.append(), so re-sending stdout here made a
                // finished job print itself twice. See jobOutcome() in virtuoso.js.
                const done = handle.done.then((result) => jobOutcome(result, timeoutMs))
                return {
                  cancel: (reason) => {
                    job.updateProgress(`cancelling: ${reason ?? 'requested'}`)
                    handle.kill()
                  },
                  done,
                }
              },
            })
            return {
              mode: 'job',
              jobId: String(jobId),
              label,
              hint: `Read it with job_output {"job_id": "${String(jobId)}"}.`,
            }
          } catch (error) {
            // Falling back is better than failing: the command still runs, it just
            // blocks. Say which path was taken and why.
            const detail = String(error?.message ?? error)
            const result = await ssh(config, command, { timeoutMs })
            return {
              mode: 'sync-fallback',
              detail: `job registry refused the job (${clip(detail, 200)}); ran synchronously instead`,
              ok: result.ok,
              code: result.code,
              stdout: clip(result.stdout),
              stderr: clip(result.stderr, 1000),
            }
          }
        }
        const result = await ssh(config, command, { timeoutMs })
        return {
          mode: 'sync',
          detail: args?.background === false ? 'background was disabled' : 'no job registry available',
          ok: result.ok,
          code: result.code,
          stdout: clip(result.stdout),
          stderr: clip(result.stderr, 1000),
        }
      },
    },
    failures,
  )

  registerSafely(
    ctx,
    {
      name: 'virtuoso_drc',
      description:
        'Parse a Calibre DRC result file into structured JSON: total violations, failing checks ' +
        'with counts, descriptions, and NOT EXECUTED checks. Accepts either `*.drc.summary` (the ' +
        'DRC-H summary report) or `*.drc.results` (the ASCII results database) and detects which ' +
        'by filename. Use this instead of reading the raw file, which is hundreds of padded lines. ' +
        'Pass both files from the same run to cross-validate them against each other.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Absolute path to a *.drc.summary or *.drc.results file.' },
          compareWith: {
            type: 'string',
            description: 'Optional sibling file from the same run; the two are reconciled per check and disagreement is reported.',
          },
          verbose: { type: 'boolean', description: 'Include every check, not just the failing ones. Defaults to false.' },
        },
        required: ['path'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            kind: { type: 'string' },
            cell: { type: 'string' },
            ruleFile: { type: 'string' },
            totals: { type: 'object' },
            failing: { type: 'array' },
            warnings: { type: 'array' },
            checks: { type: 'array' },
            comparison: { type: 'object' },
          },
          required: ['path', 'totals'],
        },
        render: (_args, value) => asText(value),
      },
      async execute(args) {
        const path = String(args?.path ?? '').trim()
        if (path.length === 0) throw new Error('virtuoso_drc needs a non-empty `path`')
        const parsed = await parseFile(path)
        if (parsed.ok !== true) {
          throw new Error(withHint(`cannot parse "${path}": ${parsed.error}${await drcSiblings(path)}`))
        }
        const { data } = parsed
        const out = { path, kind: data.kind, totals: data.totals }
        const cell = data.header?.['Layout Primary Cell'] ?? data.cell
        const ruleFile = data.header?.['Rule File Pathname'] ?? data.failing?.[0]?.ruleFile
        if (cell !== undefined) out.cell = String(cell)
        if (ruleFile !== undefined) out.ruleFile = String(ruleFile)
        if (Array.isArray(data.warnings) && data.warnings.length > 0) out.warnings = data.warnings
        if (args?.verbose === true) out.checks = data.checks
        else out.failing = data.failing
        const other = typeof args?.compareWith === 'string' ? args.compareWith.trim() : ''
        if (other.length > 0) {
          const sibling = await parseFile(other)
          if (sibling.ok !== true) throw new Error(withHint(`cannot parse "${other}": ${sibling.error}`))
          const { reconcile } = await import('./drc.js')
          out.comparison = reconcile(data, sibling.data)
          if (out.comparison.agreement !== true) {
            throw new Error(
              `DRC cross-validation failed between "${path}" and "${other}": ` +
                JSON.stringify(out.comparison.disagreements),
            )
          }
        }
        return out
      },
    },
    failures,
  )

  // A DSH-level tool rather than a layout-level one: it reports this session's own
  // token budget. It ships here because this is the installed host plugin; if a
  // general-purpose bundle ever provides one, this copy can be deleted outright.
  // It is read-only, and every number it reports is the harness's own arithmetic.
  registerSafely(
    ctx,
    {
      name: 'context_usage',
      description:
        'Report how full this session`s context window is, from the harness token meter: tokens used, ' +
        'the window size when the provider declares one, the fixed baseline cost, and the largest ' +
        'contributing messages. Read-only, no model call, no guest access. Call it BEFORE reading a ' +
        'large file or dumping a whole registry, and again when a compaction notice appears, so the ' +
        'remaining budget is a number instead of a surprise. This is a DeepSeek Harness measurement, ' +
        'not a layout operation: it lives in this bundle only because this is the installed host plugin.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          top: {
            type: 'integer',
            description: 'How many of the largest contributing messages to list, 1-25. Defaults to 8.',
          },
          full: {
            type: 'boolean',
            description:
              'Also return the raw TokenMeasurement (logRevision, baseline, surfaceTokens, ' +
              'surfaceDeltaTokens, nodes). Defaults to false, which keeps the result small.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            summary: { type: 'string' },
            source: { type: 'string' },
            sessionId: { type: 'string' },
            provider: { type: 'string' },
            model: { type: 'string' },
            contextWindow: { type: 'number' },
            used: { type: 'number' },
            remaining: { type: 'number' },
            percent: { type: 'number' },
            pressure: { type: 'string' },
            baselineKind: { type: 'string' },
            baselineTokens: { type: 'number' },
            surfaceTokens: { type: 'number' },
            contributors: { type: 'array' },
            detail: { type: 'string' },
            hint: { type: 'string' },
            measurement: { type: 'object' },
          },
          required: ['ok', 'summary'],
        },
        render: (_args, value) => asText(value),
      },
      async execute(args, exec) {
        const group = (value) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        const top = Number.isInteger(args?.top) ? Math.min(25, Math.max(1, args.top)) : 8
        const service = (key) => (typeof ctx.get === 'function' ? ctx.get(key) : undefined)
        const meter = service('tokenMeter')
        const store = service('sessions')
        const missing = []
        if (typeof meter?.measure !== 'function') missing.push('tokenMeter.measure')
        if (typeof store?.get !== 'function') missing.push('sessions.get')
        if (missing.length > 0) {
          return {
            ok: false,
            summary: `context usage is not measurable in this composition: ${missing.join(' and ')} unavailable`,
            detail: `ctx.get("tokenMeter") -> ${typeof meter}; ctx.get("sessions") -> ${typeof store}.`,
            hint:
              'Both are host services reached through ctx.get(), and nothing else in this bundle needs them. ' +
              'From a non-host scope (a client, or a composition without the token meter) this tool cannot ' +
              'answer, and retrying will not change that.',
          }
        }
        // `exec.agent` is the per-call channel; the process-local initiator is the
        // fallback. `source` names the one that answered, so a missing channel is
        // visible as a gap instead of silently measuring the wrong session.
        const describeAgent = (agent) =>
          agent === undefined ? 'absent' : typeof agent.id === 'string' ? `id ${agent.id}` : 'present without an id'
        const fromExec = exec?.agent
        const tried = [`exec.agent -> ${describeAgent(fromExec)}`]
        let session
        let source = ''
        if (fromExec !== undefined && typeof fromExec.id === 'string') {
          session = store.get(fromExec.id)
          if (session !== undefined) source = 'exec.agent'
        }
        if (session === undefined) {
          const agents = service('agents')
          const current = typeof agents?.currentInitiator === 'function' ? agents.currentInitiator() : undefined
          tried.push(`agents.currentInitiator() -> ${describeAgent(current)}`)
          if (current !== undefined && typeof current.id === 'string') {
            session = store.get(current.id)
            if (session !== undefined) source = 'agents.currentInitiator'
          }
        }
        if (session === undefined) {
          return {
            ok: false,
            summary: 'could not identify the calling session, so nothing was measured',
            detail: tried.join('; '),
            hint:
              'The lookup is sessions.get(agent.id) and the meter itself is fine, so report this gap rather ' +
              'than measuring a session id from another source: the wrong session is worse than none.',
          }
        }
        const measurement = meter.measure(session)
        // A session whose provider has not been called yet may have no request
        // context, and asking must not cost us the token total we already have.
        let request
        let requestError
        try {
          request = typeof session.requestContext === 'function' ? session.requestContext() : undefined
        } catch (error) {
          requestError = error instanceof Error ? error.message : String(error)
        }
        const used = typeof measurement?.totalTokens === 'number' ? measurement.totalTokens : undefined
        const window =
          typeof request?.contextWindow === 'number' && request.contextWindow > 0 ? request.contextWindow : undefined
        const baseline = measurement?.baseline
        const nodes = Array.isArray(measurement?.nodes) ? measurement.nodes : []
        const out = {
          ok: true,
          summary: '',
          source,
          sessionId: typeof session.id === 'string' ? session.id : String(fromExec?.id ?? ''),
        }
        if (used !== undefined) out.used = used
        if (typeof request?.provider === 'string') out.provider = request.provider
        if (typeof request?.model === 'string') out.model = request.model
        if (window !== undefined && used !== undefined) {
          const ratio = used / window
          // The band is derived from the percent we print, not from the raw ratio:
          // 149999/200000 is 74.9995%, prints as "75%", and must not be labelled
          // "moderate" next to its own headline.
          const percent = Math.round(ratio * 1000) / 10
          out.contextWindow = window
          out.remaining = Math.max(0, window - used)
          out.percent = percent
          out.pressure = percent < 50 ? 'low' : percent < 75 ? 'moderate' : percent < 90 ? 'high' : 'critical'
        }
        if (typeof baseline?.kind === 'string') out.baselineKind = baseline.kind
        if (typeof baseline?.tokens === 'number') out.baselineTokens = baseline.tokens
        if (typeof measurement?.surfaceTokens === 'number') out.surfaceTokens = measurement.surfaceTokens
        // Nodes carry a log position, not a label: the largest ones are the messages
        // worth summarising first. Sorting here is why the caller needs no sorting.
        out.contributors = nodes
          .map((node) => ({
            seq: typeof node?.seq === 'number' ? node.seq : 0,
            tokens: typeof node?.tokens === 'number' ? node.tokens : 0,
            heuristicTokens: typeof node?.heuristicTokens === 'number' ? node.heuristicTokens : 0,
          }))
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, top)
        const headline =
          used === undefined
            ? 'the token meter reported no total'
            : requestError !== undefined
              ? `${group(used)} tokens used; the context window could not be read`
              : window === undefined
                ? `${group(used)} tokens used; this provider declares no context window`
                : `${out.percent}% used: ${group(used)} of ${group(window)} tokens, ${group(out.remaining)} left`
        out.summary = [
          headline,
          `${out.provider ?? '?'}/${out.model ?? '?'}`,
          `${nodes.length} nodes`,
          typeof out.baselineTokens === 'number'
            ? `baseline ${group(out.baselineTokens)} (${out.baselineKind})`
            : 'no baseline',
        ].join(' · ')
        if (requestError !== undefined) {
          out.detail = `session.requestContext() threw: ${requestError}`
          out.hint =
            '`session.requestContext()` threw, so the window is unknown, but the token total above is still ' +
            'the meter`s own number and no percentage is claimed. A session whose provider has not been called ' +
            'yet can legitimately have no request context, which is why this is reported rather than thrown.'
        }
        if (out.pressure === 'high' || out.pressure === 'critical') {
          out.hint =
            `At ${out.percent}% of the window there is little room left. Pruning and compaction follow the ` +
            'harness`s own thresholds rather than this number, so treat it as the point to stop opening large ' +
            'files: grep to locate, read with offset/limit, and write down what must survive the next big output.'
        }
        if (args?.full === true) out.measurement = jsonSafe(measurement)
        return out
      },
    },
    failures,
  )

  // The gate is registered last and separately from the tools: it has to be able
  // to deny them, and a gate that failed to register must be visible rather than
  // assumed.
  writeGuard = installWriteGuard(ctx)

  if (failures.length > 0) {
    // Surfaced through the log rather than swallowed: a silently missing tool is
    // much harder to diagnose than a visible one.
    ctx.logger?.warn?.(`[virtuoso-layout] ${failures.length} tool(s) failed to register: ${JSON.stringify(failures)}`)
  }
  ctx.logger?.info?.(`[virtuoso-layout] registered ${TOTAL_TOOLS - failures.length}/${TOTAL_TOOLS} tools`)
}
