import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseResults } from '../dsh-plugin-virtuoso-layout/lib/drc.js'
import { runLayoutInspection } from '../dsh-plugin-virtuoso-layout/lib/layout-inspection.js'

const results = `test_cell 2000
METAL_SPACE
3 3 0 Nov 24 01:02:03 2026
p 1 4
DV example
-1000 0
-800 0
-800 200
-1000 200
E 2 1
CN child c 1 0 0 1 800 400
0 -200 200 -200
p 3 4
CN child c
0 0
1 0
1 1
0 1
`

test('reads polygon and edge markers using report precision and declared check text length', () => {
  const parsed = parseResults(results, { markers: true })
  assert.equal(parsed.precision, 2000)
  const [{ markers }] = parsed.checks
  assert.deepEqual(markers.map(({ type }) => type), ['polygon', 'edges', 'polygon'])
  assert.deepEqual(markers[0].coordinates[0], [-1000, 0])
  assert.deepEqual(markers[1].cellReference.transform, [1, 0, 0, 1, 800, 400])
  assert.equal(markers[2].cellReference.transform, null)
})

test('finds the matching OA revision and layer, rejects stale views and changed reports', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-drc-markers-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const drcResults = join(dir, 'test.results')
  const drcSummary = join(dir, 'test.summary')
  const remoteRunDir = '/work/test-signoff'
  await Promise.all([
    writeFile(drcResults, results),
    writeFile(drcSummary, `=== CALIBRE::DRC-H SUMMARY REPORT
Layout Primary Cell: test_cell
Layout Path(s): ${remoteRunDir}/layout.gds

--- RULECHECK RESULTS STATISTICS
RULECHECK METAL_SPACE ..... TOTAL Result Count = 3 (3)

--- CELL SUMMARY
CELL test_cell ..... TOTAL Result Count = 3 (3)
--- SUMMARY
TOTAL DRC RuleChecks Executed: 1
TOTAL DRC Results Generated: 3 (3)
`),
  ])
  const target = { lib: 'Test', cell: 'test_cell', view: 'layout' }
  const record = {
    kind: 'virtuoso.layout-verification', target, layoutStamp: 'original', runId: 'test', remoteRunDir,
    artifacts: { drcResults, drcSummary },
    drc: { status: 'fail', totals: { violations: 3 }, resultsSha256: createHash('sha256').update(results).digest('hex') },
  }
  const layout = {
    stamp: 'original', userUnits: 'micron', dbuPerUU: 1000,
    routes: [{ layer: 'M1', net: 'OUTN', bbox: [[-0.6, -0.1], [-0.5, 0.1]] },
      { layer: 'M2', net: 'PASSING', bbox: [[-0.6, -0.1], [-0.5, 0.1]] }],
    vias: [{ layers: ['M1', 'M2'], net: 'OUTP', bbox: [[0.5, 0.1], [0.55, 0.2]] }],
    pins: [], instances: [], otherShapes: [],
  }
  const adapters = { readLayout: async (_config, ref, options) => {
    assert.deepEqual(ref, target)
    assert.equal(options.geometry, true)
    return { ok: true, layout }
  } }
  const input = { record, checks: ['METAL_SPACE'], layers: ['M1'], radius: 0.01, offset: 0, limit: 3, nearest: 5 }
  const located = await runLayoutInspection({}, 'drc', input, adapters)
  assert.equal(located.markerCount, 3)
  assert.equal(located.resultsUnitsPerMicron, 2000)
  assert.deepEqual(located.markers[0].bbox, [[-0.5, 0], [-0.4, 0.1]])
  assert.deepEqual(located.markers[0].nearby.map((shape) => shape.net), ['OUTN'])
  assert.deepEqual(located.markers[1].edges, [[[0.4, 0.1], [0.5, 0.1]]])
  assert.equal(located.markers[1].nearby[0].kind, 'via')
  assert.equal(located.markers[2].status, 'unavailable')
  const secondPage = await runLayoutInspection({}, 'drc', { ...input, offset: 1, limit: 1 }, adapters)
  assert.deepEqual(secondPage.markers.map((marker) => marker.ordinal), [2])
  layout.stamp = 'replaced'
  await assert.rejects(runLayoutInspection({}, 'drc', input, adapters), /OA layout changed/)
  layout.stamp = 'original'
  await writeFile(drcResults, results.replace('-1000 0', '-1001 0'))
  await assert.rejects(runLayoutInspection({}, 'drc', input, adapters), /DRC results changed/)
})
