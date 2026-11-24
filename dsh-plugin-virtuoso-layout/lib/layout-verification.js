import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'
import { parseReport, reconcile } from './drc.js'
import { run, runWithInput, sshArgs } from './virtuoso.js'

export const DEFAULT_VERIFICATION_PDK = Object.freeze({
  id: 'smic18ee',
  techLib: 'smic18ee',
  layerMap: null,
  drcDeck: null,
  lvsDeck: null,
  strmout: null,
  cdsHome: null,
  calibre: null,
  mgcHome: null,
  licenseFile: null,
})

const extractionFields = new Set(['pexDeck', 'pexCapRules', 'pexResRules', 'pexCorner', 'pexGround'])

const FILES = {
  gds: 'layout.gds',
  sourceCdl: 'source.cdl',
  streamOutLog: 'strmout.log',
  streamOutSummary: 'strmout.summary',
  streamOutStdout: 'strmout.stdout',
  drcSummary: 'layout.drc.summary',
  drcResults: 'layout.drc.results',
  drcStdout: 'drc.stdout',
  lvsReport: 'layout.lvs.rep',
  lvsExtractionReport: 'layout.lvs.rep.ext',
  lvsStdout: 'lvs.stdout',
}

const PHASES = ['streamOut', 'drc', 'lvs']
const REMOTE_MARKER = 'DSH_LAYOUT_VERIFY'
export const shellArg = (value) => "'" + value.replaceAll("'", "'\\''") + "'"
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const errorMessage = (error) => error?.message ?? String(error)

function check(condition, message) {
  if (!condition) throw new Error(message)
}

export function verificationProfile(pdk) {
  const defaults = DEFAULT_VERIFICATION_PDK
  check(pdk && typeof pdk === 'object' && !Array.isArray(pdk) && pdk.id === defaults.id,
    `verification requires --pdk with a ${defaults.id} site profile`)
  for (const key of Object.keys(pdk)) {
    check(Object.hasOwn(defaults, key) || extractionFields.has(key), `unknown PDK profile field: ${key}`)
  }
  const profile = Object.fromEntries(Object.keys(defaults).map((key) => [key,
    Object.hasOwn(pdk, key) ? pdk[key] : defaults[key]]))
  for (const [key, value] of Object.entries(profile)) {
    if (key === 'id' || key === 'techLib') continue
    check(typeof value === 'string' && value.startsWith('/') && !/[\x00-\x1f\x7f]/.test(value),
      `pdk.${key} must be an absolute guest path`)
  }
  check(typeof profile.techLib === 'string' && profile.techLib.trim() !== '' && !/[\x00-\x1f\x7f]/.test(profile.techLib),
    'pdk.techLib must name a Virtuoso technology library')
  return profile
}

export function smicMetalStack(path) {
  return /(?:^|_)(p2mt[3456])(?:_|\.)/i.exec(posix.basename(path))?.[1].toLowerCase()
}

export function calibreEnvironment(profile) {
  const pathPrefix = [posix.dirname(profile.calibre), posix.dirname(profile.strmout)].join(':')
  return `export LC_ALL=C
export PATH=${shellArg(pathPrefix)}:"$PATH"
export CDSHOME=${shellArg(profile.cdsHome)}
export MGC_HOME=${shellArg(profile.mgcHome)}
export MGLS_LICENSE_FILE=${shellArg(profile.licenseFile)}`
}

// The guest's SVRF files remain in place. The per-run copies bind the two
// Calibre invocations to our files while preserving rule and report options.
function guestScript({ library, cell, view, sourceCell, profile, source, sourceHash, runId, remoteRunDir, timeoutMs }) {
  const remote = Object.fromEntries(Object.entries(FILES).map(([key, name]) => [key, posix.join(remoteRunDir, name)]))
  const encodedSource = source.toString('base64').match(/.{1,76}/g).join('\n')
  return String.raw`set -euo pipefail
umask 077
${calibreEnvironment(profile)}
run_id=${shellArg(runId)}
work=${shellArg(remoteRunDir)}
cell=${shellArg(cell)}
source_cell=${shellArg(sourceCell)}
gds=${shellArg(remote.gds)}
source=${shellArg(remote.sourceCdl)}
calibre=${shellArg(profile.calibre)}
drc_deck=${shellArg(profile.drcDeck)}
deadline=$((SECONDS + ${Math.ceil(timeoutMs / 1000)}))

record() {
  printf '${REMOTE_MARKER} %s' "$run_id"
  printf ' %s' "$@"
  printf '\n'
}

collect_artifacts() {
  for file in ${Object.values(FILES).filter((name) => name !== FILES.sourceCdl).join(' ')}; do
    if [[ -f "$file" && ! -L "$file" ]]; then record file "$file"; fi
  done
  record closed
}

die() { printf '%s\n' "$*" >&2; exit 1; }
fingerprint() { sha256sum -- "$1" | cut -d ' ' -f1; }
run_phase() {
  local phase=$1 log=$2 remaining=$((deadline - SECONDS)) code=0
  shift 2
  if ((remaining <= 0)); then
    printf 'verification tool budget expired before %s\n' "$phase" > "$log"
    code=124
  else
    timeout -s KILL "$remaining" "$@" > "$log" 2>&1 || code=$?
  fi
  record exit "$phase" "$code"
  return "$code"
}

prepare_deck() {
  awk -v kind="$1" -v work="$work" -v gds="$gds" -v cell="$cell" -v source="$source" -v source_cell="$source_cell" '
    function problem(message) { print message > "/dev/stderr"; failed = 1 }
    BEGIN {
      io["LAYOUT PATH"] = gds
      io["LAYOUT PRIMARY"] = cell
      if (kind == "drc") {
        io["DRC RESULTS DATABASE"] = work "/${FILES.drcResults}"
        io["DRC SUMMARY REPORT"] = work "/${FILES.drcSummary}"
        options["DRC RESULTS DATABASE"] = options["DRC SUMMARY REPORT"] = 1
      } else {
        io["SOURCE PATH"] = source
        io["SOURCE PRIMARY"] = source_cell
        io["LVS REPORT"] = work "/${FILES.lvsReport}"
        io["MASK SVDB DIRECTORY"] = work "/svdb"
        options["LVS REPORT"] = options["MASK SVDB DIRECTORY"] = 1
      }
      for (key in io) {
        pattern[key] = key
        gsub(/ /, "[[:blank:]]+", pattern[key])
        pattern[key] = "^[[:blank:]]*" pattern[key] "[[:blank:]]+"
      }
    }
    in_comment || /^[[:blank:]]*\/\*/ { in_comment = $0 !~ /\*\//; print; next }
    {
      for (key in io) {
        if (!match(toupper($0), pattern[key])) continue
        tail = substr($0, RLENGTH + 1)
        sub(/\r$/, "", tail)
        if (key == "LVS REPORT" && toupper(tail) ~ /^OPTION([[:blank:]]|$)/) continue
        seen[key]++
        if (!options[key]) {
          tail = ""
        } else if (tail ~ /^"/) {
          if (!sub(/^"[^"]*"/, "", tail)) problem("unterminated " key " pathname")
        } else {
          sub(/^[^[:blank:]]+/, "", tail)
        }
        if (key == "DRC RESULTS DATABASE") {
          format = toupper(tail)
          sub(/^[[:blank:]]+/, "", format)
          if (format ~ /^(ASCII|GDSII|GDS|OASIS)([[:blank:]]|$)/) {
            sub(/^[[:blank:]]+[^[:blank:]]+/, "", tail)
          }
          tail = " ASCII" tail
        }
        print key " \"" io[key] "\"" tail
        next
      }
      print
    }
    END {
      for (key in io) {
        if (key == "MASK SVDB DIRECTORY" && !seen[key]) continue
        if (seen[key] != 1) problem("expected one " key " declaration")
      }
      if (failed) exit 1
    }
  ' "$2"
}

mkdir -- "$work"
cd -- "$work"
record opened
trap collect_artifacts EXIT

base64 -d > "$source" <<'DSH_SOURCE_CDL'
${encodedSource}
DSH_SOURCE_CDL
source_digest=$(fingerprint "$source")
[[ "$source_digest" == ${shellArg(sourceHash)} ]] || die 'source CDL did not match the submitted bytes'
chmod a-w -- "$source"

run_phase streamOut ${FILES.streamOutStdout} ${shellArg(profile.strmout)} \
  -library ${shellArg(library)} -strmFile "$gds" -strmVersion 3 -topCell "$cell" \
  -view ${shellArg(view)} -techLib ${shellArg(profile.techLib)} -layerMap ${shellArg(profile.layerMap)} \
  -translateUnmappedLPP -logFile ${FILES.streamOutLog} -summaryFile ${FILES.streamOutSummary} || exit 0
[[ -s "$gds" ]] || die 'strmout did not generate a GDS file'
gds_digest=$(fingerprint "$gds")
chmod a-w -- "$gds"

if drc_deck_digest=$(fingerprint "$drc_deck" 2> ${FILES.drcStdout}) &&
   prepare_deck drc "$drc_deck" > effective.drc 2> ${FILES.drcStdout}; then
  run_phase drc ${FILES.drcStdout} "$calibre" -drc -64 -hier -turbo 2 effective.drc || :
  [[ "$drc_deck_digest" == "$(fingerprint "$drc_deck")" ]] || die 'DRC deck changed during verification'
  record hash drcDeck "$drc_deck_digest"
fi
if prepare_deck lvs ${shellArg(profile.lvsDeck)} > effective.lvs 2> ${FILES.lvsStdout}; then
  run_phase lvs ${FILES.lvsStdout} "$calibre" -lvs -64 -hier -turbo 2 effective.lvs || :
fi

[[ "$gds_digest" == "$(fingerprint "$gds")" ]] || die 'GDS changed during verification'
[[ "$source_digest" == "$(fingerprint "$source")" ]] || die 'source CDL changed during verification'
record hash gds "$gds_digest"
record hash sourceCdl "$source_digest"
`
}

export function remoteEvidence(stdout, runId, {
  marker = REMOTE_MARKER, phases = PHASES, hashKeys = ['gds', 'sourceCdl', 'drcDeck'],
} = {}) {
  const evidence = { files: new Set(), codes: {}, hashes: {} }
  const prefix = `${marker} ${runId} `
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue
    const [action, key, value] = line.slice(prefix.length).split(' ')
    if (action === 'opened') evidence.opened = true
    if (action === 'closed') evidence.closed = true
    if (action === 'file') evidence.files.add(key)
    if (action === 'exit' && phases.includes(key) && /^\d{1,3}$/.test(value)) evidence.codes[key] = Number(value)
    if (action === 'hash' && hashKeys.includes(key) && /^[0-9a-f]{64}$/.test(value)) {
      evidence.hashes[key] = value
    }
  }
  return evidence
}

export function scpGuest(config) {
  const args = sshArgs(config, '').slice(0, -1)
  const host = args.pop()
  args[args.indexOf('-p')] = '-P'
  // The guest is RHEL 6, so use the original SCP protocol.
  return { host, args: ['-O', ...args] }
}

export function scpArgs(config, remoteRunDir, files) {
  const { host, args } = scpGuest(config)
  return [...args, ...files.map((name) => `${host}:${remoteRunDir}/${name}`), '.']
}

export async function fileSha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function reportedPath(value, remoteRunDir) {
  return value && posix.resolve(remoteRunDir, value.replace(/^"(.*)"$/, '$1'))
}

export function readDrcEvidence(summaryText, resultsText, { cell, remoteRunDir }, { markers = false } = {}) {
  const summary = parseReport(summaryText, 'summary')
  const results = parseReport(resultsText, 'results', { markers })
  check(summary.header['Layout Primary Cell'] === cell &&
    reportedPath(summary.header['Layout Path(s)'], remoteRunDir) === posix.join(remoteRunDir, FILES.gds),
  'DRC summary does not identify this run’s GDS and top cell')
  const comparison = reconcile(summary, results)
  check(comparison.agreement, 'DRC summary and ASCII results database disagree')
  return { status: summary.totals.violations === 0 ? 'pass' : 'fail', totals: summary.totals,
    failing: summary.failing, warnings: summary.warnings, resultsSha256: sha256(resultsText),
    ...(markers && { results }) }
}

function lvsField(text, field) {
  return new RegExp(`^[ \\t]*${field}:[ \\t]*(.+)$`, 'm').exec(text)?.[1].trim()
}

function lvsReference(text, field, remoteRunDir) {
  const value = lvsField(text, field)
  const match = /^(.*?)(?:[ \t]+\(['"]?(.*?)['"]?\))?$/.exec(value ?? '')
  return { path: reportedPath(match[1], remoteRunDir), cell: match[2] }
}

export function readLvsEvidence(report, extraction, { cell, sourceCell, remoteRunDir, ruleFile = 'effective.lvs' }) {
  const overall = /^[ \t]*OVERALL COMPARISON RESULTS[ \t]*\r?$/m.exec(report)
  check(overall, 'Calibre LVS report has no overall comparison results')
  const header = report.slice(0, overall.index)
  const overallBody = report.slice(overall.index + overall[0].length)
    .split(/\r?\n[ \t]*\*{5,}[ \t]*\r?\n/).find((section) => section.trim())
  const verdict = /#[ \t]+(CORRECT|INCORRECT|NOT COMPARED)[ \t]+#/.exec(overallBody ?? '')?.[1]
  check(verdict, 'Calibre LVS report has no overall verdict')

  const source = lvsReference(header, 'SOURCE NAME', remoteRunDir)
  const extractedLayout = lvsReference(header, 'LAYOUT NAME', remoteRunDir)
  const layout = lvsReference(extraction, 'LAYOUT NAME', remoteRunDir)
  check(reportedPath(lvsField(header, 'REPORT FILE NAME'), remoteRunDir) === posix.join(remoteRunDir, FILES.lvsReport) &&
    reportedPath(lvsField(extraction, 'REPORT FILE NAME'), remoteRunDir) === posix.join(remoteRunDir, FILES.lvsExtractionReport) &&
    reportedPath(lvsField(header, 'RULE FILE'), remoteRunDir) === posix.join(remoteRunDir, ruleFile) &&
    source.path === posix.join(remoteRunDir, FILES.sourceCdl) && source.cell?.toLowerCase() === sourceCell.toLowerCase() &&
    layout.path === posix.join(remoteRunDir, FILES.gds) && layout.cell === cell &&
    extractedLayout.path === posix.join(remoteRunDir, 'svdb', `${cell}.sp`) && extractedLayout.cell === cell,
  'Calibre LVS comparison and extraction reports do not identify this run’s GDS and source CDL')
  return { verdict, status: verdict === 'CORRECT' ? 'pass' : verdict === 'INCORRECT' ? 'fail' : 'error' }
}

function phaseError(exitCode, error) {
  return { status: 'error', ...(exitCode !== undefined && { exitCode }), error }
}

async function evaluatePhase(phase, exitCode, artifacts, options) {
  const label = phase === 'drc' ? 'Calibre DRC' : 'Calibre LVS'
  if (exitCode === undefined) return phaseError(exitCode, `${label} did not start. See this run’s tool log.`)
  if (exitCode !== 0) return phaseError(exitCode, `${label} exited with code ${exitCode}`)
  const read = (key) => {
    check(artifacts[key], `${label} did not write ${FILES[key]}`)
    return readFile(artifacts[key], 'utf8')
  }
  try {
    const evidence = phase === 'drc'
      ? readDrcEvidence(await read('drcSummary'), await read('drcResults'), options)
      : readLvsEvidence(await read('lvsReport'), await read('lvsExtractionReport'), options)
    return { ...evidence, exitCode, ...(evidence.status === 'error' && { error: `${label} reported ${evidence.verdict}` }) }
  } catch (error) {
    return phaseError(exitCode, errorMessage(error))
  }
}

/**
 * Verify a saved layout and an independently exported source CDL in one run.
 * The guest tool budget is shared across stream-out, DRC and LVS. SSH and
 * artifact collection have separate transport allowances.
 */
export async function runLayoutVerification(config, options, dependencies = {}) {
  const result = { ok: false, status: 'error', artifacts: {} }
  const runInput = dependencies.runWithInput ?? runWithInput
  const runCommand = dependencies.run ?? run
  try {
    const { library, cell, view = 'layout', sourceCell, sourceCdl, pdk, timeoutMs = 300_000 } = options
    for (const [key, value] of Object.entries({ library, cell, view, sourceCell })) {
      check(typeof value === 'string' && value.trim() !== '' && !/[\x00-\x1f\x7f"\\]/.test(value),
        `${key} must be a Virtuoso name representable in an SVRF directive`)
    }
    check(typeof sourceCdl === 'string' || Buffer.isBuffer(sourceCdl), 'independent source CDL bytes are required')
    const source = Buffer.from(sourceCdl)
    check(source.toString('utf8').trim(), 'the independent source CDL is empty')
    check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_453_647,
      'timeoutMs must be a positive tool budget in milliseconds')
    const profile = verificationProfile(pdk)
    const sourceHash = sha256(source)
    const runId = randomUUID()
    const runDir = resolve(config.artifactDir, 'signoff', runId)
    const remoteRunDir = `/tmp/dsh-layout-${runId}`
    const technologyOptions = { metalStack: smicMetalStack(profile.drcDeck), drcDeck: profile.drcDeck }
    Object.assign(result, { runId, runDir, remoteRunDir, pdk: profile.id, sourceCdlSha256: sourceHash, technologyOptions })
    const location = { library, cell, view, sourceCell, runId, remoteRunDir }
    await mkdir(resolve(runDir, '..'), { recursive: true })
    await mkdir(runDir)
    const sourcePath = join(runDir, FILES.sourceCdl)
    await writeFile(sourcePath, source, { flag: 'wx' })
    result.artifacts.sourceCdl = sourcePath

    const input = guestScript({ ...location, profile, source, sourceHash, timeoutMs })
    const execution = await runInput('ssh', sshArgs(config, 'bash -s'), { input, timeoutMs: timeoutMs + 30_000 })
    const remote = remoteEvidence(execution.stdout ?? '', runId)
    technologyOptions.drcDeckSha256 = remote.hashes.drcDeck
    for (const phase of PHASES) {
      result[phase] = phaseError(remote.codes[phase], `${phase} has no completed evidence for this run`)
    }
    if (remote.opened && remote.closed) {
      const available = Object.entries(FILES).filter(([, name]) => remote.files.has(name))
      if (available.length > 0) {
        const transfer = await runCommand('scp', scpArgs(config, remoteRunDir, available.map(([, name]) => name)), {
          cwd: runDir,
          timeoutMs: 120_000,
        })
        check(transfer.ok, `could not copy verification artifacts: ${transfer.error ?? transfer.stderr?.trim() ?? transfer.code}`)
        for (const [key, name] of available) {
          const path = join(runDir, name)
          check((await stat(path)).isFile(), `verification artifact is not a file: ${path}`)
          result.artifacts[key] = path
        }
      }
    }
    check(execution.ok && remote.opened && remote.closed,
      execution.timedOut ? 'SSH timed out during verification'
        : `guest verification did not finish: ${execution.error ?? (execution.stderr?.trim() || execution.code)}`)
    const streamExit = remote.codes.streamOut
    if (streamExit !== 0) {
      result.streamOut = phaseError(streamExit, `strmout exited with code ${streamExit ?? 'unknown'}`)
      throw new Error(result.streamOut.error)
    }
    check(result.artifacts.gds && result.artifacts.streamOutLog, 'strmout did not return the GDS and export log')
    check(remote.hashes.sourceCdl === sourceHash && remote.hashes.gds &&
      await fileSha256(result.artifacts.gds) === remote.hashes.gds,
    'the downloaded GDS and uploaded CDL do not match this run’s inputs')
    result.gdsSha256 = remote.hashes.gds
    const streamLog = await readFile(result.artifacts.streamOutLog, 'utf8')
    const streamCounts = /Translation completed\.\s*'?(\d+)'?\s+error\(s\)\s+and\s+'?(\d+)'?\s+warning\(s\)/i.exec(streamLog)
    check(streamCounts && Number(streamCounts[1]) === 0, 'strmout log does not show a completed export with zero errors')
    result.streamOut = { status: 'pass', exitCode: streamExit, errors: 0, warnings: Number(streamCounts[2]) }

    const [drc, lvs] = await Promise.all([
      evaluatePhase('drc', remote.codes.drc, result.artifacts, location),
      evaluatePhase('lvs', remote.codes.lvs, result.artifacts, location),
    ])
    result.drc = drc
    result.lvs = lvs
    const errors = [drc.error, lvs.error].filter(Boolean)
    if (errors.length > 0) throw new Error(errors.join('. '))
    result.status = drc.status === 'fail' || lvs.status === 'fail' ? 'fail' : 'pass'
    result.ok = result.status === 'pass'
    return result
  } catch (error) {
    return { ...result, error: errorMessage(error) }
  }
}
