/** OpenAccess reads and writes over the existing Virtuoso SKILL bridge. */
import { createHash, randomUUID } from 'node:crypto'
import { bridgeEval, diagnoseEvalResult } from './virtuoso.js'

const PROTOCOL = 'DSH_LAYOUT_OA_V1'
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

// SKILL source is built from data literals. No caller-provided expression is
// evaluated, including PCell parameter values and via overrides.
function literal(value) {
  if (value === null || value === false) return 'nil'
  if (value === true) return 't'
  if (typeof value === 'string' && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) return value.length === 0 ? 'nil' : `list(${value.map(literal).join(' ')})`
  throw new Error('Cannot encode value as a SKILL literal')
}

function reference(ref) {
  const fields = [ref?.lib, ref?.cell, ref?.view]
  if (fields.some((field) => typeof field !== 'string' || field.length === 0)) {
    throw new Error('Explicit library, cell and view are required')
  }
  return fields.map(literal).join(' ')
}

// The bridge wraps return strings using SKILL %L. Parse those strings and the
// enclosed list records with the same reader so quotes, separators and escaped
// newlines in instance parameters do not change record boundaries.
function parsePrinted(text) {
  const tokens = /\s*("(?:\\[\s\S]|[^"\\])*"|[()]|[^\s()"\\]+)/y
  let offset = 0
  function read() {
    tokens.lastIndex = offset
    const match = tokens.exec(text)
    if (!match) throw new Error('Invalid SKILL output token')
    offset = tokens.lastIndex
    const token = match[1]
    if (token === '(') {
      const values = []
      while (offset < text.length) {
        while (offset < text.length && /\s/.test(text[offset])) offset += 1
        if (text[offset] === ')') {
          offset += 1
          return values
        }
        values.push(read())
      }
      throw new Error('Unterminated SKILL list')
    }
    if (token === ')') throw new Error('Unexpected SKILL list terminator')
    if (token.startsWith('"')) {
      const escapes = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }
      return token.slice(1, -1).replace(/\\([\s\S])/g, (pair, letter) => escapes[letter] ?? pair)
    }
    if (token === 'nil') return null
    if (token === 't') return true
    if (NUMBER.test(token)) {
      const value = Number(token)
      if (Number.isFinite(value)) return value
      throw new Error('Nonfinite numeric value in SKILL output')
    }
    return token
  }
  const value = read()
  if (text.slice(offset).trim()) throw new Error('Extra text in SKILL output value')
  return value
}

function record(tag, ...values) {
  return `rows = cons(sprintf(nil "%L" list("${tag}" ${values.join(' ')})) rows)`
}

function header(type, ref) {
  return record('HEAD', `"${PROTOCOL}"`, `"${type}"`, 'cv~>libName', 'cv~>cellName',
    'cv~>viewName', `techGetTechLibName(ddGetObj(${literal(ref.lib)}))`, 'cv~>fileTimeStamp')
}

const finish = `${record('END')}\n      buildString(reverse(rows) "\\n")`

const netsAndTerms = `
      foreach(net cv~>nets
        ${record('NET', 'net~>name', 'net~>numBits', 'net~>sigType', 'net~>isGlobal')})
      foreach(term cv~>terminals
        ${record('TERM', 'term~>name', 'term~>net~>name', 'term~>direction', 'term~>numBits')})`

function readProgram(ref, kind, body) {
  const viewType = kind === 'schematic' ? 'schematic' : 'maskLayout'
  return `let((cv rows cdf)
    unwindProtect(
      progn(
        cv = dbOpenCellViewByType(${reference(ref)} "${viewType}" "r")
        unless(cv error("Cannot open the requested ${kind} cellview"))
        when(cv~>modifiedButNotSaved
          error("The requested ${kind} cellview has unsaved edits"))
        ${header(kind, ref)}
        ${netsAndTerms}
        ${body}
        ${finish}
      )
      when(cv dbClose(cv))
    )
  )`
}

function schematicProgram(source) {
  return readProgram(source, 'schematic', `
      foreach(inst cv~>instances
        unless(inst~>purpose == "pin" || inst~>pin
          ${record('INST', 'inst~>name', 'inst~>libName', 'inst~>cellName', 'inst~>viewName', 'inst~>numInst')}
          foreach(instTerm inst~>instTerms
            ${record('INSTTERM', 'inst~>name', 'instTerm~>name', 'instTerm~>net~>name')})
          foreach(param inst~>master~>parameters~>value
            ${record('PARAM', 'inst~>name', '"pcell"', 'param~>name', 'param~>valueType', 'param~>value')})
          cdf = cdfGetInstCDF(inst)
          when(cdf
            foreach(param cdf~>parameters
              ${record('PARAM', 'inst~>name', '"cdf"', 'param~>name', 'param~>type', 'param~>value')}))
          foreach(prop inst~>prop
            ${record('PARAM', 'inst~>name', '"instance"', 'prop~>name', 'prop~>valueType', 'prop~>value')})))`)
}

const layoutObjects = ({ geometry = false } = {}) => `
      ${record('UNITS', 'cv~>userUnits', 'cv~>DBUPerUU')}
      foreach(inst cv~>instances
        ${record('INST', 'inst~>name', 'inst~>libName', 'inst~>cellName', 'inst~>viewName',
          'inst~>numInst', 'inst~>xy', 'inst~>orient', 'inst~>bBox', 'inst~>master~>superMaster != nil')}
        foreach(instTerm inst~>instTerms
          foreach(pin instTerm~>term~>pins
            foreach(fig pin~>figs
              ${record('INSTPIN', 'inst~>name', 'instTerm~>name', 'fig~>layerName', 'fig~>purpose',
                'dbTransformBBox(fig~>bBox inst~>transform)')}))
          ${record('INSTTERM', 'inst~>name', 'instTerm~>name', 'instTerm~>net~>name')})
        foreach(param inst~>master~>parameters~>value
          ${record('PARAM', 'inst~>name', '"pcell"', 'param~>name', 'param~>valueType', 'param~>value')}))
      foreach(term cv~>terminals
        foreach(pin term~>pins
          foreach(fig pin~>figs
            ${record('PIN', 'term~>name', 'pin~>net~>name', 'fig~>layerName', 'fig~>purpose', 'fig~>bBox', 'pin~>name', 'fig~>objType')})))
      foreach(fig cv~>shapes
        unless(fig~>pin
          if(fig~>objType == "path" then
            ${record('ROUTE', 'fig~>net~>name', 'fig~>layerName', 'fig~>purpose', 'fig~>points', 'fig~>width', 'fig~>pathStyle', ...(geometry ? ['fig~>bBox'] : []))}
          else
            when(fig~>objType == "label"
              ${record('LABEL', 'fig~>theLabel', 'fig~>layerName', 'fig~>purpose', 'fig~>xy',
                'fig~>justify', 'fig~>orient', 'fig~>font', 'fig~>height', 'fig~>parent~>pin~>term~>name')})
            ${record('SHAPE', 'fig~>objType', 'fig~>net~>name', 'fig~>layerName', 'fig~>purpose', 'fig~>bBox',
              'when(fig~>objType == "label" fig~>theLabel)', 'when(fig~>objType == "polygon" fig~>points)')})))
      foreach(via cv~>vias
        ${record('VIA', 'via~>net~>name', 'via~>viaHeader~>viaDefName', 'via~>origin', 'via~>orient',
          'via~>viaHeader~>overrideParams', 'via~>bBox', 'via~>objType', ...(geometry ? [
            'via~>viaHeader~>viaDef~>layer1~>name', 'via~>viaHeader~>viaDef~>layer2~>name',
            'when(via~>objType == "stdVia" techGetLayerName(techGetTechFile(cv) via~>cutLayer))',
          ] : []))})`

function decodeSnapshot(output, expectedKind, requested) {
  if (typeof output !== 'string') throw new Error('OpenAccess reader returned no text')
  const raw = output.trim()
  const body = raw.startsWith('"') ? parsePrinted(raw) : raw
  if (typeof body !== 'string') throw new Error('OpenAccess reader returned a non-string payload')
  const rows = body.trim().split(/\r?\n/).map(parsePrinted)
  const identity = rows.shift()
  const end = rows.pop()
  if (!Array.isArray(identity) || !Array.isArray(end) || end.length !== 1 || end[0] !== 'END') {
    throw new Error('Incomplete OpenAccess snapshot')
  }
  const [tag, protocol, kind, lib, cell, view, techLib, fileTimeStamp] = identity
  if (tag !== 'HEAD' || protocol !== PROTOCOL || kind !== expectedKind
    || lib !== requested.lib || cell !== requested.cell || view !== requested.view) {
    throw new Error('OpenAccess snapshot identity mismatch')
  }
  const isLayout = expectedKind === 'layout'
  const result = {
    [isLayout ? 'target' : 'source']: { lib, cell, view }, techLib, fileTimeStamp,
    instances: [], nets: [], terms: [],
  }
  if (isLayout) Object.assign(result, { routes: [], vias: [], pins: [], labels: [], otherShapes: [] })

  const instances = new Map()
  const parameters = new Map()
  const pinFigures = new Map()
  for (const row of rows) {
    if (!Array.isArray(row)) throw new Error('Invalid OpenAccess snapshot record')
    const [type, a, b, c, d, e, f, g, h] = row
    switch (type) {
      case 'INST': {
        if (typeof a !== 'string' || instances.has(a)) throw new Error(`Invalid or duplicate OA instance ${a}`)
        const instance = isLayout
          ? { name: a, master: { lib: b, cell: c, view: d }, multiplicity: e,
            origin: f, orient: g, bbox: h, pcell: row[9] === true, parameters: [], terminals: [] }
          : { name: a, lib: b, cell: c, view: d, multiplicity: e, parameters: {}, terminals: [] }
        instances.set(a, instance)
        parameters.set(a, new Map())
        pinFigures.set(a, new Map())
        result.instances.push(instance)
        break
      }
      case 'PARAM': {
        const store = parameters.get(a)
        if (!store) throw new Error(`Parameter record precedes OA instance ${a}`)
        const byOrigin = store.get(c) ?? {}
        byOrigin[b] = { type: d, value: e, origin: b }
        store.set(c, byOrigin)
        break
      }
      case 'INSTTERM': {
        const instance = instances.get(a)
        if (!instance) throw new Error(`Terminal record precedes OA instance ${a}`)
        instance.terminals.push({ name: b, net: c })
        break
      }
      case 'INSTPIN': {
        const store = pinFigures.get(a)
        if (!store) throw new Error(`Pin record precedes OA instance ${a}`)
        const figures = store.get(b) ?? []
        figures.push({ layer: c, purpose: d, bbox: e })
        store.set(b, figures)
        break
      }
      case 'NET': result.nets.push({ name: a, bits: b, signalType: c, global: d === true }); break
      case 'TERM': result.terms.push({ name: a, net: b, direction: c, bits: d }); break
      case 'UNITS': result.userUnits = a; result.dbuPerUU = b; break
      case 'ROUTE': result.routes.push({ net: a, layer: b, purpose: c, points: d, width: e, style: f, ...(g && { bbox: g }) }); break
      case 'VIA': result.vias.push({ net: a, definition: b, origin: c, orient: d,
        parameters: (e ?? []).map(([name, value]) => ({ name, value })), bbox: f, kind: g, ...(row.length > 8 && { layers: [h, row[9], row[10]].filter(Boolean) }) }); break
      case 'PIN': result.pins.push({ term: a, net: b, layer: c, purpose: d, bbox: e, name: f, kind: g }); break
      case 'LABEL': result.labels.push({ text: a, layer: b, purpose: c, origin: d, justification: e,
        orient: f, font: g, height: h, term: row[9] }); break
      case 'SHAPE': result.otherShapes.push({ kind: a, net: b, layer: c, purpose: d, bbox: e, text: f, points: g }); break
      default: throw new Error(`Unknown OpenAccess record type ${type}`)
    }
  }
  for (const instance of result.instances) {
    const byName = parameters.get(instance.name)
    if (isLayout) {
      instance.parameters = [...byName].map(([name, { pcell: { type, value } }]) => ({
        name, type, value: type === 'boolean' && [true, null, 'TRUE', 'FALSE'].includes(value)
          ? value === true || value === 'TRUE' : value,
      }))
      const figures = pinFigures.get(instance.name)
      for (const term of instance.terminals) term.figures = figures.get(term.name) ?? []
    } else {
      instance.parameters = Object.fromEntries([...byName].map(([name, byOrigin]) => [
        name, byOrigin.instance ?? byOrigin.cdf ?? byOrigin.pcell,
      ]))
    }
  }
  // Include identities, OA revision and the actual content, independent of
  // enumeration order and transient OA object addresses.
  const sortedRows = rows.map((row) => {
    // Diagnostic geometry extends the readback without invalidating saved build stamps.
    const core = row[0] === 'ROUTE' ? row.slice(0, 7) : row[0] === 'VIA' ? row.slice(0, 8) : row
    return JSON.stringify(core)
  }).sort()
  result.stamp = createHash('sha256').update(JSON.stringify([identity, sortedRows])).digest('hex')
  if (isLayout) {
    result.contentStamp = createHash('sha256')
      .update(JSON.stringify([identity.slice(0, -1), sortedRows])).digest('hex')
  }
  return result
}

function skillErrors(candidate) {
  if (Array.isArray(candidate)) return candidate.flatMap(skillErrors)
  if (typeof candidate !== 'string') return []
  const text = candidate.trim()
  if (text.startsWith('(') || text.startsWith('"')) {
    // The daemon may return a printed errset record containing several errors.
    try {
      return skillErrors(parsePrinted(text))
    } catch {
      // A partial daemon diagnostic is still useful as text.
    }
  }
  return text.split(/\r?\n/).filter((line) => line.includes('*Error*'))
    .map((line) => line.slice(line.indexOf('*Error*')).trim())
}

async function evalSkill(config, skill, { evaluate = bridgeEval, timeoutSec = 120 } = {}) {
  const result = await evaluate(config, skill, { timeoutSec })
  if (result?.ok !== true) {
    const detail = diagnoseEvalResult(result)
    const errors = Array.isArray(result?.errors) ? result.errors.join(' ') : result?.errors
    const messages = [...skillErrors(result?.errors), ...skillErrors(result?.output)]
    const concrete = messages.find((message) => !/error while loading file/i.test(message))
    throw new Error(concrete || messages[0] || detail.errorText || errors || result?.error || result?.stderr
      || result?.parseError || detail.hint || 'Virtuoso SKILL evaluation failed')
  }
  if (typeof result.output === 'string' && /^\s*"?\*Error\*/.test(result.output)) {
    throw new Error(skillErrors(result.output)[0] ?? result.output)
  }
  return result.output
}

export async function readSchematic(config, source, options = {}) {
  try {
    const output = await evalSkill(config, schematicProgram(source), options)
    return { ok: true, schematic: decodeSnapshot(output, 'schematic', source) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

export async function readLayout(config, target, options = {}) {
  try {
    const output = await evalSkill(config, readProgram(target, 'layout', layoutObjects(options)), options)
    return { ok: true, layout: decodeSnapshot(output, 'layout', target) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function typedValue({ name, type, value }) {
  if (type === 'float' && typeof value === 'number' && Number.isFinite(value)) {
    const number = literal(value)
    return /[.eE]/.test(number) ? number : `${number}.0`
  }
  if ((type === 'int' && Number.isSafeInteger(value)) || (type === 'string' && typeof value === 'string')
    || (type === 'boolean' && typeof value === 'boolean')) return literal(value)
  throw new Error(`Invalid type or value for PCell parameter ${name} (${type})`)
}

function parameterArgument(parameters) {
  const entries = parameters.map((param) => `list(${literal(param.name)} ${literal(param.type)} ${typedValue(param)})`)
  return entries.length ? `list(${entries.join(' ')})` : 'nil'
}

function queriedList(output, kind) {
  const data = typeof output === 'string' && parsePrinted(output.trim())
  if (!Array.isArray(data) || data[0] !== kind) throw new Error(`Invalid Virtuoso ${kind} query result`)
  return data.slice(1)
}

/** Read the default master, or evaluate a variant in an unsaved scratch view. */
export async function inspectPcell(config, { master, inLib, parameters }, options = {}) {
  const scratchName = `dsh_query_${randomUUID().replaceAll('-', '')}`
  const scratch = parameters !== undefined
  const setup = scratch ? `
    when(ddGetObj(${literal(inLib)} ${literal(scratchName)})
      error("Scratch PCell query name already exists"))
    cv=dbOpenCellViewByType(${literal(inLib)} ${literal(scratchName)} "layout" "maskLayout" "s")
    unless(cv && cv~>mode == "s" error("Cannot open an unsaved scratch view"))
    inst=dbCreateParamInstByMasterName(cv ${reference(master)} nil list(0 0) "R0" 1 ${parameterArgument(parameters)})
    unless(inst && inst~>master~>superMaster error("Cannot evaluate the requested PCell variant"))
    actual=inst~>master` : `
    cv=dbOpenCellViewByType(${reference(master)} "maskLayout" "r")
    unless(cv && cv~>isParamCell error("Requested layout master is not a PCell"))
    when(cv~>modifiedButNotSaved error("Requested PCell has unsaved edits"))
    actual=cv`
  const skill = `let((cv actual inst data)
    data=unwindProtect(
      progn(
        ${setup}
        list("pcell" actual~>userUnits actual~>DBUPerUU actual~>bBox
          foreach(mapcar param actual~>parameters~>value
            list(param~>name param~>valueType param~>value))
          foreach(mapcar term actual~>terminals
            list(term~>name term~>direction
              foreach(mapcan pin term~>pins
                foreach(mapcar fig pin~>figs
                  list(fig~>layerName fig~>purpose fig~>objType fig~>bBox))))))
      )
      when(cv dbClose(cv))
    )
    ${scratch ? `when(ddGetObj(${literal(inLib)} ${literal(scratchName)})
      error("Scratch PCell query did not release its temporary view"))` : ''}
    data
  )`
  const [userUnits, dbuPerUU, bbox, rawParameters, rawTerminals] =
    queriedList(await evalSkill(config, skill, options), 'pcell')
  const values = (rawParameters ?? []).map(([name, type, value]) => ({
    name, type, value: type === 'boolean' ? value === true || value === 'TRUE' : value,
  }))
  for (const parameter of parameters ?? []) {
    const actual = values.find(({ name }) => name === parameter.name)
    const value = parameter.value
    const matches = parameter.type === 'float' && typeof actual?.value === 'number'
      ? Math.abs(actual.value - value) <= Math.abs(value) * 1e-12
      : actual?.value === value
    if (actual?.type !== parameter.type || !matches) {
      throw new Error(`PCell did not apply ${parameter.name} with the requested type and value`)
    }
  }
  return {
    master, geometry: scratch ? 'evaluated-variant' : 'default-master', userUnits, dbuPerUU, bbox,
    parameters: values,
    terminals: (rawTerminals ?? []).map(([name, direction, figures]) => ({
      name, direction, figures: (figures ?? []).map(([layer, purpose, kind, bbox]) => ({ layer, purpose, kind, bbox })),
    })),
  }
}

const standardViaFields = [
  'cutLayer', 'cutWidth', 'cutHeight', 'cutRows', 'cutColumns', 'cutSpacing',
  'layer1Enc', 'layer2Enc', 'layer1Offset', 'layer2Offset', 'originOffset',
  'implant1Enc', 'implant2Enc',
]

export async function inspectTech(config, { lib, layers, vias }, options = {}) {
  const skill = `let((library tf)
    library=ddGetObj(${literal(lib)})
    unless(library error("Virtuoso library does not exist"))
    tf=techGetTechFile(library)
    unless(tf error("No technology is attached to the library"))
    list("tech" techGetTechLibName(library) techGetMfgGridResolution(tf)
      foreach(mapcar lp ${layers.length ? `setof(l tf~>lps member(l~>name ${literal(layers)}))` : 'tf~>lps'}
        list(lp~>name lp~>purpose lp~>layer~>number techGetPurposeNum(tf lp~>purpose) lp~>valid))
      foreach(mapcar vd ${vias.length ? `setof(v tf~>viaDefs member(v~>name ${literal(vias)}))` : 'tf~>viaDefs'}
        list(vd~>name vd~>objType vd~>layer1~>name vd~>layer2~>name
          when(vd~>objType == "stdViaDef" vd~>params))))
  )`
  const [techLib, manufacturingGrid, rawLpps, rawVias] =
    queriedList(await evalSkill(config, skill, options), 'tech')
  const layerPurposes = (rawLpps ?? []).map(([layer, purpose, layerNumber, purposeNumber, valid]) => ({
    layer, purpose, layerNumber, purposeNumber, valid: valid === true,
  })).sort((a, b) => a.layer.localeCompare(b.layer) || a.purpose.localeCompare(b.purpose))
  const viaDefinitions = (rawVias ?? []).map(([name, kind, layer1, layer2, params]) => ({
    name, kind, layer1, layer2,
    defaults: params ? Object.fromEntries(standardViaFields.slice(0, params.length)
      .map((field, index) => [field, params[index]])) : null,
  })).sort((a, b) => a.name.localeCompare(b.name))
  return { lib, techLib, manufacturingGrid, layerPurposes, viaDefinitions,
    missingLayers: layers.filter((name) => !layerPurposes.some(({ layer }) => layer === name)),
    missingVias: vias.filter((name) => !viaDefinitions.some((via) => via.name === name)),
  }
}

function requireSkill(condition, message) {
  return `unless(${condition} error("%s" ${literal(message)}))`
}

function parameterCheck(instance, param) {
  const { name, type, value } = param
  const wanted = typedValue(param)
  let matches = `equal(actual~>value ${wanted})`
  if (type === 'boolean') {
    matches = `(${matches} || equal(actual~>value ${literal(value ? 'TRUE' : 'FALSE')}))`
  }
  if (type === 'float' && value !== 0) {
    // Some OA APIs round their float values to single precision. This tolerance
    // covers that representation without accepting a different process-grid size.
    matches = `numberp(actual~>value) && abs(actual~>value - ${wanted}) <= ${literal(Math.abs(value) * 1e-7)}`
  }
  return `actual = car(setof(candidate inst~>master~>parameters~>value equal(candidate~>name ${literal(name)})))
    ${requireSkill(`actual && equal(actual~>valueType ${literal(type)}) && ${matches}`,
      `PCell ${instance.name} did not materialize ${name} (${type}) with the specified value`)}`
}

function checkPoints(actual, wanted, message) {
  return `actualPoints = ${actual}
    ${requireSkill(`length(actualPoints) == ${wanted.length}`, message)}
    foreach(wantedPoint ${literal(wanted)}
      actualPoint = car(actualPoints)
      actualPoints = cdr(actualPoints)
      ${requireSkill('abs(xCoord(actualPoint) - xCoord(wantedPoint)) < epsilon && abs(yCoord(actualPoint) - yCoord(wantedPoint)) < epsilon', message)})`
}

function buildCommands(plan) {
  const commands = []
  for (const { name, bits, signalType, global } of plan.nets) {
    commands.push(`net = dbMakeNet(cv ${literal(name)})`,
      requireSkill(`net && equal(net~>name ${literal(name)}) && net~>numBits == ${literal(bits)} && equal(net~>isGlobal ${literal(global)})`,
        `Could not create OA net ${name} with its source name, width and global status`))
    if (signalType !== null) commands.push(`net~>sigType = ${literal(signalType)}`)
    commands.push(
      requireSkill(`equal(net~>sigType ${literal(signalType)})`, `Could not set signal type of OA net ${name}`),
      `netIds[${literal(name)}] = net`)
  }
  for (const { name, net, direction, bits } of plan.terms) {
    const netId = `netIds[${literal(net)}]`
    commands.push(`term = dbCreateTerm(${netId} ${literal(name)} ${literal(direction)})`,
      requireSkill(`term && term~>net == ${netId} && equal(term~>name ${literal(name)}) && term~>numBits == ${literal(bits)} && equal(term~>direction ${literal(direction)})`,
        `Could not create OA terminal ${name}`),
      `termIds[${literal(name)}] = term`)
  }
  for (const instance of plan.instances) {
    const { name, master, origin, orient, parameters, terminals, multiplicity = 1 } = instance
    const paramArg = parameterArgument(parameters)
    commands.push(`inst = dbCreateParamInstByMasterName(cv ${reference(master)} ${literal(name)} ${literal(origin)} ${literal(orient)} ${literal(multiplicity)} ${paramArg})`,
      requireSkill(`inst && inst~>master~>superMaster && equal(inst~>name ${literal(name)}) && inst~>numInst == ${literal(multiplicity)} && equal(inst~>orient ${literal(orient)})`,
        `Could not create the requested PCell instance ${name}`),
      checkPoints('list(inst~>xy)', [origin], `OA changed the placement coordinates for PCell ${name}`),
      ...parameters.map((param) => parameterCheck(instance, param)))
    for (const { name: terminal, net } of terminals) {
      commands.push(`masterTerm = dbFindTermByName(inst~>master ${literal(terminal)})`,
        requireSkill('masterTerm', `PCell ${name} does not have terminal ${terminal}`))
      if (net !== null) {
        const netId = `netIds[${literal(net)}]`
        commands.push(`instTerm = dbCreateInstTerm(${netId} inst masterTerm)`,
          requireSkill(`instTerm && instTerm~>net == ${netId} && instTerm~>term == masterTerm`,
            `Could not bind PCell terminal ${name}.${terminal} to ${net}`))
      }
    }
  }
  for (const { id, net, layer, purpose, bbox } of plan.rectangles ?? []) {
    const netId = `netIds[${literal(net)}]`
    commands.push(`fig = dbCreateRect(cv ${literal([layer, purpose])} ${literal(bbox)})`,
      requireSkill(`fig && dbAddFigToNet(fig ${netId}) && fig~>net == ${netId} && equal(fig~>lpp ${literal([layer, purpose])})`,
        `Could not create OA rectangle ${id} on ${net}`),
      checkPoints('fig~>bBox', bbox, `OA changed the bounds of rectangle ${id}`))
  }
  for (const [index, route] of plan.routes.entries()) {
    const { net, layer, purpose, points, width, style } = route
    const label = `path ${index + 1} on ${net}`
    const netId = `netIds[${literal(net)}]`
    commands.push(`fig = dbCreatePath(cv ${literal([layer, purpose])} ${literal(points)} ${literal(width)} ${literal(style)})`,
      requireSkill(`fig && dbAddFigToNet(fig ${netId}) && fig~>net == ${netId}`, `Could not create OA ${label}`),
      requireSkill(`equal(fig~>lpp ${literal([layer, purpose])}) && equal(fig~>pathStyle ${literal(style)}) && abs(fig~>width - ${literal(width)}) < epsilon`,
        `OA changed the layer, style or width for ${label}`),
      checkPoints('fig~>points', points, `OA changed the points for ${label}`))
  }
  for (const [index, via] of plan.vias.entries()) {
    const { net, definition, origin, orient, parameters = [] } = via
    const netId = `netIds[${literal(net)}]`
    commands.push(`viaDef = techFindViaDefByName(tech ${literal(definition)})`,
      requireSkill('viaDef', `Target technology has no via definition ${definition}`),
      `fig = dbCreateVia(cv viaDef ${literal(origin)} ${literal(orient)} ${literal(parameters.map(({ name, value }) => [name, value]))})`,
      requireSkill(`fig && equal(fig~>viaHeader~>viaDefName ${literal(definition)}) && equal(fig~>orient ${literal(orient)}) && dbAddFigToNet(fig ${netId}) && fig~>net == ${netId}`,
        `Could not create OA via ${index + 1} on ${net}`),
      checkPoints('list(fig~>origin)', [origin], `OA changed the origin of via ${index + 1} on ${net}`))
    for (const { name, value } of parameters) {
      commands.push(`actual = assoc(${literal(name)} fig~>viaHeader~>overrideParams)`,
        requireSkill(`actual && equal(cadr(actual) ${literal(value)})`,
          `OA via ${index + 1} on ${net} did not retain override ${name}`))
    }
  }
  for (const pin of plan.pins) {
    const { term, layer, purpose, bbox, name = null, label } = pin
    commands.push(`term = termIds[${literal(term)}]`,
      `fig = dbCreateRect(cv ${literal([layer, purpose])} ${literal(bbox)})`,
      requireSkill(`fig && equal(fig~>lpp ${literal([layer, purpose])})`, `Could not create pin figure for OA terminal ${term}`),
      checkPoints('fig~>bBox', bbox, `OA changed the pin bounds for terminal ${term}`),
      `pin = dbCreatePin(term~>net fig ${literal(name)} term)`,
      requireSkill('pin && pin~>term == term && pin~>net == term~>net', `Could not bind the pin to OA terminal ${term}`))
    if (label) {
      const { layer: labelLayer, purpose: labelPurpose, origin, text, justification, orient, font, height } = label
      const [[x0, y0], [x1, y1]] = bbox
      if (text !== term || origin[0] < x0 || origin[0] > x1 || origin[1] < y0 || origin[1] > y1) {
        throw new Error(`The label for ${term} must name the source terminal and lie on its pin bounds`)
      }
      commands.push(`label = dbCreateLabel(cv ${literal([labelLayer, labelPurpose])} ${literal(origin)} ${literal(text)} ${literal(justification)} ${literal(orient)} ${literal(font)} ${literal(height)})`,
        requireSkill(`label && equal(label~>theLabel ${literal(text)}) && equal(label~>lpp ${literal([labelLayer, labelPurpose])})
          && equal(label~>justify ${literal(justification)}) && equal(label~>orient ${literal(orient)})
          && equal(label~>font ${literal(font)}) && abs(label~>height - ${literal(height)}) < epsilon`,
        `Could not create the requested stream label for OA terminal ${term}`),
        checkPoints('list(label~>xy)', [origin], `OA changed the label origin for terminal ${term}`),
        'label~>parent = fig', requireSkill('label~>parent == fig', `Could not associate label with OA terminal ${term}`))
    }
  }
  return commands.join('\n      ')
}

function writeProgram(plan, sourceRevision) {
  const source = reference(plan.source)
  const target = reference(plan.target)
  const tech = literal(plan.techLib)
  const label = `${plan.target.lib}/${plan.target.cell}/${plan.target.view}`
  if (source === target) throw new Error('Schematic and layout target must be distinct cellviews')
  return `let((cv sourceCv existing targetLib tech net term inst masterTerm instTerm actual fig viaDef pin label
      actualPoints actualPoint epsilon writeOwned saved rows payload
      (netIds makeTable('dshLayoutNetIds nil)) (termIds makeTable('dshLayoutTermIds nil)))
    unwindProtect(progn(
      sourceCv = dbOpenCellViewByType(${source} "schematic" "r")
      ${requireSkill('sourceCv && !sourceCv~>modifiedButNotSaved', 'The saved source schematic is unavailable')}
      ${sourceRevision === undefined ? '' : requireSkill(`equal(sourceCv~>fileTimeStamp ${literal(sourceRevision)})`,
        'The source schematic changed since its readback')}
      ${requireSkill(`equal(techGetTechLibName(ddGetObj(${literal(plan.source.lib)})) ${tech})`,
        `The source schematic library is not bound to the requested technology ${plan.techLib}`)}
      targetLib = ddGetObj(${literal(plan.target.lib)})
      ${requireSkill(`targetLib && equal(techGetTechLibName(targetLib) ${tech})`,
        `The target library is not bound to the requested technology ${plan.techLib}`)}
      existing = ddGetObj(${target})
      when(existing
        ddReleaseObj(existing)
        error("%s" ${literal(`Target cellview already exists: ${label}`)}))
      ${requireSkill(`!dbFindOpenCellView(targetLib ${literal(plan.target.cell)} ${literal(plan.target.view)})`,
        `Target cellview is already open: ${label}`)}
      cv = dbOpenCellViewByType(${target} "maskLayout" "a")
      ${requireSkill('cv && cv~>mode == "a"', `Could not acquire the OA edit lock for ${label}`)}
      ${requireSkill('!cv~>instances && !cv~>shapes && !cv~>nets && !cv~>terminals && !cv~>vias',
        `Target cellview acquired existing content: ${label}`)}
      writeOwned = t
      tech = techGetTechFile(cv)
      ${requireSkill('tech', `Target cellview has no technology file: ${label}`)}
      ${plan.userUnits === undefined ? '' : requireSkill(`equal(cv~>userUnits ${literal(plan.userUnits)})`,
        `Target cellview does not use ${plan.userUnits}: ${label}`)}
      epsilon = 0.000001 / cv~>DBUPerUU
      ${buildCommands(plan)}
      ${header('layout', plan.target)}
      ${netsAndTerms}
      ${layoutObjects()}
      ${record('END')}
      payload = buildString(reverse(rows) "\\n")
      ${requireSkill('dbSave(cv)', `Could not save OA layout ${label}`)}
      saved = t
      payload
    )
    unwindProtect(
      when(cv
        if(writeOwned && !saved then dbPurge(cv) else dbClose(cv)))
      when(sourceCv dbClose(sourceCv))
    ))
  )`
}

export async function writeLayout(config, plan, options = {}) {
  let sourceRevision
  let output
  try {
    if (typeof plan.techLib !== 'string' || !plan.techLib) throw new Error('Explicit target technology is required')
    if (plan.sourceStamp !== undefined) {
      const current = await readSchematic(config, plan.source, options)
      if (!current.ok) return { ok: false, stage: 'source-recheck', error: current.error }
      if (current.schematic.stamp !== plan.sourceStamp) {
        return { ok: false, stage: 'source-recheck', error: 'The saved source schematic changed since planning' }
      }
      sourceRevision = current.schematic.fileTimeStamp
    }
    output = await evalSkill(config, writeProgram(plan, sourceRevision), options)
  } catch (error) {
    return { ok: false, stage: 'write', error: error.message }
  }
  const readback = await readLayout(config, plan.target, options)
  if (!readback.ok) return { ...readback, stage: 'readback', saved: true }
  try {
    const materialized = decodeSnapshot(output, 'layout', plan.target)
    if (materialized.contentStamp !== readback.layout.contentStamp) {
      throw new Error('The reopened layout differs from the OA geometry or connectivity before save')
    }
  } catch (error) {
    return { ok: false, stage: 'readback', saved: true, error: error.message, layout: readback.layout }
  }
  return readback
}
