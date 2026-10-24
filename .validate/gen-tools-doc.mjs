/**
 * Generate TOOLS.md from the live plugin definitions.
 *
 * The table is derived from the same `register()` payload DSH consumes, so it
 * cannot drift from the shipped tools. Run after changing any description,
 * parameter, or output schema:
 *
 *   node .validate/gen-tools-doc.mjs
 */
import { writeFile } from 'node:fs/promises'

const pluginUrl = new URL('../dsh-plugin-virtuoso-layout/lib/index.js', import.meta.url).href
const outUrl = new URL('../TOOLS.md', import.meta.url)

const registered = []
const ctx = {
  tools: { register(definition) { registered.push(definition); return () => {} } },
  workspaceRegistry: { async create(path, title) { return { id: 'ws-1', path, title } } },
  logger: { warn: () => {}, info: () => {} },
}
const mod = await import(pluginUrl)
mod.apply(ctx)

// Hand-maintained: what each tool changes, and the safe order to use it in.
// Everything else in this file is generated.
const NOTES = {
  workspace_create: ['no', 'Registers a directory in the sidebar; touches the workspace registry only.'],
  virtuoso_status: ['no', 'Read-only. Always the first call after any layout failure.'],
  virtuoso_config: ['host file', 'Writes ~/.dsh/virtuoso-layout.json; applied on the next call, no restart.'],
  virtuoso_vm: ['yes', 'start/up/down change VM power state. `up` is the one-call repair.'],
  virtuoso_recover: ['guest GUI', 'Suspends the screensaver and dismisses dialogs, then proves the CIW answers.'],
  virtuoso_windows: ['no', 'Read-only window census.'],
  virtuoso_screenshot: ['host file', 'Writes one PNG into the configured artifact directory.'],
  host_window: [
    'host file',
    'raise/capture may move or resize a Windows window and write one PNG. `list` is read-only. ' +
      'This is the host desktop, not the guest: use virtuoso_screenshot for Virtuoso content.',
  ],
  virtuoso_eval: ['yes', 'Runs arbitrary SKILL: it can create, modify and DELETE design data.'],
  virtuoso_run: ['yes', 'Runs an arbitrary guest shell command, normally in the background.'],
  virtuoso_drc: ['no', 'Parses an existing Calibre result file; runs no tool.'],
  context_usage: [
    'no',
    'Read-only, and a DSH measurement rather than a layout one: it reports this session`s token budget ' +
      'from the harness token meter and never touches the VM.',
  ],
}

const firstSentence = (text) => {
  const match = String(text).match(/^[^.]*\./)
  return (match === null ? String(text) : match[0]).trim()
}
const esc = (text) => String(text).replace(/\|/g, '\\|').replace(/\n+/g, ' ')

const lines = []
lines.push('# Layout tool reference')
lines.push('')
lines.push(
  `Generated from the live plugin definitions by \`.validate/gen-tools-doc.mjs\` — ` +
    `${registered.length} tools, do not edit by hand. Re-run the script after changing a ` +
    'description, parameter or output schema.',
)
lines.push('')
lines.push(
  'Every tool returns lossless JSON. Failures are either thrown (bad arguments, missing files) or ' +
    'returned as `ok: false` (operational results such as a failed SKILL program), and every ' +
    'recognised failure carries a `Hint:` naming the next action — see the last section.',
)
lines.push('')

lines.push('## At a glance')
lines.push('')
lines.push('| Tool | What it does | Changes |')
lines.push('| --- | --- | --- |')
for (const definition of registered) {
  const note = NOTES[definition.name] ?? ['?', '']
  lines.push(`| \`${definition.name}\` | ${esc(firstSentence(definition.description))} | ${esc(note[0])} |`)
}
lines.push('')

lines.push('## Tools in detail')
lines.push('')
for (const definition of registered) {
  const note = NOTES[definition.name] ?? ['?', '']
  lines.push(`### \`${definition.name}\``)
  lines.push('')
  lines.push(definition.description)
  lines.push('')
  lines.push(`- Effect: ${note[1]}`)
  if (definition.timeoutMs !== undefined) lines.push(`- Timeout: ${definition.timeoutMs} ms`)
  const properties = definition.parameters?.properties ?? {}
  const required = new Set(definition.parameters?.required ?? [])
  const keys = Object.keys(properties)
  if (keys.length === 0) {
    lines.push('- Arguments: none')
  } else {
    lines.push('')
    lines.push('| Argument | Type | Required | Meaning |')
    lines.push('| --- | --- | --- | --- |')
    for (const key of keys) {
      const property = properties[key]
      const type = property.enum === undefined ? String(property.type ?? 'any') : `enum(${property.enum.join(', ')})`
      lines.push(
        `| \`${key}\` | ${esc(type)} | ${required.has(key) ? 'yes' : 'no'} | ${esc(property.description ?? '')} |`,
      )
    }
  }
  const schema = definition.output?.schema ?? {}
  const outputKeys = Object.keys(schema.properties ?? {})
  lines.push('')
  lines.push(
    outputKeys.length === 0
      ? '- Returns: an unconstrained JSON value'
      : `- Returns: ${outputKeys.map((key) => `\`${key}\``).join(', ')}` +
          (Array.isArray(schema.required) && schema.required.length > 0
            ? ` (always present: ${schema.required.map((key) => `\`${key}\``).join(', ')})`
            : ''),
  )
  lines.push('')
}

lines.push('## Failure feedback')
lines.push('')
lines.push(
  'Failures are diagnosed centrally, so every tool reports them the same way and the operational ' +
    'knowledge does not depend on the caller remembering a runbook. A thrown error gains a final ' +
    '`Hint:` line; a returned failure gains `errorKind`, `errorText` and `hint` fields.',
)
lines.push('')
lines.push('| Signature in the raw failure | Hint attached |')
lines.push('| --- | --- |')
const { hintFor } = await import('../dsh-plugin-virtuoso-layout/lib/virtuoso.js')
const signatures = [
  ['`ECONNREFUSED`', 'connect ECONNREFUSED 127.0.0.1:65453'],
  ['socket timeout / no answer', 'no answer: socket said the daemon reported a timeout'],
  ['`error while loading file`', '("load" 0 t nil ("*Error* load: error while loading file - x at line 5"))'],
  ['`ENOENT` / no such file', "ENOENT: no such file or directory, open 'x'"],
  ['SSH auth failure', 'Permission denied (publickey,password).'],
  ['`not lossless JSON`', 'value is not lossless JSON'],
]
for (const [label, sample] of signatures) {
  lines.push(`| ${label} | ${esc(firstSentence(hintFor(sample)))} |`)
}
lines.push('')
lines.push(
  'A DRC parse failure additionally lists the Calibre result files that *do* exist in the same ' +
    'directory, so a mistyped path is recoverable from the error itself.',
)
lines.push('')

await writeFile(outUrl, `${lines.join('\n')}`, 'utf8')
console.log(`wrote TOOLS.md: ${registered.length} tools, ${lines.length} lines`)
