import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseReport, reconcile } from '../dsh-plugin-virtuoso-layout/lib/drc.js'
import { planLayout, runLayoutAction } from '../dsh-plugin-virtuoso-layout/lib/layout-flow.js'

const dir = await mkdtemp(join(tmpdir(), 'dsh-layout-flow-test-'))
try {
  const config = { artifactDir: dir }
  const source = { lib: 'test', cell: 'inv', view: 'schematic' }
  const target = { lib: 'test', cell: 'inv_out', view: 'layout' }
  const sourceSnapshot = {
    source, stamp: 'first', nets: [{ name: 'IN' }, { name: 'VSS' }], terms: [{ name: 'IN', net: 'IN' }],
    instances: [{ name: 'M0', multiplicity: 1, parameters: {
      w: { type: 'string', value: '800n' }, l: { type: 'string', value: '180n' },
      fingers: { type: 'string', value: '2' }, m: { type: 'string', value: '1' },
    }, terminals: [{ name: 'G', net: 'IN' }, { name: 'B', net: 'VSS' }, { name: 'S', net: null }] }],
  }
  const spec = {
    target, techLib: 'smic18ee', instances: [{
      source: 'M0', master: { lib: 'smic18ee', cell: 'example_nmos', view: 'layout' },
      origin: [0, 0], orient: 'R0', terminalMap: { G: 'G', B: 'B', S: 'S' },
      parameterMap: { w: { name: 'fw', type: 'float', divideBy: 'fingers' },
        l: { name: 'l', type: 'float' }, fingers: { name: 'fingers', type: 'float' } },
    }],
    pins: [{ term: 'IN', layer: 'M1', purpose: 'pin', bbox: [[0, 0], [1, 1]] }],
  }
  let sourceState = sourceSnapshot
  let layoutState = { techLib: 'smic18ee', stamp: 'one' }
  let writes = 0
  let verifies = 0
  const adapters = {
    readSchematic: async () => ({ ok: true, schematic: sourceState }),
    readLayout: async () => ({ ok: true, layout: layoutState }),
    exportSourceCdl: async () => ({ ok: true, sourceCdl: '.SUBCKT inv IN\n.ENDS inv\n' }),
    writeLayout: async (_configuration, plan) => {
      writes += 1
      assert.ok(Math.abs(plan.instances[0].parameters[0].value - 400e-9) < 1e-18)
      return { ok: true, layout: layoutState }
    },
    runLayoutVerification: async (_configuration, input) => {
      verifies += 1
      assert.equal(input.cell, target.cell)
      assert.equal(input.sourceCell, source.cell)
      assert.equal(input.sourceCdl.toString(), '.SUBCKT inv IN\n.ENDS inv\n')
      return { ok: false, status: 'fail', drc: { status: 'fail' }, lvs: { status: 'pass' } }
    },
  }
  const read = await runLayoutAction(config, 'read', source, adapters)
  const plan = planLayout(read, spec)
  assert.equal(plan.layout.instances[0].terminals[2].net, null)

  sourceState = { ...sourceSnapshot, stamp: 'changed' }
  await assert.rejects(runLayoutAction(config, 'build', plan, adapters), /schematic changed since plan/)
  assert.equal(writes, 0)
  sourceState = sourceSnapshot

  const build = await runLayoutAction(config, 'build', plan, adapters)
  assert.equal(writes, 1)
  assert.equal((await stat(join(build.runDir, 'build.json'))).isFile(), true)
  layoutState = { ...layoutState, stamp: 'two' }
  await assert.rejects(runLayoutAction(config, 'verify', { record: build }, adapters), /layout changed since build/)
  assert.equal(verifies, 0)
  layoutState = { ...layoutState, stamp: 'one' }
  const verification = await runLayoutAction(config, 'verify', { record: build }, adapters)
  assert.equal(verification.status, 'fail')
  assert.equal(verification.lvs.status, 'pass')
  assert.equal(verifies, 1)

  await writeFile(build.sourceCdlPath, '.SUBCKT wrong IN\n.ENDS wrong\n')
  await assert.rejects(runLayoutAction(config, 'verify', { record: build }, adapters), /source CDL differs/)
  assert.equal(verifies, 1)

  const summaryText = [
    '=== CALIBRE::DRC-H SUMMARY REPORT', 'Layout Primary Cell: demo',
    '--- RULECHECK RESULTS STATISTICS', 'RULECHECK DEMO .... TOTAL Result Count = 1 (1)',
    '--- SUMMARY', 'TOTAL DRC RuleChecks Executed: 1', 'TOTAL DRC Results Generated: 1 (1)',
  ].join('\n')
  const resultsText = [
    'demo 1000', 'DEMO', '1 1 2 Nov 24 01:02:03 2026', 'Rule File Pathname: example.drc',
    'Generated example marker', 'p 1 4', '0 0', '0 1', '1 1', '1 0',
  ].join('\n')
  const summary = parseReport(summaryText, 'summary')
  const results = parseReport(resultsText, 'results')
  assert.equal(summary.totals.violations, 1)
  assert.equal(reconcile(summary, results).agreement, true)
  assert.equal(reconcile(summary, parseReport(resultsText.replace(/^demo/, 'different'), 'results')).agreement, false)
  assert.equal(reconcile(summary, summary).agreement, false)
  assert.throws(() => parseReport('plain text', 'summary'), /invalid or incomplete/)
  assert.throws(() => parseReport(summaryText.split('TOTAL DRC Results Generated:')[0], 'summary'), /invalid or incomplete/)
  assert.equal(results.failing[0].firstViolationVertices.length, 4)
  console.log('layout-flow: source/layout/CDL identity, parameter propagation, and native DRC parser regressions passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
