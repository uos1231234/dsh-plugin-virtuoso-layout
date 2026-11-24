import { readFile } from 'node:fs/promises'
import { inspectPcell, inspectTech, readLayout } from './layout-cadence.js'
import { readDrcEvidence } from './layout-verification.js'

const validName = (name) => typeof name === 'string' && name.trim() !== '' && !/[\x00-\x1f\x7f]/.test(name)
const points = (row) => row.length === 2 ? [row] : [row.slice(0, 2), row.slice(2)]

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

function bbox(points) {
  const ranges = [[Infinity, Infinity], [-Infinity, -Infinity]]
  for (const [x, y] of points) {
    ranges[0][0] = Math.min(ranges[0][0], x)
    ranges[0][1] = Math.min(ranges[0][1], y)
    ranges[1][0] = Math.max(ranges[1][0], x)
    ranges[1][1] = Math.max(ranges[1][1], y)
  }
  return ranges
}

function validBox(box) {
  return Array.isArray(box) && box.length === 2 &&
    box.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))
}

function markerLocation(marker, precision) {
  if (!marker.complete) return { status: 'unavailable', reason: 'Incomplete marker geometry' }
  const cell = marker.cellReference
  const transform = cell?.cellSpace ? cell.transform : null
  if (cell?.cellSpace && !transform) {
    return { status: 'unavailable', reason: 'Cell-space marker has no usable top-cell transform' }
  }
  const convert = ([x, y]) => {
    if (transform) {
      const [a, b, c, d, tx, ty] = transform
      return [(a * x + b * y + tx) / precision, (c * x + d * y + ty) / precision]
    }
    return [x / precision, y / precision]
  }
  if (transform) {
    const [a, b, c, d] = transform
    if (Math.abs(a * d - b * c) !== 1) {
      return { status: 'unavailable', reason: 'Unsupported cell-space transform' }
    }
  }
  const geometry = marker.coordinates.map((row) => points(row).map(convert))
  return {
    status: 'located',
    bbox: bbox(geometry.flat()),
    ...(marker.type === 'polygon' ? { vertices: geometry.flat() } : { edges: geometry }),
  }
}

function figureCandidates(layout, filter) {
  const routes = layout.routes.map((shape) => ({ ...shape, kind: 'route' }))
  const pins = layout.pins.map((shape) => ({ ...shape, figureType: shape.kind, kind: 'pin' }))
  const vias = layout.vias.map((shape) => ({
    ...shape, figureType: shape.kind, kind: 'via', bboxBasis: 'via-envelope',
  }))
  const terminals = layout.instances.flatMap((instance) => instance.terminals.flatMap((term) =>
    term.figures.map((figure) => ({ ...figure, kind: 'instance-terminal', instance: instance.name,
      terminal: term.name, net: term.net }))))
  return [...routes, ...pins, ...vias, ...terminals, ...layout.otherShapes]
    .filter((shape) => validBox(shape.bbox) && shape.kind !== 'label' &&
      (filter.length === 0 || filter.some((name) => shape.layer === name || shape.layers?.includes(name))))
}

function boxDistance(a, b) {
  return Math.hypot(
    Math.max(0, a[0][0] - b[1][0], b[0][0] - a[1][0]),
    Math.max(0, a[0][1] - b[1][1], b[0][1] - a[1][1]),
  )
}

async function inspectDrc(config, { record, checks, layers, radius, limit, offset, nearest }, adapters) {
  requireThat(record?.kind === 'virtuoso.layout-verification' &&
    ['pass', 'fail'].includes(record.drc?.status) && validName(record.layoutStamp) &&
    validName(record.runId) && validName(record.remoteRunDir) &&
    [record.target?.lib, record.target?.cell, record.target?.view].every(validName),
  'DRC inspection requires a layout verify record with completed DRC and a saved OA revision')
  const { drcSummary, drcResults } = record.artifacts ?? {}
  requireThat(validName(drcSummary) && validName(drcResults), 'Verification record must name the two DRC reports')
  const [summary, results] = await Promise.all([readFile(drcSummary, 'utf8'), readFile(drcResults, 'utf8')])
  const evidence = readDrcEvidence(summary, results, { cell: record.target.cell, remoteRunDir: record.remoteRunDir },
    { markers: true })
  requireThat(record.drc.resultsSha256 === undefined || record.drc.resultsSha256 === evidence.resultsSha256,
    'DRC results changed since verification')
  requireThat(record.drc.totals?.violations === evidence.totals.violations,
    'DRC results do not agree with the verification record')

  const snapshot = await (adapters.readLayout ?? readLayout)(config, record.target, { geometry: true })
  requireThat(snapshot.ok, snapshot.error ?? 'Could not read the verified layout')
  const { layout } = snapshot
  requireThat(layout.stamp === record.layoutStamp, 'OA layout changed since verification; rerun layout verify')
  requireThat(layout.userUnits === 'micron', 'Calibre marker lookup requires an OA layout in microns')
  const figures = figureCandidates(layout, layers)
  const { precision, checks: resultChecks } = evidence.results
  const selected = resultChecks.filter((check) => check.count > 0 && (!checks.length || checks.includes(check.name)))
  const entries = selected.flatMap((check) => check.markers.map((marker) => ({ check: check.name, ...marker })))
  const markers = entries.slice(offset, offset + limit).map((marker) => {
    const location = markerLocation(marker, precision)
    const candidates = location.bbox ? figures.map((shape) => ({ ...shape,
      distance: boxDistance(location.bbox, shape.bbox) }))
      .filter(({ distance }) => distance <= radius)
      .sort((a, b) => a.distance - b.distance) : []
    return {
      check: marker.check, ordinal: marker.ordinal, type: marker.type,
      ...(marker.cellReference && { cellReference: marker.cellReference }),
      ...location, nearbyCount: candidates.length, nearby: candidates.slice(0, nearest),
    }
  })
  return {
    kind: 'virtuoso.drc-markers', target: record.target, verificationRunId: record.runId,
    layoutStamp: layout.stamp, resultsSha256: evidence.resultsSha256,
    userUnits: layout.userUnits, resultsUnitsPerMicron: precision, oaDbuPerUU: layout.dbuPerUU,
    distanceBasis: 'OA bounding boxes', layers, radius, offset, limit, nearest,
    reportedCount: selected.reduce((sum, check) => sum + check.count, 0),
    markerCount: entries.length,
    missingChecks: checks.filter((name) => !resultChecks.some((check) => check.name === name)),
    markers,
  }
}

export async function runLayoutInspection(config, action, input, adapters = {}) {
  switch (action) {
    case 'pcell': {
      const { master, inLib, parameters } = input
      requireThat([master.lib, master.cell, master.view].every(validName), 'PCell query needs a library, cell and view')
      requireThat(parameters === undefined || (validName(inLib) && Array.isArray(parameters)),
        'PCell variant query needs --in-lib and an array of typed parameters')
      requireThat(parameters === undefined || parameters.every((param) => validName(param?.name)) &&
        new Set(parameters.map(({ name }) => name)).size === parameters.length,
      'PCell parameters must have unique names')
      const geometry = await (adapters.inspectPcell ?? inspectPcell)(config, input)
      return { kind: 'virtuoso.pcell-geometry', ...geometry }
    }
    case 'tech':
      requireThat(validName(input.lib) && [...input.layers, ...input.vias].every(validName),
        'Technology query needs a library and valid layer/via names')
      return { kind: 'virtuoso.layout-technology', ...await (adapters.inspectTech ?? inspectTech)(config, input) }
    case 'drc':
      requireThat([...input.layers, ...input.checks].every(validName) &&
        Number.isFinite(input.radius) && input.radius >= 0 &&
        Number.isSafeInteger(input.offset) && input.offset >= 0 &&
        [input.limit, input.nearest].every((value) => Number.isSafeInteger(value) && value > 0),
      'Marker lookup needs valid names, a nonnegative radius/offset, and positive limit/nearest values')
      return inspectDrc(config, input, adapters)
    default:
      throw new Error(`Unknown layout inspection ${action}`)
  }
}
