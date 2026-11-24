import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditLayoutConstraints } from '../dsh-plugin-virtuoso-layout/lib/layout-constraints.js'

const master = { lib: 'test', cell: 'nmos', view: 'layout' }
const unit = (name, origin, orient = 'R0') => ({ name, master, origin, orient, multiplicity: 1,
  parameters: [{ name: 'fw', type: 'float', value: 440e-9 }] })
const route = (net, x) => ({ net, layer: 'M1', purpose: 'drawing', style: 'extendExtend',
  width: 0.2, points: [[x, 0], [x, 1]] })
const rect = (id, bbox) => ({ id, kind: 'rect', net: 'B', layer: 'AA', purpose: 'drawing', bbox })
const rings = [rect('left', [[-3, -3], [-2, 3]]), rect('right', [[2, -3], [3, 3]]),
  rect('bottom', [[-2, -3], [2, -2]]), rect('top', [[-2, 2], [2, 3]])]
const layout = {
  instances: [{ ...unit('L', [-1, 0], 'MY'), bbox: [[-1.3, -0.2], [-0.8, 0.2]] },
    { ...unit('R', [1, 0]), bbox: [[0.8, -0.2], [1.3, 0.2]] }],
  nets: ['OUTL', 'OUTR', 'B'].map((name) => ({ name })),
  terms: [], pins: [],
  routes: [route('OUTL', -1), route('OUTR', 1)],
  vias: [{ net: 'B', definition: 'M1_AA', origin: [-2.5, 0] },
    { net: 'B', definition: 'M1_AA', origin: [2.5, 0] }],
  otherShapes: rings,
}
const constraints = {
  matchedPairs: [{ instances: ['L', 'R'], axisX: 0, netPairs: [['OUTL', 'OUTR']] }],
  guardRings: [{ net: 'B', inner: [[-2, -2], [2, 2]], outer: [[-3, -3], [3, 3]],
    encloses: ['L', 'R'], contact: { definition: 'M1_AA', minimum: 2 },
    layers: [{ layer: 'AA', purpose: 'drawing', rectangles: rings.map((shape) => shape.id) }] }],
}

const audit = (snapshot, shapes = rings) => auditLayoutConstraints(constraints, snapshot, shapes, { actual: true })

test('rejects an actual route shift, missing ring edge and filled guard aperture', () => {
  assert.equal(audit(layout).status, 'pass')
  const changed = structuredClone(layout)
  changed.routes[1].points[1][1] += 0.1
  changed.otherShapes = changed.otherShapes.slice(0, -1)
  assert.deepEqual(audit(changed).findings.filter((finding) => !finding.ok).map((finding) => finding.check),
    ['mirrored-routing', 'guard-ring'])
  const filled = [rect('left', [[-3, -3], [3, 3]]), ...rings.slice(1)]
  const failure = audit({ ...layout, otherShapes: filled }, filled).findings.find((finding) => finding.check === 'guard-ring')
  assert.equal(failure.ok, false)
  assert.ok(failure.evidence.filledOpeningCells > 0)
})

test('checks the ordered unit sites and common-centroid constraint with explicit dummy devices', () => {
  const drawing = { ...layout, instances: ['DL', 'A0', 'B0', 'B1', 'A1', 'DR'].map((name, index) => unit(name, [index, 0])) }
  const scheme = { matchedArrays: [{ groups: { A: ['A0', 'A1'], B: ['B0', 'B1'] }, dummies: ['DL', 'DR'],
    rows: [['DL', 'A0', 'B0', 'B1', 'A1', 'DR']], commonCentroid: true }] }
  assert.equal(auditLayoutConstraints(scheme, drawing).status, 'pass')
  drawing.instances[2].origin[0] += 0.25
  assert.equal(auditLayoutConstraints(scheme, drawing).findings.find(({ check }) => check === 'common-centroid').ok, false)
})
