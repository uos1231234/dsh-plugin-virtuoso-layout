/**
 * dsh-plugin-virtuoso-layout — the write gate.
 *
 * A layout tool can destroy work: `dbSave` persists over a cellview the human may
 * have open, `dbDelete*` removes geometry, `ddCreateLib` claims a library name for
 * the whole Virtuoso session, and `virtuoso_run` reaches the entire guest
 * filesystem. So there has to be one deliberate step between "the model decided"
 * and "the disk changed".
 *
 * DSH offers exactly one mechanism for that at the tool layer — a monotonic guard
 * registered with `ctx.tools.guard(guard)` — and its contract decides this design:
 *
 *  - the guard is SYNCHRONOUS (`(execution) => string | undefined`), so it cannot
 *    await a human. There is no ask-and-continue shape available here.
 *  - it runs AFTER the `tools/pre-execute` waterfall and can only DENY (return a
 *    reason string) or abstain (return `undefined`). No guard can force-allow a
 *    call another guard denied, and a guard cannot see another guard's verdict.
 *  - the execution object it receives is the harness's own, built as
 *    `{ callId, name, arguments, agent, signal }` — note `arguments`, not `args`,
 *    and note that `arguments` is the raw string when the model's JSON was invalid.
 *
 * So the confirmation is a token bound to the exact payload: the first call is denied
 * with the token inside the reason, and re-issuing the same call with
 * `confirm: "<token>"` is the acknowledgement. Because the token is a digest of the
 * payload, editing the payload asks again — a stale "yes" cannot authorise a
 * different write. The gate is stateless: the same payload always yields the same
 * token, and there is no use-once invalidation. It answers "are these the arguments
 * you were shown?", not "has this token been spent?".
 *
 * The one exception is deliberate, and it is the human's setting rather than the
 * model's: a session whose sandbox policy is `danger-full-access` has already
 * granted blanket write permission, so the gate abstains there and writes stay
 * frictionless. `approval.request()` exists in the same runtime but is NOT used:
 * it needs an open turn and the session's approval policy, and a session with
 * approvals disabled rejects requests automatically — wiring writes to it would
 * break the very mode this gate is meant to stay out of the way in.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** The only tools this gate may deny. Every other tool is untouched. */
export const GUARDED_TOOLS = ['virtuoso_eval', 'virtuoso_run']

/**
 * SKILL entry points that change the design database, a library, or the file
 * system. Deliberately a prefix family (`dbCreate*`) so a mutator added later is
 * already covered, and deliberately NOT `dbOpenCellViewByType`: opening a cellview
 * to read is inspection, and gating inspection only teaches the caller to confirm
 * without looking.
 */
const SKILL_WRITE_SOURCE =
  String.raw`\b(?:db(?:Save|Create|Delete|Copy|Move|Set|Replace|Add|Remove|Merge)\w*` +
  String.raw`|dd(?:Create|Delete|Rename)\w*` +
  String.raw`|techBindTechFile|techUnbindTechFile|leHiEditInPlace|leReplace)\b`

/**
 * Guest shell spellings that write: a file redirection, or a command whose whole
 * purpose is to change the file system. `2>&1` and `>=` are excluded on purpose —
 * they are how output is *read*, and gating them would train the caller to paste a
 * token at every probe.
 */
const SHELL_WRITE_SOURCE =
  String.raw`(?<!>)>>?(?![=&])` +
  String.raw`|\b(?:rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|tee|truncate|dd|install|patch|sed\s+-i|perl\s+-i)\b`

/** The longest program this gate will read off disk to classify. */
const MAX_SCAN_BYTES = 512 * 1024

/** Unique, in first-seen order, capped so a reason line stays a line. */
function uniqueMatches(source, patternSource) {
  const found = []
  // A fresh RegExp per call: a shared `/g` regex carries `lastIndex` between
  // calls, and state that survives a call is exactly how a gate silently stops
  // matching.
  for (const match of String(source).matchAll(new RegExp(patternSource, 'g'))) {
    const text = match[0].trim()
    if (!found.includes(text)) found.push(text)
    if (found.length >= 6) break
  }
  return found
}

/**
 * The SKILL program a `virtuoso_eval` call would run.
 *
 * `file` wins over `skill` when both are present, mirroring `execute` exactly — a
 * gate that read the inline text while the tool ran the file would be worse than
 * no gate, because it would look like it had checked.
 */
function skillSource(args) {
  const file = typeof args?.file === 'string' ? args.file.trim() : ''
  if (file.length > 0) {
    try {
      return readFileSync(file, 'utf8').slice(0, MAX_SCAN_BYTES)
    } catch {
      // Left ungated: `virtuoso_eval` reports an unreadable file precisely, and a
      // second vague denial would only hide that error.
      return undefined
    }
  }
  const inline = typeof args?.skill === 'string' ? args.skill : ''
  return inline.trim().length > 0 ? inline : undefined
}

/**
 * What a call would write, or `undefined` when it would write nothing.
 *
 * A false positive costs one confirmation; a false negative costs the user's
 * layout, so the patterns lean towards matching.
 */
export function writeIntent(name, args) {
  if (name === 'virtuoso_eval') {
    const source = skillSource(args)
    if (source === undefined) return undefined
    const calls = uniqueMatches(source, SKILL_WRITE_SOURCE)
    return calls.length === 0 ? undefined : { kind: 'SKILL', calls, payload: source }
  }
  if (name === 'virtuoso_run') {
    const command = typeof args?.command === 'string' ? args.command : ''
    if (command.trim().length === 0) return undefined
    const calls = uniqueMatches(command, SHELL_WRITE_SOURCE)
    return calls.length === 0 ? undefined : { kind: 'guest shell', calls, payload: command }
  }
  return undefined
}

/** The confirmation token for a payload: same payload, same token, every time. */
export function confirmationToken(payload) {
  return createHash('sha256').update(String(payload)).digest('hex').slice(0, 8)
}

/** The denial text. It has to name the next action, because it is all the caller gets. */
export function denialReason(intent, mode, given) {
  const why =
    mode === undefined || mode === null
      ? 'the sandbox policy could not be read, so the gate fails closed'
      : `this session is not in danger-full-access mode (mode: ${mode})`
  const lines = [
    `virtuoso-layout write gate: BLOCKED before execution — this ${intent.kind} call writes ` +
      `(${intent.calls.join(', ')}) and ${why}. Nothing ran and nothing was written.`,
  ]
  if (given.length > 0) {
    lines.push(
      `The confirm token supplied ("${given}") is not this payload's token, so it acknowledges a ` +
        'different call.',
    )
  }
  lines.push(
    `Next: to approve the call above, re-issue the same arguments with confirm: ` +
      `"${confirmationToken(intent.payload)}" — the token is bound to those arguments, not spent on use. ` +
      'Any edit to the payload produces a different token and asks ' +
      'again. Read-only work needs no confirm, so never paste a token you have not just been given.',
  )
  return lines.join(' ')
}

/**
 * The policy, as a pure function: `undefined` = abstain, else the denial reason.
 * Pure so the decision can be tested without a live harness.
 */
export function evaluateWrite(execution, mode) {
  const name = typeof execution?.name === 'string' ? execution.name : ''
  const args = execution?.arguments
  const options = typeof args === 'object' && args !== null ? args : undefined
  const intent = writeIntent(name, options)
  if (intent === undefined) return undefined
  if (mode === 'danger-full-access') return undefined
  const given = typeof options?.confirm === 'string' ? options.confirm.trim().toLowerCase() : ''
  if (given.length > 0 && given === confirmationToken(intent.payload)) return undefined
  return { intent, reason: denialReason(intent, mode, given) }
}

/**
 * The sandbox mode in force for one execution, preferring the session's own
 * logged mode over the deployment default.
 *
 * Every read is defensive: `sandboxPolicy` is an optional service, its request
 * shape may move, and a gate that throws on an unfamiliar runtime is worse than a
 * gate that falls back to the strict reading.
 */
export function permissionMode(ctx, execution) {
  const service = ctx?.get?.('sandboxPolicy')
  if (service === undefined || service === null) return undefined
  const session = execution?.agent?.session
  if (session !== undefined && typeof service.overrideOf === 'function') {
    try {
      const override = service.overrideOf(session)
      if (typeof override === 'string' && override.length > 0) return override
    } catch {
      /* fall through to resolve() */
    }
  }
  const requests = session === undefined ? [{}] : [{ session }, {}]
  for (const request of requests) {
    try {
      const mode = service.resolve?.(request)?.mode
      if (typeof mode === 'string' && mode.length > 0) return mode
    } catch {
      /* try the next request shape */
    }
  }
  const fallback = service.defaultMode
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : undefined
}

/** One human-readable line about the gate, for a log and for `virtuoso_status`. */
function summaryOf(report) {
  if (report.installed !== true) return `write gate NOT installed (${report.detail})`
  const defaultMode = report.defaultMode ?? 'unknown'
  return (
    `write gate armed for ${report.guardedTools.join('/')} — deployment mode ${defaultMode}, ` +
    `confirmation ${report.enforcedByDefault ? 'REQUIRED unless the session is danger-full-access' : 'skipped (danger-full-access)'}`
  )
}

/**
 * Register the gate. Returns a JSON-safe report, which is the only way to see from
 * the model side whether the gate is actually armed.
 */
export function installWriteGuard(ctx) {
  const report = {
    installed: false,
    guardedTools: [...GUARDED_TOOLS],
    confirmParam: 'confirm',
    defaultMode: undefined,
    enforcedByDefault: true,
    detail: '',
  }
  const tools = ctx?.tools
  if (typeof tools?.guard !== 'function') {
    report.detail = 'ctx.tools.guard is unavailable in this composition, so no write gate was registered'
    ctx?.logger?.warn?.(`[virtuoso-layout] ${report.detail}`)
    report.summary = summaryOf(report)
    return report
  }
  try {
    // A plain-context guard applies globally, so the tool-name filter lives inside
    // it. The disposer is the harness's to keep: `apply` registers into its own
    // plugin scope, which is what owns the unregistration.
    tools.guard((execution) => {
      try {
        return evaluateWrite(execution, permissionMode(ctx, execution))?.reason
      } catch (error) {
        // Fail closed. A gate that cannot classify a write must not wave it
        // through, and the reason says so rather than blaming the call.
        const detail = error instanceof Error ? error.message : String(error)
        return (
          `virtuoso-layout write gate failed to classify this call (${detail}), so it was not ` +
          'executed and nothing was written. Report this instead of retrying: the gate is broken, not the call.'
        )
      }
    })
    report.installed = true
    report.defaultMode = permissionMode(ctx, undefined)
    report.enforcedByDefault = report.defaultMode !== 'danger-full-access'
    report.detail = 'registered with ctx.tools.guard(); it can only deny, never allow'
  } catch (error) {
    report.detail = `ctx.tools.guard() threw: ${error instanceof Error ? error.message : String(error)}`
    ctx?.logger?.warn?.(`[virtuoso-layout] write gate registration failed: ${report.detail}`)
  }
  report.summary = summaryOf(report)
  ctx?.logger?.info?.(`[virtuoso-layout] ${report.summary}`)
  return report
}
