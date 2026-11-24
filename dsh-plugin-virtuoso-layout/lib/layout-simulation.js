import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { run, runWithInput, sshArgs } from './virtuoso.js'

const STAGES = ['before', 'after']
const DEVICE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const NODE_NAME = /^(?:[A-Za-z_][A-Za-z0-9_]*|0)$/
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const SOLVER_KEYS = ['start', 'stop', 'maxstep', 'skipdc', 'reltol', 'abstol(V)', 'abstol(I)',
  'temp', 'tnom', 'errpreset', 'method', 'lteratio', 'relref', 'cmin', 'gmin']
const FILES = { bench: 'bench.scs', benchConfig: 'bench.json', sourceCdl: 'source.cdl', dspf: 'extraction.spf' }
const EVIDENCE = 'DSH_LAYOUT_SIM'

function requireThat(test, message) {
  if (!test) throw new Error(message)
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function finite(value, field) {
  requireThat(typeof value === 'number' && Number.isFinite(value), field + ' must be a finite number')
  return value
}

function positive(value, field) {
  requireThat(finite(value, field) > 0, field + ' must be positive')
  return value
}

function node(value, field) {
  requireThat(typeof value === 'string' && NODE_NAME.test(value) && value !== 'time',
    field + ' must be 0 or a simple Spectre node name other than time')
  return value
}

function windowBounds(bounds, stop) {
  const { afterSeconds = 0, beforeSeconds = stop } = bounds
  requireThat(finite(afterSeconds, 'afterSeconds') >= 0 && finite(beforeSeconds, 'beforeSeconds') <= stop
    && afterSeconds < beforeSeconds, 'measurement window must be within the transient duration')
  return { afterSeconds, beforeSeconds }
}

function edge(input, stop) {
  requireThat(isObject(input) && ['rising', 'falling'].includes(input.edge),
    'delay requires an explicit rising or falling edge')
  return {
    node: node(input.node, 'measurement node'), edge: input.edge, volts: finite(input.volts, 'edge volts'),
    ...windowBounds(input, stop),
  }
}

function measurements(input, stop) {
  requireThat(Array.isArray(input) && input.length > 0, 'bench.measurements must specify at least one measurement')
  const names = new Set()
  return input.map((item) => {
    requireThat(isObject(item) && typeof item.name === 'string' && item.name.trim() && !names.has(item.name),
      'each measurement needs a unique nonempty name')
    const { name, kind } = item
    names.add(name)
    if (kind === 'delay') return { name, kind, from: edge(item.from, stop), to: edge(item.to, stop) }
    const signal = node(item.node, 'measurement node')
    if (kind === 'value') {
      const time = finite(item.atSeconds, 'atSeconds')
      requireThat(time >= 0 && time <= stop, 'atSeconds must be within the transient duration')
      return { name, kind, node: signal, atSeconds: time }
    }
    requireThat(['min', 'max', 'swing'].includes(kind), 'unknown measurement kind ' + kind)
    return { name, kind, node: signal, ...windowBounds(item, stop) }
  })
}

function sourceParameters(source) {
  if (source.type === 'dc') return 'vsource type=dc dc=' + finite(source.volts, 'DC source volts')
  if (source.type === 'current') return 'isource type=dc dc=' + finite(source.amps, 'DC source amps')
  requireThat(source.type === 'pulse', 'source type must be dc, current or pulse')
  const low = finite(source.lowVolts, 'pulse lowVolts')
  const high = finite(source.highVolts, 'pulse highVolts')
  const delay = finite(source.delaySeconds, 'pulse delaySeconds')
  const rise = positive(source.riseSeconds, 'pulse riseSeconds')
  const fall = positive(source.fallSeconds, 'pulse fallSeconds')
  const width = positive(source.widthSeconds, 'pulse widthSeconds')
  const period = positive(source.periodSeconds, 'pulse periodSeconds')
  requireThat(delay >= 0 && period >= rise + width + fall, 'pulse delay or period is inconsistent with its edges and width')
  return 'vsource type=pulse val0=' + low + ' val1=' + high + ' delay=' + delay
    + ' rise=' + rise + ' fall=' + fall + ' width=' + width + ' period=' + period
}

function makeBench(bench, subckt) {
  requireThat(isObject(bench) && isObject(bench.pins) && isObject(bench.transient), 'bench pins and transient are required')
  const { model, simulator = { executable: 'spectre' }, sources, capacitors = [], resistors = [] } = bench
  const absoluteGuestPath = (value) => typeof value === 'string' && value.startsWith('/') &&
    !/[\x00-\x1f\x7f"\\]/.test(value)
  requireThat(isObject(simulator) && (simulator.executable === 'spectre' || absoluteGuestPath(simulator.executable)) &&
    (simulator.licenseFile === undefined || absoluteGuestPath(simulator.licenseFile)),
  'bench.simulator requires spectre or its absolute guest path and an optional guest license path')
  requireThat(isObject(model) && typeof model.file === 'string' && model.file.startsWith('/')
    && !/[\x00-\x1f\x7f"\\]/.test(model.file) && typeof model.section === 'string' && DEVICE_NAME.test(model.section),
  'bench.model requires an absolute guest file and a Spectre section')
  const pins = new Map(Object.entries(bench.pins).map(([port, value]) => [port.toLowerCase(), node(value, 'bench pin ' + port)]))
  const connections = subckt.ports.map((port) => pins.get(port.toLowerCase()))
  requireThat(connections.every(Boolean) && pins.size === connections.length && pins.size === Object.keys(bench.pins).length,
    'bench.pins must map each source subcircuit port exactly once: ' + subckt.ports.join(' '))
  const stop = positive(bench.transient.stopSeconds, 'transient.stopSeconds')
  const step = positive(bench.transient.maxStepSeconds, 'transient.maxStepSeconds')
  const temperature = finite(bench.transient.temperatureC, 'transient.temperatureC')
  requireThat(step <= stop && temperature >= -273.15, 'transient max step or temperature is out of range')

  const names = new Set(['xdut', 'simoptions', 'tran', 'saveoptions'])
  const nodes = new Set(connections)
  const components = (items, label, parameters) => {
    requireThat(Array.isArray(items), 'bench.' + label + ' must be an array')
    return items.map((item) => {
      requireThat(isObject(item) && typeof item.name === 'string' && DEVICE_NAME.test(item.name)
        && !names.has(item.name.toLowerCase()), 'invalid or repeated component name in bench.' + label)
      names.add(item.name.toLowerCase())
      const terminals = [node(item.positive, item.name + '.positive'), node(item.negative, item.name + '.negative')]
      terminals.forEach((terminal) => nodes.add(terminal))
      return item.name + ' (' + terminals.join(' ') + ') ' + parameters(item)
    })
  }
  const devices = [
    ...components(sources, 'sources', sourceParameters),
    ...components(capacitors, 'capacitors', (item) => 'capacitor c=' + positive(item.farads, 'capacitor farads')),
    ...components(resistors, 'resistors', (item) => 'resistor r=' + positive(item.ohms, 'resistor ohms')),
  ]
  const measures = measurements(bench.measurements, stop)
  const measuredNodes = measures.flatMap((measure) => measure.kind === 'delay'
    ? [measure.from.node, measure.to.node] : [measure.node])
  requireThat(measuredNodes.every((signal) => signal !== '0' && nodes.has(signal)),
    'measurements must name non-ground nodes in the testbench')
  const signals = [...new Set(measuredNodes)]
  const common = [
    'simulator lang=spectre',
    'global 0',
    'include "' + model.file + '" section=' + model.section,
    'include "' + FILES.sourceCdl + '"',
    'Xdut (' + connections.join(' ') + ') ' + subckt.name,
    ...devices,
    'simOptions options temp=' + temperature,
    'tran tran stop=' + stop + ' maxstep=' + step + ' errpreset=conservative',
    'saveOptions options save=selected',
    'save ' + signals.join(' '),
    '',
  ].join('\n')
  return { model: { file: model.file, section: model.section }, simulator, stop, signals, measures, common }
}

// Read the positional SPICE .SUBCKT interface, including continuation lines.
async function readSubckt(file, cell, { dspf = false } = {}) {
  const input = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let header
  let groundNet
  try {
    for await (const raw of lines) {
      const line = raw.trim()
      if (dspf) groundNet ??= /^\*\|GROUND_NET\s+(\S+)/i.exec(line)?.[1]
      if (!line || line.startsWith('*')) continue
      if (header && !line.startsWith('+')) break
      if (header) {
        header.args += ' ' + line.slice(1)
        continue
      }
      const declaration = /^\.subckt\s+(\S+)(.*)$/i.exec(line)
      if (declaration?.[1].toLowerCase() === cell.toLowerCase()) {
        header = { name: declaration[1], args: declaration[2] }
      }
    }
  } finally {
    lines.close()
    input.destroy()
  }
  requireThat(header, 'missing .SUBCKT ' + cell + ' in ' + file)
  const ports = []
  for (const token of header.args.trim().split(/\s+/)) {
    if (!token || /^(?:params?:|\$)/i.test(token) || token.includes('=')) break
    ports.push(token)
  }
  requireThat(ports.length === new Set(ports.map((port) => port.toLowerCase())).size,
    'duplicate port name in ' + file)
  return { name: header.name, ports, groundNet }
}

async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function scp(config) {
  const options = sshArgs(config, '').slice(0, -1)
  const host = options.pop()
  options[options.indexOf('-p')] = '-P'
  return { host, options: ['-O', ...options] }
}

const shellArg = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'"
const failureText = (result) => result.timedOut ? 'command timed out'
  : result.error || result.stderr?.trim() || 'exit ' + result.code

function executionScript({ remoteRunDir, runId, model, simulator, digests, timeoutMs }) {
  const inputs = [
    [FILES.bench, digests.bench], [FILES.sourceCdl, digests.sourceCdl], [FILES.dspf, digests.dspf],
    ['before.scs', digests.before], ['after.scs', digests.after],
  ]
  const verifyInput = inputs.map(([path, hash]) => 'verify ' + shellArg(path) + ' ' + shellArg(hash)).join('\n')
  return [
    'set -eu',
    'export LC_ALL=C CDS_AUTO_64BIT=ALL',
    ...(simulator.licenseFile === undefined ? [] : ['export CDS_LIC_FILE=' + shellArg(simulator.licenseFile)]),
    'cd ' + shellArg(remoteRunDir),
    'record() { printf "%s %s %s\\n" ' + EVIDENCE + ' ' + shellArg(runId) + ' "$*"; }',
    'fingerprint() { sha256sum -- "$1" | cut -d " " -f1; }',
    'verify() { [[ -s "$1" && "$(fingerprint "$1")" == "$2" ]] || { echo "input fingerprint differs: $1" >&2; exit 1; }; }',
    verifyInput,
    'model=' + shellArg(model.file),
    'model_digest=$(fingerprint "$model")',
    '[[ -n "$model_digest" ]] || { echo "Spectre model is not readable: $model" >&2; exit 1; }',
    'uptime_seconds() { local t idle; read -r t idle < /proc/uptime; printf "%s" "${t%%.*}"; }',
    'deadline=$(($(uptime_seconds) + ' + Math.ceil(timeoutMs / 1000) + '))',
    'for phase in before after; do',
    '  mkdir -- "$phase"',
    '  mv -- "$phase.scs" "$phase/"',
    '  remaining=$((deadline - $(uptime_seconds)))',
    '  code=124',
    '  if ((remaining > 0)); then',
    '    code=0',
    '    (cd "$phase"; timeout -s KILL "$remaining" ' + shellArg(simulator.executable)
      + ' "$phase.scs" -format psfascii -raw psf +log spectre.out > spectre.stdout 2>&1) || code=$?',
    '  fi',
    '  record exit "$phase" "$code"',
    '  for output in spectre.out spectre.stdout psf/logFile psf/tran.tran.tran psf/tran.tran; do',
    '    if [[ -s "$phase/$output" ]]; then record file "$phase" "$output"; fi',
    '  done',
    'done',
    verifyInput.split('\n').slice(0, 3).join('\n'),
    "verify before/before.scs " + shellArg(digests.before),
    "verify after/after.scs " + shellArg(digests.after),
    'verify "$model" "$model_digest"',
    'record model "$model_digest"',
    'record done',
    '',
  ].join('\n')
}

function executionEvidence(stdout, runId) {
  const evidence = { before: { files: new Set() }, after: { files: new Set() } }
  const prefix = EVIDENCE + ' ' + runId + ' '
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue
    const [action, field, value] = line.slice(prefix.length).split(' ')
    if (action === 'exit' && STAGES.includes(field) && /^\d{1,3}$/.test(value)) {
      evidence[field].exitCode = Number(value)
    }
    if (action === 'file' && STAGES.includes(field)) evidence[field].files.add(value)
    if (action === 'model' && /^[a-f0-9]{64}$/.test(field)) evidence.modelSha256 = field
    if (action === 'done') evidence.completed = true
  }
  return evidence
}

function readSpectreLog(text, stage, context) {
  const version = /^Version\s+([^\r\n]+)/m.exec(text)?.[1].trim()
  const completed = /^spectre completes with (\d+) errors?, (\d+) warnings?, and (\d+) notices?\./im.exec(text)
  requireThat(version && completed && Number(completed[1]) === 0, 'Spectre log has no successful completion receipt')
  const directory = posix.join(context.remoteRunDir, stage)
  requireThat(text.includes('Current working directory: ' + directory), 'Spectre log belongs to a different run')
  const readPaths = [...text.matchAll(/^Reading file:\s+([^\r\n]+)/gm)]
    .map((match) => posix.resolve(directory, match[1].trim()))
  const input = posix.join(directory, stage + '.scs')
  const dspf = posix.join(context.remoteRunDir, FILES.dspf)
  const commonFiles = [FILES.bench, FILES.sourceCdl].map((file) => posix.join(context.remoteRunDir, file))
  requireThat([input, context.model.file, ...commonFiles].every((path) => readPaths.includes(path)),
    'Spectre did not read the staged testbench, input CDL and model')
  const replacement = /Subckt \x60([^\r\n']+)' defined in the file [^\r\n]+ will be replaced with subckt \x60([^\r\n']+)' specified in the DSPF file/m
    .exec(text)
  const usesDspf = readPaths.includes(dspf)
  if (stage === 'after') {
    requireThat(usesDspf && replacement?.slice(1).every((name) => name.toLowerCase() === context.cell.toLowerCase()),
      'Spectre did not confirm DSPF replacement of ' + context.cell)
  } else {
    requireThat(!usesDspf && !replacement, 'schematic Spectre run included extracted parasitics')
  }
  const inventoryBlock = /^Circuit inventory:\r?\n((?:[ \t]+\S+[ \t]+\d+[ \t]*\r?\n)+)/m.exec(text)?.[1]
  requireThat(inventoryBlock, 'Spectre log has no circuit inventory')
  const inventory = Object.fromEntries(inventoryBlock.trim().split(/\r?\n/).map((line) => {
    const [device, count] = line.trim().split(/\s+/)
    return [device, Number(count)]
  }))
  const sharedInputs = [...new Set(readPaths.filter((path) => path !== input && path !== dspf))].sort()
  const diagnostics = [...text.matchAll(/^(?:Notice|Warning) from spectre[^\r\n]*\r?\n(?:[ \t]+[^\r\n]+\r?\n?)*/gim)]
    .map(([block]) => block.trim())
  return { version, warnings: Number(completed[2]), notices: Number(completed[3]), diagnostics, usesDspf, inventory, sharedInputs }
}

// Spectre ASCII PSF can delta-compress dependent signals between time markers.
function parseTran(text, signals, stop) {
  const sections = new Set()
  const trace = new Set()
  const aliases = new Map()
  const rows = []
  const values = new Map()
  const header = {}
  let section
  let group
  let time
  let hasTimeSweep = false
  const snapshot = () => {
    if (time === undefined) return
    const point = [time, ...signals.map((signal) => values.get(signal))]
    requireThat(point.every(Number.isFinite), 'PSF is missing requested waveform values at ' + time + ' s')
    const previous = rows.at(-1)
    requireThat(!previous || time >= previous[0], 'PSF sample times are out of order')
    if (previous && time === previous[0]) rows[rows.length - 1] = point
    else rows.push(point)
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (['HEADER', 'TYPE', 'SWEEP', 'TRACE', 'VALUE', 'END'].includes(line)) {
      section = line
      sections.add(line)
      if (section === 'END') break
      continue
    }
    const row = /^"([^"]+)"\s+(.+)$/.exec(line)
    if (!row) continue
    const [, key, value] = row
    if (section === 'HEADER') header[key] = value.replace(/^"|"$/g, '')
    if (section === 'SWEEP' && key === 'time') hasTimeSweep = true
    if (section === 'TRACE') {
      if (value.startsWith('GROUP ')) {
        group = key
      } else {
        if (group !== undefined) aliases.set(group, key)
        trace.add(key)
        group = undefined
      }
    }
    if (section !== 'VALUE') continue
    if (key === 'time') {
      snapshot()
      requireThat(NUMBER.test(value), 'PSF has a nonnumeric time sample')
      time = Number(value)
      continue
    }
    const signal = aliases.get(key) ?? key
    if (signals.includes(signal)) {
      requireThat(NUMBER.test(value), 'PSF has a nonnumeric value for ' + signal)
      values.set(signal, Number(value))
    }
  }
  snapshot()
  requireThat(['HEADER', 'SWEEP', 'TRACE', 'VALUE', 'END'].every((name) => sections.has(name))
    && header.simulator === 'spectre' && header['analysis type'] === 'tran' && hasTimeSweep,
  'artifact is not a complete Spectre ASCII transient PSF')
  requireThat(signals.every((signal) => trace.has(signal)), 'PSF does not include every requested waveform trace')
  const tolerance = Math.max(stop * 1e-9, 1e-21)
  requireThat(rows.length > 1 && Math.abs(rows[0][0]) <= tolerance && Math.abs(rows.at(-1)[0] - stop) <= tolerance,
    'PSF does not cover the requested transient interval')
  const solver = Object.fromEntries(SOLVER_KEYS.map((key) => [key, header[key]]))
  requireThat(SOLVER_KEYS.every((key) => solver[key] !== undefined), 'PSF lacks effective solver settings')
  return { rows, columns: ['time_s', ...signals], solver }
}

function sampleAt(rows, column, time) {
  let earlier = 0
  let later = rows.length - 1
  if (time <= rows[earlier][0]) return rows[earlier][column]
  if (time >= rows[later][0]) return rows[later][column]
  while (later - earlier > 1) {
    const center = Math.floor((earlier + later) / 2)
    if (rows[center][0] > time) later = center
    else earlier = center
  }
  const lower = rows[earlier]
  const upper = rows[later]
  return lower[column] + (upper[column] - lower[column]) * (time - lower[0]) / (upper[0] - lower[0])
}

function windowSamples(tran, { node: signal, afterSeconds, beforeSeconds }) {
  const column = tran.columns.indexOf(signal, 1)
  const points = [[afterSeconds, sampleAt(tran.rows, column, afterSeconds)]]
  for (const row of tran.rows) {
    if (row[0] > afterSeconds && row[0] < beforeSeconds) points.push([row[0], row[column]])
  }
  points.push([beforeSeconds, sampleAt(tran.rows, column, beforeSeconds)])
  return points
}

function crossing(tran, spec) {
  const samples = windowSamples(tran, spec)
  const level = spec.volts
  for (let index = 1; index < samples.length; index++) {
    const [t0, v0] = samples[index - 1]
    const [t1, v1] = samples[index]
    const crossed = spec.edge === 'rising' ? v0 < level && v1 >= level : v0 > level && v1 <= level
    if (crossed) return t0 + (t1 - t0) * (level - v0) / (v1 - v0)
  }
  throw new Error('no ' + spec.edge + ' crossing of ' + level + ' V on ' + spec.node
    + ' in [' + spec.afterSeconds + ', ' + spec.beforeSeconds + '] s')
}

function measureTran(tran, measurements) {
  return measurements.map((measure) => {
    const { name, kind } = measure
    try {
      if (kind === 'delay') {
        return { name, unit: 's', value: crossing(tran, measure.to) - crossing(tran, measure.from) }
      }
      if (kind === 'value') {
        return { name, unit: 'V', value: sampleAt(tran.rows, tran.columns.indexOf(measure.node, 1), measure.atSeconds) }
      }
      let min = Infinity
      let max = -Infinity
      for (const [, value] of windowSamples(tran, measure)) {
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
      return { name, unit: 'V', value: { min, max, swing: max - min }[kind] }
    } catch (error) {
      throw new Error(name + ': ' + error.message)
    }
  })
}

async function collectStage(stage, result, context, evidence, transfer, runCommand) {
  const phase = result[stage]
  const directory = join(result.runDir, stage)
  const remoteDirectory = posix.join(result.remoteRunDir, stage)
  const { files, exitCode } = evidence[stage]
  const wave = ['psf/tran.tran.tran', 'psf/tran.tran'].find((path) => files.has(path))
  const filePaths = { log: 'spectre.out', stdout: 'spectre.stdout', psfIndex: 'psf/logFile', psf: wave }
  phase.exitCode = exitCode
  try {
    const available = Object.entries(filePaths).filter(([, path]) => files.has(path))
    if (available.length) {
      const paths = available.map(([, path]) => transfer.host + ':' + posix.join(remoteDirectory, path))
      const copied = await runCommand('scp', [...transfer.options, ...paths, '.'], { cwd: directory, timeoutMs: 120_000 })
      requireThat(copied.ok, 'could not copy Spectre outputs: ' + failureText(copied))
      for (const [key, path] of available) {
        const local = join(directory, posix.basename(path))
        const info = await stat(local)
        requireThat(info.isFile() && info.size > 0, 'empty Spectre artifact ' + path)
        phase.artifacts[key] = local
      }
    }
    const log = phase.artifacts.log ? await readFile(phase.artifacts.log, 'utf8') : ''
    const stdout = phase.artifacts.stdout ? await readFile(phase.artifacts.stdout, 'utf8') : ''
    if (exitCode !== 0) {
      const diagnostic = /^\s*(?:FATAL|ERROR)\s+\([^\r\n]+/m.exec(log + '\n' + stdout)?.[0].trim()
      throw new Error(diagnostic || (exitCode === 124 || exitCode === 137
        ? 'Spectre exceeded the pair time budget' : 'Spectre exit ' + (exitCode ?? 'not recorded')))
    }
    requireThat(phase.artifacts.psf, 'Spectre produced no transient waveform')
    phase.spectre = readSpectreLog(log, stage, { ...context, remoteRunDir: result.remoteRunDir })
    const tran = parseTran(await readFile(phase.artifacts.psf, 'utf8'), context.signals, context.stop)
    phase.solver = tran.solver
    phase.waveform = { points: tran.rows.length, columns: tran.columns, startSeconds: tran.rows[0][0],
      stopSeconds: tran.rows.at(-1)[0] }
    const csv = join(directory, 'waveforms.csv')
    await writeFile(csv, [tran.columns.join(','), ...tran.rows.map((row) => row.join(',')), ''].join('\n'), { flag: 'wx' })
    phase.artifacts.waveformCsv = csv
    phase.metrics = measureTran(tran, context.measures)
    requireThat(phase.metrics.every((metric) => Number.isFinite(metric.value)), 'measurement produced a nonfinite result')
    phase.status = 'pass'
  } catch (error) {
    phase.status = 'error'
    phase.error = error.message
  }
}

/** Run the same transient bench on independent schematic and Calibre xRC DUT inputs. */
export async function runLayoutSimulation(config, { extraction, bench, timeoutMs = 120_000 } = {}, dependencies = {}) {
  const result = { ok: false, status: 'error', artifacts: {},
    before: { status: 'not-run', artifacts: {} }, after: { status: 'not-run', artifacts: {} } }
  const runInput = dependencies.runWithInput ?? runWithInput
  const runCommand = dependencies.run ?? run
  try {
    requireThat(extraction?.ok === true && extraction.status === 'pass', 'a completed Calibre xRC extraction is required')
    const cell = extraction.source?.cell
    requireThat(typeof cell === 'string' && DEVICE_NAME.test(cell), 'extraction needs a Spectre-compatible source cell name')
    const { sourceCdl, dspf } = extraction.artifacts ?? {}
    requireThat(typeof sourceCdl === 'string' && typeof dspf === 'string', 'extraction must provide the source CDL and DSPF')
    requireThat(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_453_647,
      'timeoutMs must be a positive tool budget in milliseconds')
    const runId = randomUUID()
    const runDir = resolve(config.artifactDir, 'simulation', runId)
    const remoteRunDir = '/tmp/dsh-layout-sim-' + runId
    Object.assign(result, { runId, runDir, remoteRunDir, extractionRunId: extraction.runId,
      source: extraction.source, target: extraction.target })
    await mkdir(resolve(runDir, '..'), { recursive: true })
    await mkdir(runDir)
    for (const [kind, source] of Object.entries({ sourceCdl, dspf })) {
      const local = join(runDir, FILES[kind])
      await copyFile(source, local, constants.COPYFILE_EXCL)
      requireThat(await fileHash(local) === extraction[kind + 'Sha256'], kind + ' fingerprint differs from extraction')
      result.artifacts[kind] = local
    }
    const [subckt, extractedSubckt] = await Promise.all([
      readSubckt(result.artifacts.sourceCdl, cell), readSubckt(result.artifacts.dspf, cell, { dspf: true }),
    ])
    const extractedNames = new Set(extractedSubckt.ports.map((port) => port.toLowerCase()))
    requireThat(extractedNames.size === subckt.ports.length && subckt.ports.every((port) => extractedNames.has(port.toLowerCase())),
      'source CDL and DSPF port names differ')
    const groundNet = extractedSubckt.groundNet
    requireThat(groundNet && (groundNet === '0' || extractedNames.has(groundNet.toLowerCase())),
      'DSPF ground reference is not a source port or global 0. Rerun extraction with the actual pexGround.')
    const context = { ...makeBench(bench, subckt), cell }
    const digests = { sourceCdl: extraction.sourceCdlSha256, dspf: extraction.dspfSha256 }
    result.subject = { subcircuit: subckt.name, schematicPorts: subckt.ports, extractedPorts: extractedSubckt.ports,
      sourceCdlSha256: digests.sourceCdl, dspfSha256: digests.dspf, groundNet }
    result.model = context.model

    const common = join(runDir, FILES.bench)
    await writeFile(common, context.common, { flag: 'wx' })
    result.artifacts.bench = common
    digests.bench = await fileHash(common)
    result.benchSha256 = digests.bench
    const benchConfig = join(runDir, FILES.benchConfig)
    await writeFile(benchConfig, JSON.stringify({ ...bench, model: context.model }, null, 2) + '\n', { flag: 'wx' })
    result.artifacts.benchConfig = benchConfig
    const wrapper = 'simulator lang=spectre\ninclude "../' + FILES.bench + '"\n'
    for (const stage of STAGES) {
      const directory = join(runDir, stage)
      await mkdir(directory)
      const deckPath = join(directory, stage + '.scs')
      const overlay = stage === 'after' ? 'dspf_include "../' + FILES.dspf + '" port_order=sch case_sensitive=false\n' : ''
      await writeFile(deckPath, wrapper + overlay, { flag: 'wx' })
      result[stage].artifacts.netlist = deckPath
      digests[stage] = await fileHash(deckPath)
    }

    const transfer = scp(config)
    const guestArgs = sshArgs(config, 'bash -s')
    const initialize = await runInput('ssh', guestArgs, {
      input: 'umask 077\nmkdir -- ' + shellArg(remoteRunDir) + '\n', timeoutMs: 30_000,
    })
    requireThat(initialize.ok, 'could not create guest simulation directory: ' + failureText(initialize))
    const inputFiles = [FILES.bench, FILES.sourceCdl, FILES.dspf, 'before/before.scs', 'after/after.scs']
    const upload = await runCommand('scp', [...transfer.options, ...inputFiles, transfer.host + ':' + remoteRunDir + '/'],
      { cwd: runDir, timeoutMs: 120_000 })
    requireThat(upload.ok, 'could not upload simulation inputs: ' + failureText(upload))

    const execution = await runInput('ssh', guestArgs, {
      input: executionScript({ remoteRunDir, runId, model: context.model, simulator: context.simulator, digests, timeoutMs }),
      timeoutMs: timeoutMs + 30_000,
    })
    const evidence = executionEvidence(execution.stdout ?? '', runId)
    for (const stage of STAGES) {
      if (evidence[stage].exitCode !== undefined) await collectStage(stage, result, context, evidence, transfer, runCommand)
    }
    requireThat(execution.ok && evidence.completed && evidence.modelSha256,
      'guest simulation evidence is incomplete: ' + failureText(execution))
    result.model.sha256 = evidence.modelSha256
    const { before, after } = result
    const errors = STAGES.filter((stage) => result[stage].status !== 'pass')
    requireThat(errors.length === 0, errors.map((stage) => stage + ': ' + (result[stage].error ?? 'no run receipt')).join('. '))
    requireThat(before.spectre.version === after.spectre.version
      && JSON.stringify(before.spectre.sharedInputs) === JSON.stringify(after.spectre.sharedInputs)
      && JSON.stringify(before.solver) === JSON.stringify(after.solver),
    'Spectre version, resolved inputs or solver settings differed between runs')
    result.comparison = before.metrics.map(({ name, unit, value }, index) => ({
      name, unit, before: value, after: after.metrics[index].value, delta: after.metrics[index].value - value,
    }))
    requireThat(result.comparison.every(({ delta }) => Number.isFinite(delta)), 'comparison produced a nonfinite delta')
    result.ok = true
    result.status = 'pass'
  } catch (error) {
    result.error = error.message
  }
  return result
}
