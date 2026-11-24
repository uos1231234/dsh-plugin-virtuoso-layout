const coordinateTolerance = 1e-6
const reflectedOrientation = {
  R0: 'MY', MY: 'R0', R90: 'MXR90', MXR90: 'R90',
  R180: 'MX', MX: 'R180', R270: 'MYR90', MYR90: 'R270',
}

const name = (value) => typeof value === 'string' && value.trim() !== ''
const point = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= coordinateTolerance
const samePoint = (a, b) => point(a) && point(b) && a.every((n, i) => near(n, b[i]))
const mirror = ([x, y], axisX) => [2 * axisX - x, y]

export const validBox = (box) => Array.isArray(box) && box.length === 2 && box.every(point) &&
  box[0].every((n, i) => n < box[1][i])

function contains(box, [x, y], epsilon = coordinateTolerance) {
  return x >= box[0][0] - epsilon && x <= box[1][0] + epsilon &&
    y >= box[0][1] - epsilon && y <= box[1][1] + epsilon
}

function containsBox(outer, inner) {
  return validBox(outer) && validBox(inner) && inner.every((p) => contains(outer, p))
}

function required(condition, message) {
  if (!condition) throw new Error(`layout constraints: ${message}`)
}

function scalarEqual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-7 * Math.max(Math.abs(a), Math.abs(b), 1e-14)
  }
  return a === b
}

function equalParameters(a = [], b = []) {
  const indexed = new Map(b.map((param) => [param.name, param]))
  return a.length === b.length && a.every((param) => {
    const other = indexed.get(param.name)
    return other && other.type === param.type && scalarEqual(other.value, param.value)
  })
}

function sameUnit(a, b) {
  return ['lib', 'cell', 'view'].every((key) => a.master?.[key] === b.master?.[key]) &&
    (a.multiplicity ?? 1) === (b.multiplicity ?? 1) && equalParameters(a.parameters, b.parameters)
}

function paired(left, right, equivalent) {
  if (left.length !== right.length) return false
  const remaining = [...right]
  return left.every((item) => {
    const match = remaining.findIndex((candidate) => equivalent(item, candidate))
    if (match < 0) return false
    remaining.splice(match, 1)
    return true
  })
}

function mirroredRoute(a, b, axisX) {
  if (a.layer !== b.layer || a.purpose !== b.purpose || a.style !== b.style ||
      !near(a.width, b.width) || a.points.length !== b.points.length) return false
  const points = a.points.map((p) => mirror(p, axisX))
  return points.every((p, i) => samePoint(p, b.points[i])) ||
    points.every((p, i) => samePoint(p, b.points[b.points.length - i - 1]))
}

function lengthOf(routes) {
  return routes.reduce((sum, route) => sum + route.points.slice(1).reduce((length, [x, y], i) => {
    const [prevX, prevY] = route.points[i]
    return length + Math.hypot(x - prevX, y - prevY)
  }, 0), 0)
}

function mirrorBox(box, axisX) {
  return [[2 * axisX - box[1][0], box[0][1]], [2 * axisX - box[0][0], box[1][1]]]
}

function sameBox(a, b) {
  return validBox(a) && validBox(b) && a.every((p, i) => samePoint(p, b[i]))
}

function mirroredVia(a, b, axisX) {
  return a.definition === b.definition && equalParameters(a.parameters, b.parameters) &&
    samePoint(mirror(a.origin, axisX), b.origin) &&
    (!a.bbox || !b.bbox || sameBox(mirrorBox(a.bbox, axisX), b.bbox))
}

function checkPair(pair, layout, instances, nets, report) {
  const { instances: ids, axisX, netPairs = [] } = pair ?? {}
  required(Array.isArray(ids) && ids.length === 2 && ids[0] !== ids[1] && ids.every((id) => instances.has(id)) &&
    Number.isFinite(axisX) && Array.isArray(netPairs), 'matched pair needs two known instances and a finite axisX')
  const [a, b] = ids.map((id) => instances.get(id))
  const id = ids.join('/')
  report('matched-device', id, sameUnit(a, b), 'master, unit dimensions, fingers and multiplicity')
  const mirrored = samePoint(mirror(a.origin, axisX), b.origin) && reflectedOrientation[a.orient] === b.orient
  report('mirrored-placement', id, mirrored, 'instance origin and orientation')
  if (validBox(a.bbox) && validBox(b.bbox)) {
    report('mirrored-footprint', id, sameBox(mirrorBox(a.bbox, axisX), b.bbox), 'saved PCell bounding boxes')
  }
  for (const names of netPairs) {
    required(Array.isArray(names) && names.length === 2 && names[0] !== names[1] && names.every((net) => nets.has(net)),
      'matched route pair needs two known, distinct nets')
    const routes = names.map((net) => layout.routes.filter((route) => route.net === net))
    const vias = names.map((net) => layout.vias.filter((via) => via.net === net))
    const pins = names.map((net) => layout.pins.filter((pin) => (pin.net ?? layout.terms.find((term) => term.name === pin.term)?.net) === net))
    const label = names.join('/')
    report('mirrored-routing', label, routes[0].length > 0 && paired(...routes, (x, y) => mirroredRoute(x, y, axisX)),
      { layers: routes.map((set) => [...new Set(set.map((route) => route.layer))].sort()), lengths: routes.map(lengthOf) })
    report('mirrored-vias', label, paired(...vias, (x, y) => mirroredVia(x, y, axisX)),
      { counts: vias.map((set) => set.length), definitions: vias.map((set) => set.map((via) => via.definition).sort()) })
    report('mirrored-pins', label, paired(...pins, (x, y) => x.layer === y.layer && x.purpose === y.purpose &&
      sameBox(mirrorBox(x.bbox, axisX), y.bbox)), 'pin layer and mirrored bounds')
  }
}

// Cover the ring as a union of rectangles. Testing the grid cells induced by
// all edges detects both open seams and unintended material inside the aperture.
function ringGeometry(rects, inner, outer) {
  const cuts = [0, 1].map((axis) => [...new Set([inner, outer, ...rects].flatMap((box) => box.map((p) => p[axis])))].sort((a, b) => a - b))
  const [xs, ys] = cuts
  let gaps = 0
  let filledOpening = 0
  for (let ix = 1; ix < xs.length; ix++) {
    if (near(xs[ix - 1], xs[ix])) continue
    for (let iy = 1; iy < ys.length; iy++) {
      if (near(ys[iy - 1], ys[iy])) continue
      const p = [(xs[ix - 1] + xs[ix]) / 2, (ys[iy - 1] + ys[iy]) / 2]
      if (!contains(outer, p, 0)) continue
      const covered = rects.some((rect) => contains(rect, p, 0))
      if (contains(inner, p, 0)) filledOpening += Number(covered)
      else gaps += Number(!covered)
    }
  }
  return { gaps, filledOpening }
}

function ringBounds(inner, outer) {
  return containsBox(outer, inner) && inner[0].every((n, i) => n > outer[0][i]) &&
    inner[1].every((n, i) => n < outer[1][i])
}

function checkRing(ring, layout, rectangles, actual, nets, report) {
  const { net, inner, outer, layers, contact, encloses } = ring ?? {}
  required(nets.has(net) && ringBounds(inner, outer) && Array.isArray(layers) && layers.length > 0,
    'guard ring needs an existing net, nested inner/outer bounds and its PDK layers')
  for (const layer of layers) {
    const { layer: lpp, purpose, rectangles: ids, inner: lo = inner, outer: hi = outer } = layer ?? {}
    required(name(lpp) && name(purpose) && ringBounds(lo, hi) && Array.isArray(ids) && ids.length > 0 &&
      new Set(ids).size === ids.length && ids.every((id) => rectangles.has(id)), 'guard ring layer needs distinct rectangle IDs and valid bounds')
    const matches = actual ? (layout.otherShapes ?? []).filter((shape) => shape.kind === 'rect') : null
    const shapes = ids.map((id) => {
      const expected = rectangles.get(id)
      required(expected.net === net && expected.layer === lpp && expected.purpose === purpose && containsBox(hi, expected.bbox),
        `guard rectangle ${id} has the wrong net, layer or bounds`)
      return matches === null ? expected : matches.find((shape) => shape.net === net && shape.layer === lpp &&
        shape.purpose === purpose && sameBox(shape.bbox, expected.bbox))
    })
    const missing = shapes.filter((shape) => !shape).length
    const { gaps, filledOpening } = ringGeometry(shapes.filter(Boolean).map((shape) => shape.bbox), lo, hi)
    report('guard-ring', `${net}:${lpp}/${purpose}`, missing === 0 && gaps === 0 && filledOpening === 0,
      { missingRectangles: missing, uncoveredBandCells: gaps, filledOpeningCells: filledOpening })
  }
  if (encloses !== undefined) {
    const instances = new Map(layout.instances.map((instance) => [instance.name, instance]))
    required(Array.isArray(encloses) && encloses.length > 0 && encloses.every((id) => instances.has(id)),
      'guard-ring encloses needs known device instances')
    const outside = encloses.filter((id) => {
      const instance = instances.get(id)
      return actual ? !containsBox(inner, instance.bbox) : !contains(inner, instance.origin)
    })
    report('guard-enclosure', net, outside.length === 0, { devices: encloses, outside })
  }
  if (contact !== undefined) {
    required(name(contact?.definition) && Number.isSafeInteger(contact.minimum) && contact.minimum > 0,
      'guard-ring contact requires a via definition and a positive minimum')
    const sites = layout.vias.filter((via) => via.net === net && via.definition === contact.definition &&
      contains(outer, via.origin) && !contains(inner, via.origin, 0))
    const unique = new Set(sites.map((via) => via.origin.join(','))).size
    report('guard-contacts', net, unique >= contact.minimum, { found: unique, minimum: contact.minimum })
  }
}

function checkArray(array, instances, report) {
  const { rows, groups, dummies = [], commonCentroid = false } = array ?? {}
  required(Array.isArray(rows) && rows.length > 0 && rows.every((row) => Array.isArray(row) && row.length > 0) &&
    groups && typeof groups === 'object' && !Array.isArray(groups) && Array.isArray(dummies) &&
    typeof commonCentroid === 'boolean', 'matching array needs ordered rows and active groups')
  const active = Object.values(groups)
  const all = [...active.flat(), ...dummies]
  required(active.length >= 2 && active.every((group) => Array.isArray(group) && group.length > 0) &&
    new Set(all).size === all.length && all.every((id) => instances.has(id)) &&
    rows.flat().length === all.length && new Set(rows.flat()).size === all.length && rows.flat().every((id) => all.includes(id)),
  'each matching array site must identify one active or dummy source instance')
  const sites = rows.map((row) => row.map((id) => instances.get(id)))
  const id = Object.keys(groups).join('/')
  report('matching-array-units', id, all.every((unit) => sameUnit(instances.get(all[0]), instances.get(unit))),
    'all active and dummy units use equal device geometry')
  report('matching-array-order', id, sites.every((row, i) =>
    (i === 0 || row[0].origin[1] > sites[i - 1][0].origin[1]) && row.every((site, j) =>
      near(site.origin[1], row[0].origin[1]) && (j === 0 || site.origin[0] > row[j - 1].origin[0]))),
  'rows ordered bottom to top and sites ordered left to right')
  if (commonCentroid) {
    const centers = active.map((group) => [0, 1].map((axis) => group.reduce((sum, unit) => sum + instances.get(unit).origin[axis], 0) / group.length))
    report('common-centroid', id, centers.every((center) => samePoint(center, centers[0])), { centers })
  }
}

/** Evaluate the authored constraints against the plan or the saved OA readback. */
export function auditLayoutConstraints(constraints, layout, rectangles = [], { actual = false } = {}) {
  if (constraints === undefined) return undefined
  const { matchedPairs = [], guardRings = [], matchedArrays = [] } = constraints ?? {}
  required(constraints && typeof constraints === 'object' && !Array.isArray(constraints) &&
    Object.keys(constraints).every((key) => ['matchedPairs', 'guardRings', 'matchedArrays'].includes(key)) &&
    [matchedPairs, guardRings, matchedArrays].every(Array.isArray), 'expected matchedPairs, guardRings or matchedArrays lists')
  const findings = []
  const report = (check, subject, ok, evidence) => findings.push({ check, subject, ok, evidence })
  const instances = new Map(layout.instances.map((item) => [item.name, item]))
  const nets = new Set(layout.nets.map((item) => item.name))
  for (const pair of matchedPairs) checkPair(pair, layout, instances, nets, report)
  for (const array of matchedArrays) checkArray(array, instances, report)
  const byId = new Map(rectangles.map((rect) => [rect.id, rect]))
  for (const ring of guardRings) checkRing(ring, layout, byId, actual, nets, report)
  return findings.length ? { status: findings.every((finding) => finding.ok) ? 'pass' : 'fail', findings } : undefined
}
