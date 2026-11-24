import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readLayout, readSchematic, writeLayout } from './layout-cadence.js'
import { auditLayoutConstraints, validBox } from './layout-constraints.js'
import { exportSourceCdl } from './layout-netlist.js'

const kinds = {
  read: 'virtuoso.schematic',
  plan: 'virtuoso.layout-plan',
  build: 'virtuoso.layout-build',
  verify: 'virtuoso.layout-verification',
  extract: 'virtuoso.layout-extraction',
  simulate: 'virtuoso.layout-simulation',
}

const digest = (content) => createHash('sha256').update(content).digest('hex')

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

const validName = (value) => typeof value === 'string' && value.trim() !== '' && !/[\x00-\x1f\x7f]/.test(value)
const validPoint = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
const validOrient = (value) => ['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MXR90', 'MYR90'].includes(value)

function cellview(reference, defaultView) {
  const { lib, cell, view = defaultView } = reference ?? {}
  requireThat([lib, cell, view].every(validName), 'cellview must supply lib, cell and view')
  return { lib, cell, view }
}

function requireKind(record, action) {
  requireThat(record?.kind === kinds[action], `expected a ${kinds[action]} record`)
}

function indexByName(items, label) {
  requireThat(Array.isArray(items), `${label} must be an array`)
  const index = new Map()
  for (const item of items) {
    requireThat(validName(item?.name) && !index.has(item.name), `${label} contains an invalid or duplicate name`)
    index.set(item.name, item)
  }
  return index
}

const engineeringMultipliers = { T: 1e12, G: 1e9, M: 1e6, K: 1e3, k: 1e3,
  m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18 }

function engineeringNumber(value) {
  if (typeof value === 'number') return value
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([TGMKkmunpfa]?)$/i.exec(String(value).trim())
  return match ? Number(match[1]) * (engineeringMultipliers[match[2]] ?? (match[2] === '' ? 1 : NaN)) : NaN
}

function mapParameter(parameter, mapping, allParameters, label) {
  if (typeof mapping === 'string') return { name: mapping, type: parameter.type, value: parameter.value }
  const { name, type, divideBy } = mapping ?? {}
  requireThat(validName(name) && ['float', 'int', 'string', 'boolean'].includes(type),
    `${label}: destination parameter requires name and supported type`)
  if (type === 'float' || type === 'int') {
    const divisor = divideBy === undefined ? 1 : engineeringNumber(allParameters[divideBy]?.value)
    const value = engineeringNumber(parameter.value) / divisor
    requireThat(Number.isFinite(value) && divisor > 0 && (type !== 'int' || Number.isInteger(value)),
      `${label}: source value cannot be expressed as target ${type}`)
    return { name, type, value }
  }
  requireThat(divideBy === undefined, `${label}: only numeric parameters support divideBy`)
  if (type === 'string') {
    const value = typeof parameter.value === 'boolean' ? (parameter.value ? 'TRUE' : 'FALSE') : String(parameter.value)
    return { name, type, value }
  }
  requireThat(typeof parameter.value === 'boolean', `${label}: expected a source boolean`)
  return { name, type, value: parameter.value }
}

function mapInstance(device, placement, nets) {
  const { master, origin, orient, parameterMap = {}, terminalMap } = placement
  requireThat(validPoint(origin) && validOrient(orient), `${device.name}: invalid origin or orientation`)
  requireThat(parameterMap && typeof parameterMap === 'object' && !Array.isArray(parameterMap),
    `${device.name}: parameterMap must be an object`)
  requireThat(terminalMap && typeof terminalMap === 'object' && !Array.isArray(terminalMap),
    `${device.name}: terminalMap must be an object`)

  const sourceParameters = { ...device.parameters }
  const multi = device.multiplicity
  if (Number.isInteger(multi) && multi > 1 && !Object.keys(sourceParameters).some((key) => key.toLowerCase() === 'm')) {
    sourceParameters.m = { type: 'int', value: multi }
  }
  for (const [name, param] of Object.entries(sourceParameters)) {
    const singleInstance = /^m$/i.test(name) && engineeringNumber(param.value) === 1
    if (/^(w|l|nf|m|fingers)$/i.test(name) && !singleInstance && param.value !== null && param.value !== undefined) {
      requireThat(Object.hasOwn(parameterMap, name), `${device.name}: map source parameter ${name} explicitly`)
    }
  }
  const parameters = Object.entries(parameterMap).map(([source, mapping]) => {
    const param = Object.hasOwn(sourceParameters, source) ? sourceParameters[source] : undefined
    requireThat(param && ['boolean', 'number', 'string'].includes(typeof param.value),
      `${device.name}: ${source} must exist as a scalar source parameter and have a PCell destination`)
    requireThat(validName(param.type), `${device.name}: source parameter ${source} has no Cadence type`)
    return mapParameter(param, mapping, sourceParameters, `${device.name}.${source}`)
  })

  const sourceTerms = indexByName(device.terminals, `${device.name} terminals`)
  const terminals = Object.entries(terminalMap).map(([source, name]) => {
    const terminal = sourceTerms.get(source)
    requireThat(validName(name) && terminal && (terminal.net === null || nets.has(terminal.net)),
      `${device.name}: ${source} must be a source terminal with a PCell destination`)
    return { name, net: terminal.net }
  })
  requireThat(terminals.length === sourceTerms.size, `${device.name}: map every schematic terminal`)
  indexByName(terminals, `${device.name} mapped terminals`)
  indexByName(parameters, `${device.name} mapped parameters`)
  return { name: device.name, master: cellview(master, 'layout'), origin, orient, parameters, terminals,
    ...(device.multiplicity === undefined ? {} : { multiplicity: device.multiplicity }) }
}

export function planLayout(record, spec) {
  requireKind(record, 'read')
  const { schematic } = record
  const source = cellview(schematic?.source, 'schematic')
  requireThat(validName(schematic?.stamp), 'schematic has no saved-view fingerprint')
  const target = cellview(spec?.target, 'layout')
  requireThat(target.view === 'layout', 'target view must be layout for stream-out')
  const { techLib, instances: placements, routes = [], vias = [], pins } = spec ?? {}
  requireThat(validName(techLib), 'placement spec must identify the target technology library')
  const nets = indexByName(schematic.nets, 'schematic nets')
  const terms = indexByName(schematic.terms, 'schematic terms')
  const devices = indexByName(schematic.instances, 'schematic instances')
  requireThat(devices.size > 0, 'schematic has no device instances')
  requireThat(Array.isArray(placements) && placements.length === devices.size,
    'placement spec must place every schematic instance exactly once')
  const placed = new Set()
  const instances = placements.map((placement) => {
    const device = devices.get(placement?.source)
    requireThat(device && !placed.has(device.name), `unknown or duplicate placement source ${placement?.source}`)
    placed.add(device.name)
    return mapInstance(device, placement, nets)
  })

  requireThat(Array.isArray(routes) && routes.every((route) => nets.has(route?.net) &&
    validName(route.layer) && validName(route.purpose) && validName(route.style) &&
    Number.isFinite(route.width) && route.width > 0 && Array.isArray(route.points) &&
    route.points.length >= 2 && route.points.every(validPoint)), 'invalid route or route net')
  requireThat(Array.isArray(vias) && vias.every((via) => nets.has(via?.net) && validName(via.definition) &&
    validPoint(via.origin) && validOrient(via.orient) && Array.isArray(via.parameters ?? []) &&
    (via.parameters ?? []).every((param) => validName(param?.name) &&
      ['string', 'number', 'boolean'].includes(typeof param.value))), 'invalid via or via net')
  const rectangles = spec.rectangles ?? []
  requireThat(Array.isArray(rectangles) && rectangles.every((rect) => validName(rect?.id) && nets.has(rect.net) &&
    validName(rect.layer) && validName(rect.purpose) && validBox(rect.bbox)) &&
    new Set(rectangles.map((rect) => rect.id)).size === rectangles.length, 'invalid rectangle, duplicate ID or unknown rectangle net')

  const pinned = new Set()
  requireThat(Array.isArray(pins), 'placement spec must supply pins')
  for (const pin of pins) {
    const term = terms.get(pin?.term)
    requireThat(term && nets.has(term.net) && validName(pin.layer) && validName(pin.purpose) &&
      Array.isArray(pin.bbox) && pin.bbox.length === 2 && pin.bbox.every(validPoint) &&
      pin.bbox[0][0] < pin.bbox[1][0] && pin.bbox[0][1] < pin.bbox[1][1], `invalid pin for ${pin?.term}`)
    if (pin.label !== undefined) {
      const label = pin.label
      requireThat(label?.text === term.name && validName(label.layer) && validName(label.purpose) &&
        validPoint(label.origin) && label.origin.every((value, i) => value >= pin.bbox[0][i] && value <= pin.bbox[1][i]) &&
        validName(label.justification) && validOrient(label.orient) && validName(label.font) &&
        Number.isFinite(label.height) && label.height > 0, `invalid stream-out label for ${term.name}`)
    }
    pinned.add(term.name)
  }
  requireThat(pinned.size === terms.size, 'placement spec must place at least one pin for each schematic port')

  const layout = { source, sourceStamp: schematic.stamp, target, techLib, instances,
    nets: schematic.nets, terms: schematic.terms, routes, vias, pins, rectangles }
  const constraints = auditLayoutConstraints(spec.constraints, layout, rectangles)
  return {
    kind: kinds.plan, source, sourceStamp: schematic.stamp, spec,
    layout, ...(constraints ? { status: constraints.status, constraints } : {}),
  }
}

function completed(result, key) {
  if (result.ok !== true) throw new Error(result.error ?? `failed to obtain ${key}`)
  return result[key]
}

async function layoutRunDirectory(config) {
  const root = resolve(config.artifactDir, 'layout-runs')
  await mkdir(root, { recursive: true })
  return mkdtemp(join(root, 'build-'))
}

export async function runLayoutAction(config, action, input, adapters = {}) {
  const readSource = adapters.readSchematic ?? readSchematic
  const readTarget = adapters.readLayout ?? readLayout
  const exportCdl = adapters.exportSourceCdl ?? exportSourceCdl
  const writeTarget = adapters.writeLayout ?? writeLayout

  switch (action) {
    case 'read': {
      const source = cellview(input, 'schematic')
      const schematic = completed(await readSource(config, source), 'schematic')
      return { kind: kinds.read, schematic }
    }
    case 'plan':
      return planLayout(input.record, input.spec)
    case 'build': {
      requireKind(input, 'plan')
      const source = cellview(input.source, 'schematic')
      const read = await runLayoutAction(config, 'read', source, adapters)
      requireThat(read.schematic.stamp === input.sourceStamp, 'schematic changed since plan; read and plan it again')
      const plan = planLayout(read, input.spec)
      if (plan.status === 'fail') {
        return { kind: kinds.build, status: 'fail', stage: 'plan', source, target: plan.layout.target,
          constraints: plan.constraints }
      }
      const sourceCdl = completed(await exportCdl(config, source), 'sourceCdl')
      const after = completed(await readSource(config, source), 'schematic')
      requireThat(after.stamp === plan.sourceStamp, 'schematic changed during netlisting; read and plan it again')
      const runDir = await layoutRunDirectory(config)
      const sourceCdlPath = join(runDir, 'source.cdl')
      await writeFile(sourceCdlPath, sourceCdl, { flag: 'wx' })
      const layout = completed(await writeTarget(config, plan.layout), 'layout')
      requireThat(validName(layout?.stamp), 'written layout did not return a saved-view fingerprint')
      const constraints = auditLayoutConstraints(plan.spec.constraints, layout, plan.layout.rectangles, { actual: true })
      const record = {
        kind: kinds.build, status: constraints?.status === 'fail' ? 'fail' : 'built', source, sourceStamp: plan.sourceStamp,
        target: plan.layout.target, techLib: plan.layout.techLib, layoutStamp: layout.stamp,
        runDir, sourceCdlPath, sourceCdlSha256: digest(sourceCdl), layout, ...(constraints && { constraints }),
      }
      await writeFile(join(runDir, 'build.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
      return record
    }
    case 'verify': {
      const record = input.record
      requireKind(record, 'build')
      requireThat(validName(record.layoutStamp), 'verification needs a saved layout fingerprint from build')
      const target = cellview(record.target, 'layout')
      const source = cellview(record.source, 'schematic')
      const layout = completed(await readTarget(config, target), 'layout')
      requireThat(layout.stamp === record.layoutStamp && layout.techLib === record.techLib,
        'layout changed since build; this build record no longer identifies the target layout')
      const schematic = completed(await readSource(config, source), 'schematic')
      requireThat(schematic.stamp === record.sourceStamp, 'schematic changed since build; read and plan it again')
      const sourceCdl = await readFile(record.sourceCdlPath)
      requireThat(digest(sourceCdl) === record.sourceCdlSha256, 'saved source CDL differs from the build record')
      const pdk = input.pdk ?? record.techLib
      requireThat((typeof pdk === 'string' ? pdk : pdk.id) === record.techLib,
        'verification profile and built layout use different technologies')
      const verify = adapters.runLayoutVerification ?? (await import('./layout-verification.js')).runLayoutVerification
      const verification = await verify(config, {
        library: target.lib, cell: target.cell, view: target.view, sourceCell: source.cell, sourceCdl, pdk,
      })
      const checkedLayout = await readTarget(config, target)
      const checkedSource = await readSource(config, source)
      const checksStillCurrent = checkedLayout.ok && checkedSource.ok &&
        checkedLayout.layout.stamp === record.layoutStamp && checkedSource.schematic.stamp === record.sourceStamp
      const result = {
        ...verification, kind: kinds.verify, source, target, buildDirectory: record.runDir,
        sourceStamp: record.sourceStamp, layoutStamp: record.layoutStamp,
        ...(record.constraints && { constraints: record.constraints }),
      }
      if (record.constraints?.status === 'fail' && result.status === 'pass') {
        result.ok = false
        result.status = 'fail'
      }
      if (!checksStillCurrent) {
        result.ok = false
        result.status = 'error'
        result.error = [verification.error, checkedLayout.error, checkedSource.error,
          'source or layout could not be confirmed after verification'].filter(Boolean).join('; ')
      }
      if (verification.runDir) {
        await writeFile(join(verification.runDir, 'verification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
      }
      return result
    }
    case 'extract': {
      requireKind(input.record, 'verify')
      const extract = adapters.runLayoutPex ?? (await import('./layout-pex.js')).runLayoutPex
      const { record } = input
      const extraction = await extract(config, { verification: record, pdk: input.pdk })
      const result = { ...extraction, kind: kinds.extract, verification: {
        runId: record.runId, status: record.status, drc: record.drc?.status, lvs: record.lvs?.verdict,
      } }
      if (extraction.runDir) {
        await writeFile(join(extraction.runDir, 'extraction.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
      }
      return result
    }
    case 'simulate': {
      requireKind(input.record, 'extract')
      const simulate = adapters.runLayoutSimulation ?? (await import('./layout-simulation.js')).runLayoutSimulation
      const simulation = await simulate(config, { extraction: input.record, bench: input.bench })
      const result = { ...simulation, kind: kinds.simulate, verification: input.record.verification }
      if (simulation.runDir) {
        await writeFile(join(simulation.runDir, 'comparison.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
      }
      return result
    }
    default:
      throw new Error(`unknown layout action ${action}`)
  }
}
