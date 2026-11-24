import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { runLayoutAction } from './layout-flow.js'
import { loadConfig } from './virtuoso.js'

const help = `Usage: node tools/virtuoso.mjs layout <command> [options]

  read --lib LIB --cell CELL [--view schematic]  Read a saved Virtuoso schematic.
  plan --spec PLACEMENT.json [READ.json|-]       Validate placement against that schematic.
  build [PLAN.json|-]                           Export source CDL and write a new layout.
  verify [BUILD.json|-] --pdk PROFILE.json      Run Calibre on the identified build.
  extract [VERIFY.json|-] --pdk PROFILE.json     Extract parasitics in the verified process stack.
  simulate [PEX.json|-] --bench BENCH.json      Run matched pre-layout and post-layout Spectre tests.

JSON input is read from the named file or stdin. Stdout is one JSON record.
Exit codes: 0 success, 1 declared constraint or design check failed, 2 invalid input or operational error.
`

const textOption = { type: 'string' }
const options = {
  read: { lib: textOption, cell: textOption, view: textOption },
  plan: { spec: textOption },
  build: {},
  verify: { pdk: textOption },
  extract: { pdk: textOption },
  simulate: { bench: textOption },
}

async function readJson(file, stdin) {
  let data
  if (file === '-') {
    const chunks = []
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk))
    data = Buffer.concat(chunks)
  } else {
    data = await readFile(file)
  }
  const text = data[0] === 0xff && data[1] === 0xfe ? data.toString('utf16le') : data.toString('utf8')
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`${file === '-' ? 'stdin' : file}: expected JSON (${error.message})`)
  }
}

/** CLI framing only. The action module owns validity and the Cadence workflow. */
export async function layoutMain(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const [action, ...flags] = argv
  if (!action || action === '--help' || action === '-h' || flags.includes('--help')) {
    stdout.write(help)
    return 0
  }
  try {
    if (!Object.hasOwn(options, action)) throw new Error(`unknown layout command ${action}; see layout --help`)
    const { values, positionals } = parseArgs({ args: flags, options: options[action], allowPositionals: action !== 'read' })
    if (positionals.length > 1) throw new Error('expected at most one input JSON path or -')
    let input
    const source = positionals[0] ?? '-'
    switch (action) {
      case 'read':
        input = values
        break
      case 'plan':
        if (!values.spec || values.spec === '-') throw new Error('plan needs --spec with the placement JSON path')
        input = { record: await readJson(source, stdin), spec: await readJson(values.spec, stdin) }
        break
      case 'build':
        input = await readJson(source, stdin)
        break
      case 'verify':
      case 'extract':
        if (!values.pdk || values.pdk === '-') throw new Error(action + ' needs --pdk with the site profile JSON path')
        input = { record: await readJson(source, stdin), pdk: await readJson(values.pdk, stdin) }
        break
      case 'simulate':
        if (!values.bench || values.bench === '-') throw new Error('simulate needs --bench with a testbench JSON path')
        input = { record: await readJson(source, stdin), bench: await readJson(values.bench, stdin) }
        break
    }
    const config = action === 'plan' ? undefined : (await loadConfig()).config
    const result = await runLayoutAction(config, action, input)
    stdout.write(JSON.stringify(result) + '\n')
    if (result.status === 'error' && result.error) stderr.write(`layout ${action}: ${result.error}\n`)
    return result.status === 'fail' ? 1 : result.status === 'error' ? 2 : 0
  } catch (error) {
    stderr.write(`layout ${action}: ${error.message}\n`)
    return 2
  }
}
