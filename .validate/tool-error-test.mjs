/**
 * Tool-layer error-feedback test.
 *
 * Registers the real plugin against a mock ctx — the same shape plugin-test.mjs
 * uses — and then calls the real `execute` of the tools whose failure paths must
 * be actionable. This proves the hint layer end to end without a DSH restart.
 *
 * Run: node .validate/tool-error-test.mjs [drcDir]
 */
const pluginUrl = new URL('../dsh-plugin-virtuoso-layout/lib/index.js', import.meta.url).href

const registered = new Map()
const ctx = {
  tools: {
    register(definition) {
      registered.set(definition.name, definition)
      return () => {}
    },
  },
  workspaceRegistry: { async create(path, title) { return { id: 'ws-1', path, title } } },
  logger: { warn: (m) => console.error('  plugin.warn:', m), info: () => {} },
}

const mod = await import(pluginUrl)
mod.apply(ctx)
console.log(`registered ${registered.size} tools\n`)

let fails = 0
const call = (tool, args) => registered.get(tool).execute(args, {})

async function expectThrow(label, tool, args, fragments) {
  try {
    const value = await call(tool, args)
    console.log(`FAIL  ${label}: expected a throw, got ${JSON.stringify(value).slice(0, 160)}`)
    fails += 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const missing = fragments.filter((fragment) => !message.includes(fragment))
    if (missing.length > 0) {
      console.log(`FAIL  ${label}: message lacks ${missing.join(' | ')}\n      got: ${message}`)
      fails += 1
    } else {
      console.log(`PASS  ${label}\n      ${message.split('\n').join('\n      ')}`)
    }
  }
}

async function expectReturn(label, tool, args, check) {
  try {
    const value = await call(tool, args)
    const problem = check(value)
    if (problem) {
      console.log(`FAIL  ${label}: ${problem}\n      got: ${JSON.stringify(value).slice(0, 300)}`)
      fails += 1
    } else {
      console.log(`PASS  ${label}\n      ok=${value.ok} kind=${value.errorKind} text=${value.errorText}`)
    }
  } catch (error) {
    console.log(`FAIL  ${label}: threw ${error instanceof Error ? error.message : String(error)}`)
    fails += 1
  }
}

// ── argument validation: every message must name the fix ────────────────────
await expectThrow('drc: empty path', 'virtuoso_drc', { path: '   ' }, ['non-empty'])
await expectThrow('eval: neither skill nor file', 'virtuoso_eval', {}, ['needs `skill` or `file`'])
await expectThrow('config: unknown action', 'virtuoso_config', { action: 'nonsense' }, ['unknown virtuoso_config action'])
await expectThrow('config: unknown key', 'virtuoso_config', { action: 'set', settings: { nope: 1 } }, [
  'unknown setting',
  'known keys',
])
await expectThrow('vm: unknown action', 'virtuoso_vm', { action: 'levitate' }, ['unknown virtuoso_vm action'])

// ── missing file: the error must say where it is and what does exist ────────
const drcDir = process.argv[2]
// A missing file *in* the given directory, so the sibling-candidate branch has a
// directory to list. Pointing outside it would skip that branch entirely.
const missing = drcDir === undefined ? 'C:\\definitely\\not\\here.drc.summary' : `${drcDir}\\here-missing.drc.summary`
await expectThrow('drc: missing file', 'virtuoso_drc', { path: missing }, ['cannot parse', 'ENOENT', 'Hint:'])

// ── a live SKILL failure must come back classified, not raw ────────────────
await expectReturn('eval: invalid SKILL', 'virtuoso_eval', { skill: 'this-is-not-valid-skill(' }, (value) => {
  if (value.ok !== false) return 'expected ok=false'
  if (value.errorKind !== 'skill-load') return `expected errorKind skill-load, got ${value.errorKind}`
  if (typeof value.hint !== 'string' || value.hint.length === 0) return 'no hint attached'
  if (typeof value.errorText !== 'string') return 'no errorText extracted'
  return ''
})

console.log(fails === 0 ? '\nALL ERROR-FEEDBACK CHECKS PASSED' : `\n${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)
