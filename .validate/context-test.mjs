/**
 * Offline test for the one DSH-level tool in this bundle, `context_usage`.
 *
 * It needs a different mock ctx from plugin-test.mjs: `context_usage` reads its
 * services through ctx.get(), and it must behave sanely when those services, the
 * calling agent, or the provider's context window are absent. Every returned value
 * is also walked for non-lossless JSON, because a single `undefined` property makes
 * the whole tool call fail at the harness boundary.
 *
 * Run: node .validate/context-test.mjs
 */
const pluginUrl = new URL('../dsh-plugin-virtuoso-layout/lib/index.js', import.meta.url).href

const mod = await import(pluginUrl)

/** Register the real plugin against a mock ctx that owns `services`. */
function harness(services) {
  const tools = new Map()
  mod.apply({
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => {}
      },
    },
    workspaceRegistry: { async create() { return { id: 'ws-1' } } },
    logger: { warn: (m) => console.error('  plugin.warn:', m), info: () => {} },
    get: (key) => services[key],
  })
  const tool = tools.get('context_usage')
  if (tool === undefined) throw new Error('context_usage was not registered')
  return (args, exec) => tool.execute(args, exec)
}

/** Collect every value the harness could not round-trip through JSON. */
function badJson(path, value, problems) {
  if (value === undefined) return void problems.push(`${path} = undefined`)
  if (typeof value === 'function' || typeof value === 'symbol') return void problems.push(`${path} = ${typeof value}`)
  if (typeof value === 'bigint') return void problems.push(`${path} = bigint`)
  if (typeof value === 'number' && !Number.isFinite(value)) return void problems.push(`${path} = ${value}`)
  if (Array.isArray(value)) return void value.forEach((item, i) => badJson(`${path}[${i}]`, item, problems))
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) badJson(`${path}.${key}`, item, problems)
  }
}

const session = {
  id: 'session-test',
  requestContext: () => ({ provider: 'deepseek', model: 'deepseek-flash', contextWindow: 200000 }),
}
const measurement = {
  logRevision: { revision: 42 },
  baseline: { kind: 'usage', tokens: 10000 },
  surfaceDeltaTokens: 1200,
  totalTokens: 150000,
  surfaceTokens: 140000,
  nodes: [
    { seq: 3, tokens: 100, heuristicTokens: 90 },
    { seq: 9, tokens: 60000, heuristicTokens: 5 },
    { seq: 12, tokens: 5000, heuristicTokens: 5 },
  ],
}
const services = {
  tokenMeter: { measure: () => measurement },
  sessions: { get: (id) => (id === 'session-test' ? session : undefined) },
}
const call = harness(services)

let fails = 0
let checks = 0

function check(label, condition, detail) {
  checks += 1
  if (condition) console.log(`PASS  ${label}`)
  else {
    console.log(`FAIL  ${label}\n      ${detail}`)
    fails += 1
  }
}

async function report(label, args, exec, caller = call) {
  const value = await caller(args, exec)
  const problems = []
  badJson('result', value, problems)
  check(`${label}: lossless JSON`, problems.length === 0, problems.join(', '))
  return value
}

// ── the happy path, and the identity channel it used ────────────────────────
const live = await report('exec.agent', {}, { agent: { id: 'session-test' } })
check('exec.agent: ok', live.ok === true, JSON.stringify(live))
check('exec.agent: source', live.source === 'exec.agent', live.source)
check('exec.agent: sessionId', live.sessionId === 'session-test', live.sessionId)
check('exec.agent: used = totalTokens', live.used === 150000, String(live.used))
check('exec.agent: window', live.contextWindow === 200000, String(live.contextWindow))
check('exec.agent: remaining', live.remaining === 50000, String(live.remaining))
check('exec.agent: percent', live.percent === 75, String(live.percent))
check('exec.agent: 75% is high, not moderate', live.pressure === 'high', String(live.pressure))
check('exec.agent: baseline', live.baselineTokens === 10000 && live.baselineKind === 'usage', JSON.stringify(live))
check('exec.agent: provider/model', live.provider === 'deepseek' && live.model === 'deepseek-flash', live.model)
check('exec.agent: contributors sorted desc', live.contributors[0].seq === 9, JSON.stringify(live.contributors))
check('exec.agent: all nodes listed', live.contributors.length === 3, String(live.contributors.length))
check('exec.agent: raw measurement withheld', live.measurement === undefined, 'measurement was returned')
check('exec.agent: summary is one line', typeof live.summary === 'string' && !live.summary.includes('\n'), live.summary)
console.log(`      summary: ${live.summary}`)
check('exec.agent: high pressure carries a hint', typeof live.hint === 'string' && live.hint.includes('grep'), live.hint)

const top1 = await report('top=1', { top: 1 }, { agent: { id: 'session-test' } })
check('top=1: truncated', top1.contributors.length === 1, String(top1.contributors.length))

const full = await report('full=true', { full: true }, { agent: { id: 'session-test' } })
check('full=true: raw measurement present', full.measurement?.totalTokens === 150000, JSON.stringify(full.measurement))
check('full=true: summary unchanged', full.summary === live.summary, full.summary)

const clamped = await report('top=999 clamped', { top: 999 }, { agent: { id: 'session-test' } })
check('top=999: clamped, not a crash', clamped.ok === true && clamped.contributors.length === 3, JSON.stringify(clamped.contributors))

// ── the fallback channel, and its absence ──────────────────────────────────
const initiatorCall = harness({
  ...services,
  agents: { currentInitiator: () => ({ id: 'session-test' }) },
})
const viaInitiator = await report('initiator fallback', {}, undefined, initiatorCall)
check('initiator fallback: source', viaInitiator.source === 'agents.currentInitiator', String(viaInitiator.source))
check('initiator fallback: still measured', viaInitiator.used === 150000, String(viaInitiator.used))

const lost = await report('no agent anywhere', {}, {})
check('no agent: ok is false', lost.ok === false, JSON.stringify(lost))
check('no agent: does not throw', typeof lost.summary === 'string', lost.summary)
check('no agent: names both channels', lost.detail.includes('exec.agent') && lost.detail.includes('currentInitiator'), lost.detail)
check('no agent: hint present', typeof lost.hint === 'string' && lost.hint.length > 20, String(lost.hint))

const unknownSession = harness({ ...services, sessions: { get: () => undefined } })
const stranger = await unknownSession({}, { agent: { id: 'session-other' } })
check('unknown session: ok is false', stranger.ok === false, JSON.stringify(stranger))
check('unknown session: detail names the attempt', stranger.detail.includes('session-other'), stranger.detail)

// ── a composition without the services must explain itself, not throw ───────
const bare = harness({})
const unmeasurable = await report('no services', {}, { agent: { id: 'session-test' } }, bare)
check('no services: ok is false', unmeasurable.ok === false, JSON.stringify(unmeasurable))
check(
  'no services: names both services',
  unmeasurable.summary.includes('tokenMeter.measure') && unmeasurable.summary.includes('sessions.get'),
  unmeasurable.summary,
)
check('no services: detail reports the types', unmeasurable.detail.includes('undefined'), String(unmeasurable.detail))
check('no services: hint present', typeof unmeasurable.hint === 'string', String(unmeasurable.hint))

// ── a provider that declares no window still reports a usable number ───────
const noWindow = harness({
  ...services,
  sessions: { get: () => ({ id: 'session-test', requestContext: () => ({ provider: 'p', model: 'm' }) }) },
})
const bare2 = await noWindow({}, { agent: { id: 'session-test' } })
check('no window: still ok', bare2.ok === true, JSON.stringify(bare2))
check('no window: used survived', bare2.used === 150000, String(bare2.used))
check('no window: no percent', bare2.percent === undefined && bare2.pressure === undefined, JSON.stringify(bare2))
check('no window: summary says so', bare2.summary.includes('no context window'), bare2.summary)

// ── threshold edges ────────────────────────────────────────────────────────
for (const [tokens, percent, pressure] of [
  [40000, 20, 'low'],
  [149999, 75, 'high'],
  [179999, 90, 'critical'],
]) {
  const edge = harness({
    tokenMeter: { measure: () => ({ ...measurement, totalTokens: tokens }) },
    sessions: services.sessions,
  })
  const value = await edge({}, { agent: { id: 'session-test' } })
  check(
    `edge ${tokens}: ${percent}% ${pressure}`,
    value.percent === percent && value.pressure === pressure,
    `${value.percent}% ${value.pressure}`,
  )
}

// ── a requestContext() that throws must not cost us the token total ────────
const angry = harness({
  tokenMeter: { measure: () => measurement },
  sessions: {
    get: () => ({
      id: 'session-test',
      requestContext: () => {
        throw new Error('no request context yet')
      },
    }),
  },
})
const angryResult = await report('throwing requestContext', {}, { agent: { id: 'session-test' } }, angry)
check(
  'throwing requestContext: total survives',
  angryResult.ok === true && angryResult.used === 150000,
  JSON.stringify(angryResult),
)
check(
  'throwing requestContext: no percent claimed',
  angryResult.percent === undefined && angryResult.pressure === undefined,
  JSON.stringify(angryResult),
)
check('throwing requestContext: hint says why', String(angryResult.hint).includes('requestContext'), String(angryResult.hint))
check('throwing requestContext: detail keeps the message', String(angryResult.detail).includes('no request context yet'), String(angryResult.detail))
console.log(`      summary: ${angryResult.summary}`)

console.log(
  fails === 0
    ? `\nALL ${checks} CHECKS PASSED`
    : `\nFAILURES (${fails} of ${checks}):\n${''}`,
)
process.exit(fails === 0 ? 0 : 1)
