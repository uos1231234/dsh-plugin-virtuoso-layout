/**
 * The write gate, offline.
 *
 * Three layers are checked, because a gate can be wrong at any of them and only
 * the last one is what the model actually meets:
 *
 *  1. classification — does the text of a call look like a write?
 *  2. policy        — is a write denied, and is danger-full-access really free?
 *  3. registration  — does `apply()` install a guard, and does `virtuoso_status`
 *                     report what that guard would do in this session?
 *
 * Run: node .validate/guard-test.mjs
 */
import { jsonSafe } from '../dsh-plugin-virtuoso-layout/lib/virtuoso.js'
import {
  confirmationToken,
  evaluateWrite,
  installWriteGuard,
  permissionMode,
  writeIntent,
} from '../dsh-plugin-virtuoso-layout/lib/guard.js'

let failed = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  ok   -', label)
    return
  }
  failed += 1
  console.log('  FAIL -', label, detail === undefined ? '' : `(${detail})`)
}

const fixture = new URL('./fixtures/write-probe.il', import.meta.url).pathname.replace(/^\//, '')

console.log('\n[1] classification: what looks like a write')
for (const [label, skill] of [
  ['dbSave', '(dbSave cv)'],
  ['dbCreateRect', '(dbCreateRect cv list("M1" "drawing") list(list(0 0) list(1 1)))'],
  ['dbDeleteFig', '(dbDeleteFig cv fig)'],
  ['ddCreateLib', '(ddCreateLib "X" "<GUEST_HOME>/X")'],
  ['techBindTechFile', '(techBindTechFile lib "VB_DEMO")'],
  ['leHiEditInPlace', '(leHiEditInPlace)'],
]) {
  const intent = writeIntent('virtuoso_eval', { skill })
  check(`detects ${label}`, intent !== undefined && intent.calls.length > 0, JSON.stringify(intent))
}
check(
  'names the call it found',
  writeIntent('virtuoso_eval', { skill: '(dbCreateRect cv a b)' })?.calls[0] === 'dbCreateRect',
)
for (const [label, skill] of [
  ['a read of the design database', '(geGetEditCellView)'],
  ['a shapes walk', 'cv~>shapes'],
  ['a read-mode open', '(dbOpenCellViewByType lib cell "layout" "maskLayout" "r")'],
  ['a pure computation', '(plus 1 2)'],
]) {
  check(`ignores ${label}`, writeIntent('virtuoso_eval', { skill }) === undefined)
}
check('ignores a call with neither skill nor file', writeIntent('virtuoso_eval', {}) === undefined)
check('ignores another tool entirely', writeIntent('bash', { command: 'rm -rf /' }) === undefined)

console.log('\n[2] classification: `file` wins over `skill`, as `execute` does')
const fromFile = writeIntent('virtuoso_eval', { file: fixture })
check('reads the file payload', fromFile !== undefined && fromFile.calls.includes('dbCreateRect'), JSON.stringify(fromFile))
check(
  'file beats a harmless inline skill',
  writeIntent('virtuoso_eval', { skill: '(plus 1 2)', file: fixture }) !== undefined,
)
check(
  'an unreadable file is left ungated (execute reports it)',
  writeIntent('virtuoso_eval', { file: 'C:/definitely/not/here.il' }) === undefined,
)

console.log('\n[3] classification: guest shell writes')
for (const [label, command] of [
  ['mkdir', 'mkdir -p /tmp/probe'],
  ['rm', 'rm -f /tmp/probe'],
  ['output redirection', 'ls -la <GUEST_HOME> > /tmp/listing.txt'],
  ['append redirection', 'cat a >> b'],
  ['stderr redirection', 'run 2> /tmp/err.log'],
  ['in-place sed', 'sed -i s/a/b/ /tmp/f'],
  ['tee', 'echo x | tee /tmp/x'],
]) {
  check(`detects ${label}`, writeIntent('virtuoso_run', { command }) !== undefined, command)
}
for (const [label, command] of [
  ['a plain probe', 'sleep 20; echo JOBDONE'],
  ['stderr merged into stdout', 'echo hi 2>&1'],
  ['a greater-than comparison', 'awk "$1 >= 2" /tmp/f'],
  ['a read', 'cat /tmp/f'],
]) {
  check(`ignores ${label}`, writeIntent('virtuoso_run', { command }) === undefined, command)
}
check('ignores an empty command', writeIntent('virtuoso_run', { command: '   ' }) === undefined)

console.log('\n[4] the token binds to the payload')
const a = confirmationToken('(dbSave cv)')
check('is eight hex characters', /^[0-9a-f]{8}$/.test(a), a)
check('is stable for the same payload', a === confirmationToken('(dbSave cv)'))
check('changes with the payload', a !== confirmationToken('(dbSave cv) '))

console.log('\n[5] policy: a write in danger-full-access is free, elsewhere it is confirmed')
const write = { callId: 'c1', name: 'virtuoso_eval', arguments: { skill: '(dbSave cv)' } }
check('abstains in danger-full-access', evaluateWrite(write, 'danger-full-access') === undefined)

const denied = evaluateWrite(write, 'workspace-write')
check('denies in workspace-write', typeof denied?.reason === 'string')
check('says it blocked before execution', denied.reason.includes('BLOCKED before execution'))
check('names the call it found', denied.reason.includes('dbSave'))
check('names the mode', denied.reason.includes('workspace-write'))
check('carries the token', denied.reason.includes(confirmationToken('(dbSave cv)')), denied.reason)

const confirmed = { ...write, arguments: { ...write.arguments, confirm: confirmationToken('(dbSave cv)') } }
check('the right token passes', evaluateWrite(confirmed, 'workspace-write') === undefined)
check(
  'a token for different text does not pass',
  evaluateWrite({ ...write, arguments: { skill: '(dbSave cv)', confirm: confirmationToken('other') } }, 'workspace-write') !== undefined,
)
check(
  'a boolean "confirm: true" is not a token',
  evaluateWrite({ ...write, arguments: { skill: '(dbSave cv)', confirm: true } }, 'workspace-write') !== undefined,
)
check(
  'the token is case-insensitive',
  evaluateWrite({ ...write, arguments: { skill: '(dbSave cv)', confirm: confirmationToken('(dbSave cv)').toUpperCase() } }, 'workspace-write') === undefined,
)
const wrong = evaluateWrite({ ...write, arguments: { skill: '(dbSave cv)', confirm: 'deadbeef' } }, 'workspace-write')
check('a wrong token is named in the reason', wrong.reason.includes('deadbeef'))
check('an unknown mode fails closed', evaluateWrite(write, undefined) !== undefined)
check(
  'the closed reason says so',
  evaluateWrite(write, undefined).reason.includes('fails closed'),
)
check('a read-only call is never denied', evaluateWrite({ name: 'virtuoso_eval', arguments: { skill: '(plus 1 2)' } }, 'read-only') === undefined)
check(
  'the guard also holds for guest shell',
  evaluateWrite({ name: 'virtuoso_run', arguments: { command: 'rm -rf <GUEST_HOME>/DSH_LAYOUT' } }, 'workspace-write') !== undefined,
)

console.log('\n[6] registration: the guard reaches the harness')
const registered = []
const guards = []
const session = { id: 'session-x' }
const policy = { override: undefined, mode: 'workspace-write', broken: false }
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
    guard(fn) {
      guards.push(fn)
      return () => {}
    },
  },
  workspaceRegistry: { async create(path) { return { id: 'ws-1', path } } },
  logger: { info() {}, warn: (message) => console.error('  plugin.warn:', message) },
  get(name) {
    if (name !== 'sandboxPolicy') return undefined
    if (policy.broken) return { defaultMode: undefined, resolve() { throw new Error('policy exploded') } }
    return {
      defaultMode: policy.mode,
      resolve: () => ({ mode: policy.mode }),
      overrideOf: () => policy.override,
    }
  },
}

const report = installWriteGuard(ctx)
check('installs exactly one guard', guards.length === 1, `guards=${guards.length}`)
check('reports itself installed', report.installed === true)
check('reports the deployment mode', report.defaultMode === 'workspace-write', report.defaultMode)
check('reports that confirmation is enforced by default', report.enforcedByDefault === true)
check('survives jsonSafe unchanged', JSON.stringify(jsonSafe(report)) === JSON.stringify(report))
check('carries no function or undefined', !JSON.stringify(report).includes('function'))

const guard = guards[0]
check('abstains for a tool it does not guard', guard({ name: 'read', arguments: { path: 'x' } }) === undefined)
check('abstains for read-only SKILL', guard({ name: 'virtuoso_eval', arguments: { skill: '(plus 1 2)' } }) === undefined)
check('denies a mutating eval in workspace-write', typeof guard({ ...write, agent: { session } }) === 'string')
policy.override = 'danger-full-access'
check('abstains once the session is danger-full-access', guard({ ...write, agent: { session } }) === undefined)
policy.override = 'read-only'
check('denies again when the session drops to read-only', typeof guard({ ...write, agent: { session } }) === 'string')
policy.override = undefined
const thrown = guard({ name: 'virtuoso_eval', get arguments() { throw new Error('boom') } })
check('a guard that cannot classify fails closed', typeof thrown === 'string' && thrown.includes('failed to classify'), thrown)

const noGuardCtx = { ...ctx, tools: { register: ctx.tools.register }, logger: { info() {}, warn() {} } }
const degraded = installWriteGuard(noGuardCtx)
check('a composition without tools.guard degrades instead of throwing', degraded.installed === false)
check('and says why', degraded.detail.includes('guard is unavailable'), degraded.detail)

policy.broken = true
const brokenReport = installWriteGuard(ctx)
check('an unreadable policy still installs the gate', brokenReport.installed === true)
check('and fails closed by default', brokenReport.enforcedByDefault === true)
check(
  'and denies rather than allowing',
  typeof guards[guards.length - 1]({ ...write, agent: { session } }) === 'string',
)
policy.broken = false

console.log('\n[7] permissionMode reads the session before the deployment default')
check('prefers the session override', permissionMode(ctx, { agent: { session } }) === 'workspace-write')
policy.override = 'danger-full-access'
check('follows a danger-full-access session', permissionMode(ctx, { agent: { session } }) === 'danger-full-access')
policy.override = undefined
check('falls back to the deployment default with no execution', permissionMode(ctx, undefined) === 'workspace-write')
check('and with no sandboxPolicy service', permissionMode({ get: () => undefined }, undefined) === undefined)

console.log('\n[8] `apply()` wires the gate into the plugin, and status reports it')
const applyRegistered = []
const applyGuards = []
const applyCtx = {
  tools: {
    register(definition) {
      applyRegistered.push(definition)
      return () => {}
    },
    guard(fn) {
      applyGuards.push(fn)
      return () => {}
    },
  },
  workspaceRegistry: { async create(path) { return { id: 'ws-1', path } } },
  logger: { info() {}, warn: (message) => console.error('  plugin.warn:', message) },
  get: () => ({ defaultMode: 'danger-full-access', resolve: () => ({ mode: 'danger-full-access' }), overrideOf: () => undefined }),
}
const plugin = await import(new URL('../dsh-plugin-virtuoso-layout/lib/index.js', import.meta.url).href)
plugin.apply(applyCtx)
check('registers twelve tools', applyRegistered.length === 12, `tools=${applyRegistered.length}`)
check('registers one write guard', applyGuards.length === 1, `guards=${applyGuards.length}`)
const statusDef = applyRegistered.find((d) => d.name === 'virtuoso_status')
check('status declares writeGuard in its output', 'writeGuard' in (statusDef.output.schema.properties ?? {}))
const evalDef = applyRegistered.find((d) => d.name === 'virtuoso_eval')
const runDef = applyRegistered.find((d) => d.name === 'virtuoso_run')
check('virtuoso_eval accepts confirm', evalDef.parameters.properties.confirm?.type === 'string')
check('virtuoso_run accepts confirm', runDef.parameters.properties.confirm?.type === 'string')

const status = await statusDef.execute({ deep: false }, { agent: { session } })
check('status reports the gate', status.writeGuard?.installed === true, JSON.stringify(status.writeGuard))
check('status reports this session would not have to confirm', status.writeGuard.enforcedNow === false, JSON.stringify(status.writeGuard))
check('status reports the gate summary', typeof status.writeGuard.summary === 'string')
check('the guard really abstains here', applyGuards[0]({ ...write, agent: { session } }) === undefined)

console.log(failed === 0 ? '\nguard-test: all checks passed\n' : `\nguard-test: ${failed} check(s) FAILED\n`)
process.exit(failed === 0 ? 0 : 1)
