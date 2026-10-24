/**
 * Host desktop windows — enumerate, raise, capture.
 *
 * Why this lives in the layout plugin: the VMware Workstation console is the
 * human-visible front end of the same VM the tools drive, and "show me" is a
 * first-class operation for layout work. Before this module, capturing it meant
 * hand-writing P/Invoke in a throwaway PowerShell one-liner per session — the
 * capability existed but was neither reusable nor discoverable, which is exactly
 * the ergonomics gap this fixes.
 *
 * Contract with the caller:
 *  - The work happens in `host-window.ps1`, invoked with `-File` and argv only.
 *    A `-Command` string is never built: PowerShell 5.1 strips embedded double
 *    quotes out of native argv, so any title with a quote in it would be mangled.
 *  - Data comes back as a UTF-8 JSON file, not stdout. PS 5.1 writes console
 *    output in the OEM code page, which turns non-ASCII window titles into mojibake.
 *  - Every failure is a return value (`ok: false`) rather than a throw, because
 *    "there is no VMware window open" is an answer, not an exception. Genuine
 *    contract violations (non-Windows, script missing) do throw.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'host-window.ps1')

/** The PowerShell 5.1 host. `pwsh` is not assumed: it is absent on this machine. */
export function powershellPath() {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

export function hostWindowsSupported() {
  if (process.platform !== 'win32') {
    return { ok: false, detail: `host windows are only reachable on win32, this is ${process.platform}` }
  }
  return { ok: true }
}

/**
 * Invoke the PowerShell collector once.
 *
 * Never rejects: a missing result file is reported as `{ ok: false }` with the
 * process's own stderr attached, because that is the only way a reader can tell
 * "PowerShell refused to run the script" from "the script ran and found nothing".
 */
function invokePowerShell(action, { pattern, processId, mode, name } = {}) {
  return new Promise((settle) => {
    const stamp = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const out = join(tmpdir(), `dsh-host-window-${stamp}.json`)
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT]
    args.push('-Action', action, '-Out', out)
    if (typeof pattern === 'string' && pattern.length > 0) args.push('-Pattern', pattern)
    if (typeof processId === 'number' && processId > 0) args.push('-ProcessId', String(processId))
    if (typeof mode === 'string' && mode.length > 0) args.push('-Mode', mode)
    if (typeof name === 'string' && name.length > 0) args.push('-Name', name)

    execFile(
      powershellPath(),
      args,
      { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      async (error, stdout, stderr) => {
        let payload
        let raw = ''
        try {
          raw = await readFile(out, 'utf8')
        } catch {
          raw = ''
        }
        // The result file is removed on every path, including the failure paths:
        // these accumulate at one per call otherwise, and a stale one from a
        // previous run must never be mistaken for this run's answer.
        await rm(out, { force: true })
        if (raw.length > 0) {
          try {
            payload = JSON.parse(raw)
          } catch (parseError) {
            payload = { ok: false, action, error: `could not parse the PowerShell result: ${parseError.message}` }
          }
        } else {
          const detail = String(stderr ?? '').trim()

          payload = {
            ok: false,
            action,
            error:
              detail.length > 0
                ? detail.split(/\r?\n/)[0].slice(0, 400)
                : `PowerShell produced no result file${error ? ` (${error.message.split(/\r?\n/)[0]})` : ''}`,
          }
        }
        if (typeof payload === 'object' && payload !== null && typeof payload.action !== 'string') {
          payload.action = action
        }
        // stdout is only ever diagnostic here; keep it when it explains a failure.
        if (payload.ok !== true && stdout && !payload.stdout) {
          const text = String(stdout).trim()
          if (text.length > 0) payload.stdout = text.slice(0, 800)
        }
        settle(payload)
      },
    )
  })
}

/** Enumerate visible, titled top-level host windows. */
export function listHostWindows(options = {}) {
  const support = hostWindowsSupported()
  if (support.ok !== true) return Promise.resolve({ ok: false, action: 'list', error: support.detail })
  return invokePowerShell('list', options)
}

/** Rect and state of the best-matching window. */
export function hostWindowInfo(options = {}) {
  const support = hostWindowsSupported()
  if (support.ok !== true) return Promise.resolve({ ok: false, action: 'info', error: support.detail })
  return invokePowerShell('info', options)
}

/** Restore / raise / maximise the best-matching window. */
export function raiseHostWindow(options = {}) {
  const support = hostWindowsSupported()
  if (support.ok !== true) return Promise.resolve({ ok: false, action: 'raise', error: support.detail })
  return invokePowerShell('raise', options)
}

/**
 * Raise the window and copy it to a PNG, then prove the file exists.
 *
 * The byte count is re-read from disk in Node rather than trusted from the
 * PowerShell payload: "the script said it saved 200 KB" is not evidence that a
 * file of that size is there now, and a 200-byte blank PNG is the exact failure
 * this check exists to catch. The sha256 is included so two captures can be
 * compared for identity instead of by eyeball.
 */
export async function captureHostWindow({ match, pid, mode = 'focus', output } = {}) {
  const support = hostWindowsSupported()
  if (support.ok !== true) return { ok: false, action: 'capture', error: support.detail }
  if (typeof output !== 'string' || output.length === 0) {
    throw new Error('captureHostWindow needs an output path')
  }
  if (!isAbsolute(output)) throw new Error(`captureHostWindow output must be absolute, got: ${output}`)

  const result = await invokePowerShell('capture', { pattern: match, processId: pid, mode, name: output })
  if (result.ok !== true) return result

  let bytes = 0
  try {
    bytes = (await stat(output)).size
  } catch (error) {
    return {
      ...result,
      ok: false,
      error: `PowerShell reported a capture but ${output} is not readable: ${error.message}`,
    }
  }
  if (bytes < 1024) {
    return {
      ...result,
      ok: false,
      bytes,
      error: `the capture is only ${bytes} bytes, which is a blank image — the window was probably ` +
        'minimised or fully occluded',
    }
  }
  const digest = createHash('sha256').update(await readFile(output)).digest('hex')
  return { ...result, ok: true, path: output, bytes, sha256: digest }
}
