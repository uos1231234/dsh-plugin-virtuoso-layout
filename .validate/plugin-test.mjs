/**
 * Offline harness for the plugin: register against a mock ctx, then call the
 * tools. Catches schema-shape and logic errors without restarting DSH.
 *
 * Run: node .validate/plugin-test.mjs
 */
const pluginUrl = new URL(
  '../dsh-plugin-virtuoso-layout/lib/index.js',
  import.meta.url,
).href

const registered = []
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  },
  workspaceRegistry: {
    async create(path, title) {
      return { id: 'ws-1', path, ...(title === undefined ? {} : { title }) }
    },
  },
  logger: { warn: (message) => console.error('  plugin.warn:', message) },
}

const mod = await import(pluginUrl)
console.log('exports:', Object.keys(mod).sort().join(', '))
mod.apply(ctx)

console.log('registered tools:', registered.map((d) => d.name).join(', '))
const failures = []

// Every definition must satisfy what dsh-tools' register() asserts.
for (const d of registered) {
  if (typeof d.name !== 'string' || d.name.length === 0) failures.push(`${d.name}: bad name`)
  if (typeof d.output?.render !== 'function') failures.push(`${d.name}: output.render missing`)
  if (d.output?.schema === undefined) failures.push(`${d.name}: output.schema missing`)
  if (typeof d.execute !== 'function') failures.push(`${d.name}: execute missing`)
  if (d.parameters !== undefined) {
    if (d.parameters.type !== 'object') failures.push(`${d.name}: parameters.type must be object`)
    if (Array.isArray(d.parameters.required)) {
      const props = Object.keys(d.parameters.properties ?? {})
      for (const key of d.parameters.required) {
        if (!props.includes(key)) failures.push(`${d.name}: required "${key}" has no property`)
      }
    }
  }
  // Raw JSON Schema must not carry the authoring DSL's per-property `required`.
  for (const [key, prop] of Object.entries(d.parameters?.properties ?? {})) {
    if (typeof prop === 'object' && prop !== null && 'required' in prop) {
      failures.push(`${d.name}.${key}: parameter uses DSL 'required' inside a property`)
    }
  }
}

const byName = new Map(registered.map((d) => [d.name, d]))

// 1. workspace_create still behaves.
const ws = await byName.get('workspace_create').execute({ path: 'C:/tmp/x', title: 'T' })
console.log('workspace_create ->', JSON.stringify(ws))
if (ws.id !== 'ws-1') failures.push('workspace_create did not project the registry result')

// 2. virtuoso_status runs against the real machine (VM is down, so it must be fast and non-throwing).
const status = await byName.get('virtuoso_status').execute({})
console.log('virtuoso_status ->', status.summary)
if (typeof status.summary !== 'string' || status.summary.length === 0) failures.push('virtuoso_status: empty summary')
if (status.vm === undefined || status.guest === undefined) failures.push('virtuoso_status: missing vm/guest')

// 3. virtuoso_drc against real Calibre output, including cross-validation.
//    A real run is what makes this a test rather than a tautology: point
//    DSH_DRC_FIXTURES at a directory holding a matched `<name>.drc.summary` and
//    `<name>.drc.results`. Without it this section reports SKIP rather than
//    pretending to pass. Calibre results carry foundry rule text, so they are
//    deliberately not shipped in this repository.
const drc = byName.get('virtuoso_drc')
const drcDir = (process.env.DSH_DRC_FIXTURES ?? '').replace(/[\\/]+$/, '')
if (drcDir === '') {
  console.log('virtuoso_drc -> SKIP (set DSH_DRC_FIXTURES=<dir> to exercise the parser)')
} else {
  const base = `${drcDir}/work`
  const parsed = await drc.execute({ path: `${base}.drc.summary` })
  console.log('virtuoso_drc ->', JSON.stringify({ kind: parsed.kind, cell: parsed.cell, totals: parsed.totals }))
  if (parsed.totals.violations !== 273) failures.push(`virtuoso_drc: expected 273 violations, got ${parsed.totals.violations}`)

  const compared = await drc.execute({ path: `${base}.drc.summary`, compareWith: `${base}.drc.results` })
  console.log('virtuoso_drc compare ->', JSON.stringify(compared.comparison))
  if (compared.comparison?.agreement !== true) failures.push('virtuoso_drc: cross-validation did not agree')

  // A disagreement must surface as an error, not silently pass.
  try {
    await drc.execute({
      path: `${base}.drc.summary`,
      compareWith: `${drcDir}/nmos.drc.results`,
    })
    failures.push('virtuoso_drc: mismatched files did NOT raise')
  } catch {
    console.log('virtuoso_drc mismatch -> correctly raised')
  }
}

// 4. Bad input must be a clear error.
for (const [tool, args] of [
  ['virtuoso_drc', { path: '' }],
  ['workspace_create', { path: '' }],
]) {
  try {
    await byName.get(tool).execute(args)
    failures.push(`${tool}: empty path did not raise`)
  } catch (error) {
    console.log(`${tool} empty path -> ${String(error.message).slice(0, 60)}`)
  }
}

console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\nFAILURES:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
process.exit(failures.length === 0 ? 0 : 1)
