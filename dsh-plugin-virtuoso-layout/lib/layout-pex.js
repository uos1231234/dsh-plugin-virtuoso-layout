import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join, posix, resolve } from 'node:path'
import {
  calibreEnvironment, fileSha256, readLvsEvidence, remoteEvidence,
  scpArgs, scpGuest, shellArg, smicMetalStack, verificationProfile,
} from './layout-verification.js'
import { run, runWithInput, sshArgs } from './virtuoso.js'

const RULE_FILE = 'effective.xrc'
const FILES = {
  gds: 'layout.gds',
  sourceCdl: 'source.cdl',
  preparationLog: 'prepare-xrc.stdout',
  lvsReport: 'layout.lvs.rep',
  lvsExtractionReport: 'layout.lvs.rep.ext',
  lvsStdout: 'lvs.stdout',
  pdbStdout: 'pdb.stdout',
  fmtStdout: 'fmt.stdout',
  dspf: 'extraction.spf',
  report: 'extraction.rep',
}
const PHASES = ['prepare', 'lvs', 'pdb', 'fmt']
const HASHES = ['gds', 'sourceCdl', 'drcDeck', 'pexDeck', 'pexCapRules', 'pexResRules', 'effectiveDeck', 'dspf']
const MARKER = 'DSH_LAYOUT_PEX'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const validGuestPath = (path) => typeof path === 'string' && path.startsWith('/') && !/[\x00-\x1f\x7f"\\]/.test(path)
const validCell = (name) => typeof name === 'string' && name.trim() && !/[\x00-\x1f\x7f"\\/]/.test(name)
const transportFailure = (execution) => execution.error ?? (execution.stderr?.trim() || execution.code)

function extractionProfile(pdk, verification) {
  const { metalStack, drcDeck, drcDeckSha256 } = verification.technologyOptions ?? {}
  check(validGuestPath(drcDeck) && metalStack && smicMetalStack(drcDeck) === metalStack && validHash(drcDeckSha256),
    'verification has no proven SMIC metal stack; rerun Calibre verification with the corresponding DRC deck')

  check(pdk && typeof pdk === 'object' && !Array.isArray(pdk),
    'extraction needs --pdk with the verified site profile and official xRC inputs')
  const {
    pexDeck, pexCorner = 'typ', pexCapRules: capRules, pexResRules: resRules, pexGround = 'VSS', ...verificationFields
  } = pdk
  const profile = verificationProfile({ ...verificationFields, drcDeck: verificationFields.drcDeck ?? drcDeck })
  check(profile.id === verification.pdk && posix.normalize(profile.drcDeck) === posix.normalize(drcDeck),
    'extraction DRC deck differs from the verification run')
  check(['typ', 'Cmin', 'Cmax'].includes(pexCorner), 'pexCorner must be typ, Cmin or Cmax')
  check(validGuestPath(pexDeck) && validGuestPath(capRules) && validGuestPath(resRules),
    'xRC deck and calibration must be absolute guest paths representable in SVRF')
  check(smicMetalStack(capRules) === metalStack && smicMetalStack(resRules) === metalStack &&
    capRules.endsWith(`_${pexCorner}.C`) && resRules.endsWith(`_${pexCorner}.R`),
  `xRC capacitance and resistance files must identify the verified ${metalStack} stack and ${pexCorner} corner`)
  check(typeof pexGround === 'string' && /^[A-Za-z0-9_.$!:+-]+$/.test(pexGround),
    'pexGround must be a source port name or global node 0 representable in SVRF')
  return { ...profile, metalStack, drcDeckSha256, pexCorner, pexDeck, pexCapRules: capRules, pexResRules: resRules, pexGround }
}

// Make a per-run launcher from the shipped xRC deck. The only substitutions
// are input/output bindings, the reference net and the PDK stack/calibration selection.
function guestScript({ profile, cell, sourceCell, runId, remoteRunDir, gdsSha256, sourceCdlSha256, timeoutMs }) {
  return String.raw`set -euo pipefail
umask 077
${calibreEnvironment(profile)}
run_id=${shellArg(runId)}
work=${shellArg(remoteRunDir)}
cell=${shellArg(cell)}
source_cell=${shellArg(sourceCell)}
calibre=${shellArg(profile.calibre)}
drc_deck=${shellArg(profile.drcDeck)}
pex_deck=${shellArg(profile.pexDeck)}
cap_rules=${shellArg(profile.pexCapRules)}
res_rules=${shellArg(profile.pexResRules)}
deadline=$((SECONDS + ${Math.ceil(timeoutMs / 1000)}))

record() {
  printf '${MARKER} %s' "$run_id"
  printf ' %s' "$@"
  printf '\n'
}

collect_artifacts() {
  for file in ${Object.values(FILES).slice(2).join(' ')}; do
    if [[ -f "$file" && ! -L "$file" ]]; then record file "$file"; fi
  done
  record closed
}

fingerprint() { sha256sum -- "$1" | cut -d ' ' -f1; }
die() { printf '%s\n' "$*" >&2; exit 1; }

run_phase() {
  local phase=$1 log=$2 remaining=$((deadline - SECONDS)) code=0
  shift 2
  if ((remaining <= 0)); then
    printf 'extraction tool budget expired before %s\n' "$phase" > "$log"
    code=124
  else
    timeout -s KILL "$remaining" "$@" </dev/null > "$log" 2>&1 || code=$?
  fi
  record exit "$phase" "$code"
  return "$code"
}

prepare_deck() {
  awk -v cell="$cell" -v source_cell="$source_cell" -v deck_dir=${shellArg(posix.dirname(profile.pexDeck))} \
    -v cap_rules="$cap_rules" -v res_rules="$res_rules" -v top_metal=${profile.metalStack.at(-1)} \
    -v pex_ground=${shellArg(profile.pexGround)} '
    function problem(message) { print message > "/dev/stderr"; failed = 1 }
    BEGIN {
      io["LAYOUT PATH"] = "${FILES.gds}"
      io["LAYOUT PRIMARY"] = cell
      io["SOURCE PATH"] = "${FILES.sourceCdl}"
      io["SOURCE PRIMARY"] = source_cell
      io["LVS REPORT"] = "${FILES.lvsReport}"
      io["MASK SVDB DIRECTORY"] = "svdb"
      io["PEX NETLIST DISTRIBUTED"] = "${FILES.dspf}"
      io["PEX REPORT DISTRIBUTED"] = "${FILES.report}"
      for (key in io) {
        pattern[key] = key
        gsub(/ /, "[[:blank:]]+", pattern[key])
        pattern[key] = "^[[:blank:]]*" pattern[key] "[[:blank:]]+"
      }
    }
    { sub(/\r$/, "") }
    in_comment || /^[[:blank:]]*\/\*/ { in_comment = $0 !~ /\*\//; print; next }
    toupper($0) ~ /^[[:blank:]]*#DEFINE[[:blank:]]+TOPMETAL[[:blank:]]+[3456]([[:blank:]]|$)/ {
      top_seen++
      print "#DEFINE TOPMETAL " top_metal
      next
    }
    match(toupper($0), /^[[:blank:]]*INCLUDE[[:blank:]]+/) {
      text = substr($0, RLENGTH + 1)
      if (!match(text, /^"[^"]+"/)) { print; next }
      path = substr(text, 2, RLENGTH - 2)
      rest = substr(text, RLENGTH + 1)
      if (path ~ /\.C$/) {
        path = cap_rules
        cap_seen++
      } else if (path ~ /\.R$/) {
        path = res_rules
        res_seen++
      } else if (path !~ /^[/\$]/) {
        path = deck_dir "/" path
      }
      print "INCLUDE \"" path "\"" rest
      next
    }
    {
      for (key in io) {
        if (!match(toupper($0), pattern[key])) continue
        tail = substr($0, RLENGTH + 1)
        if (key == "LVS REPORT" && toupper(tail) ~ /^OPTION([[:blank:]]|$)/) continue
        seen[key]++
        options = ""
        if (key == "MASK SVDB DIRECTORY") options = " XRC"
        if (key == "PEX REPORT DISTRIBUTED") options = " ASCII SOURCE"
        if (key == "PEX NETLIST DISTRIBUTED") {
          if (!match(toupper(tail), /[[:blank:]]+(SOURCE|LAYOUT)([[:blank:]]|$)/)) {
            problem("PEX NETLIST DISTRIBUTED has no SOURCE or LAYOUT naming option")
          }
          rest = substr(tail, RSTART + RLENGTH)
          if (!sub(/(^|[[:blank:]])GROUND[[:blank:]]+("[^"]+"|[^[:blank:]]+)/, " GROUND " pex_ground, rest)) {
            problem("PEX NETLIST DISTRIBUTED has no GROUND reference option")
          }
          options = " DSPF SOURCE" (rest == "" ? "" : " " rest)
        }
        print key " \"" io[key] "\"" options
        next
      }
      print
    }
    END {
      for (key in io) if (seen[key] != 1) problem("expected one " key " declaration in the xRC deck")
      if (top_seen != 1) problem("expected one TOPMETAL selection in the xRC deck")
      if (cap_seen != 1 || res_seen != 1) problem("expected one C and one R calibration include in the xRC deck")
      if (failed) exit 1
    }
  ' "$pex_deck"
}

cd -- "$work"
record opened
trap collect_artifacts EXIT

gds_digest=$(fingerprint ${FILES.gds})
source_digest=$(fingerprint ${FILES.sourceCdl})
[[ "$gds_digest" == ${shellArg(gdsSha256)} ]] || die 'uploaded GDS differs from the verified GDS'
[[ "$source_digest" == ${shellArg(sourceCdlSha256)} ]] || die 'uploaded CDL differs from the verified CDL'
drc_digest=$(fingerprint "$drc_deck")
[[ "$drc_digest" == ${shellArg(profile.drcDeckSha256)} ]] || die 'the verified DRC deck changed after verification'
record hash gds "$gds_digest"
record hash sourceCdl "$source_digest"
record hash drcDeck "$drc_digest"
chmod a-w -- ${FILES.gds} ${FILES.sourceCdl}
mkdir -- svdb

for file in "$pex_deck" "$cap_rules" "$res_rules"; do
  if [[ ! -r "$file" ]]; then
    printf 'missing or unreadable ${profile.metalStack} ${profile.pexCorner} xRC input: %s\n' "$file" > ${FILES.preparationLog}
    record exit prepare 1
    exit 0
  fi
done
deck_digest=$(fingerprint "$pex_deck")
cap_digest=$(fingerprint "$cap_rules")
res_digest=$(fingerprint "$res_rules")
record hash pexDeck "$deck_digest"
record hash pexCapRules "$cap_digest"
record hash pexResRules "$res_digest"

prepare_exit=0
prepare_deck > ${RULE_FILE} 2> ${FILES.preparationLog} || prepare_exit=$?
record exit prepare "$prepare_exit"
if ((prepare_exit != 0)); then exit 0; fi
effective_digest=$(fingerprint ${RULE_FILE})
chmod a-w -- ${RULE_FILE}
record hash effectiveDeck "$effective_digest"

run_phase lvs ${FILES.lvsStdout} "$calibre" -lvs -64 -hier -spice "svdb/$cell.sp" ${RULE_FILE} || exit 0
# In Calibre a successful process exit can still report an incorrect comparison.
# This source-name extraction needs the PHDB and a successful source cross-reference.
if ! awk '
  /OVERALL COMPARISON RESULTS/ { overall = 1; next }
  overall && /#[[:blank:]]+CORRECT[[:blank:]]+#/ { correct = 1; exit }
  overall && /CELL[[:blank:]]+SUMMARY/ { exit }
  END { exit !correct }
' ${FILES.lvsReport}; then exit 0; fi
[[ -s "svdb/$cell.phdb" ]] || die 'Calibre LVS did not produce the PHDB for xRC'
run_phase pdb ${FILES.pdbStdout} "$calibre" -xrc -pdb -64 -rcc ${RULE_FILE} || exit 0
run_phase fmt ${FILES.fmtStdout} "$calibre" -xrc -fmt -64 -rcc ${RULE_FILE} || exit 0

[[ "$gds_digest" == "$(fingerprint ${FILES.gds})" && "$source_digest" == "$(fingerprint ${FILES.sourceCdl})" ]] ||
  die 'input GDS/CDL changed during extraction'
[[ "$deck_digest" == "$(fingerprint "$pex_deck")" && "$cap_digest" == "$(fingerprint "$cap_rules")" &&
   "$res_digest" == "$(fingerprint "$res_rules")" && "$effective_digest" == "$(fingerprint ${RULE_FILE})" ]] ||
  die 'xRC deck or calibration changed during extraction'
record hash dspf "$(fingerprint ${FILES.dspf})"
`
}

function phaseFailure(name, exitCode, log) {
  const diagnostic = /^\s*(?:ERROR|FATAL)\b.*$/im.exec(log)?.[0].trim() ??
    (name === 'prepare' ? log.trim() : undefined)
  const status = exitCode === undefined ? 'did not start' : `exited with code ${exitCode}`
  return `Calibre PEX ${name} ${status}${diagnostic ? ` (${diagnostic})` : ''}`
}

function xrcPhaseEvidence(phase, log) {
  const completed = phase === 'pdb' ? 'HIERARCHICAL PARASITIC EXTRACTION COMPLETED' : 'FORMATTER COMPLETED'
  const warnings = /^\s*xRC Warnings\s*=\s*(\d+)\s*$/im.exec(log)?.[1]
  const errors = /^\s*xRC Errors\s*=\s*(\d+)\s*$/im.exec(log)?.[1]
  check(log.includes(completed) && warnings !== undefined && errors === '0',
    `Calibre xRC ${phase} did not report completion with zero errors`)
  const errorNets = /^\s*error nets\s*=\s*(\d+)\s*$/im.exec(log)?.[1]
  check(errorNets === undefined || errorNets === '0', 'Calibre xRC reported nets with formatting errors')
  return { status: 'pass', exitCode: 0, warnings: Number(warnings), errors: 0,
    ...(errorNets !== undefined && { errorNets: Number(errorNets) }) }
}

function spiceStatements(text) {
  return text.replace(/\r?\n[ \t]*\+[ \t]*/g, ' ').split(/\r?\n/).map((line) => line.trim())
}

function subcircuit(line) {
  const [, name, ...words] = line.split(/\s+/)
  const end = words.findIndex((word) => /^params:/i.test(word) || word.includes('=') || word.startsWith('$'))
  return { name, ports: words.slice(0, end < 0 ? words.length : end) }
}

function topSubcircuit(text, cell) {
  return spiceStatements(text).filter((line) => /^\.subckt\s+/i.test(line)).map(subcircuit)
    .find(({ name }) => name.toLowerCase() === cell.toLowerCase())
}

function inspectDspf(dspf, sourceCdl, report, { cell, sourceCell, pexGround }) {
  const dspfVersion = /^\*\|DSPF\s+(\S+)/m.exec(dspf)?.[1]
  const program = /^\*\|PROGRAM[ \t]+"(Calibre xRC [^"]+)"[ \t]*\r?$/m.exec(dspf)?.[1]
  const design = /^\*\|DESIGN[ \t]+"([^"]+)"[ \t]*\r?$/m.exec(dspf)?.[1]
  const reportedCell = /^LAYOUT NAME:[ \t]+(.+?)\r?$/m.exec(report)?.[1].trim()
  const names = [cell.toLowerCase(), sourceCell.toLowerCase()]
  check(dspfVersion && program && design && names.includes(design.toLowerCase()) &&
    report.includes('Calibre xRC') && reportedCell && names.includes(reportedCell.toLowerCase()),
  'Calibre extraction report and DSPF do not identify the same cell as the verified inputs')

  const lines = spiceStatements(dspf)
  const sourceSubckt = topSubcircuit(sourceCdl, sourceCell)
  const header = lines.find((line) => /^\.subckt\s+/i.test(line))
  check(header && sourceSubckt && lines.some((line) => /^\.ends(?:\s|$)/i.test(line)),
    'the DSPF and source CDL must declare their top subcircuits')
  const { name, ports } = subcircuit(header)
  check(names.includes(name.toLowerCase()) &&
    ports.map((port) => port.toLowerCase()).sort().join('\0') ===
    sourceSubckt.ports.map((port) => port.toLowerCase()).sort().join('\0'),
  'DSPF subcircuit ports differ from the verified source CDL')
  const groundNet = /^\*\|GROUND_NET[ \t]+(\S+)/im.exec(dspf)?.[1]
  check(groundNet?.toLowerCase() === pexGround.toLowerCase(), 'Calibre DSPF did not retain the requested ground reference')
  check(!lines.some((line) => /^\.(?:inc(?:lude)?|lib)\s/i.test(line)), 'Calibre DSPF references an additional file')

  const netStart = lines.findIndex((line) => /^\*\s+Net Section$/i.test(line))
  const netEnd = lines.findIndex((line) => /^\*\s+Instance Section$/i.test(line))
  check(netStart >= 0 && netEnd > netStart, 'Calibre DSPF has no separated parasitic net and device sections')
  const counts = { resistors: 0, capacitors: 0, couplingCapacitors: 0 }
  for (const line of lines.slice(netStart + 1, netEnd)) {
    const [element, , , value] = line.split(/\s+/)
    const positive = value && /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|[tgkmunpfa])?$/i.test(value) &&
      Number.parseFloat(value) > 0
    if (!positive) continue
    if (/^r\S+/i.test(element)) counts.resistors += 1
    if (/^c\S+/i.test(element)) counts.capacitors += 1
    if (/^cc_\S+/i.test(element)) counts.couplingCapacitors += 1
  }
  const temperature = /^\*\s*Nominal Temperature:\s*(-?[\d.]+)C/m.exec(dspf)?.[1]
  return { program, dspfVersion, subckt: name, ports, groundNet, ...counts,
    ...(temperature !== undefined && { nominalTemperatureC: Number(temperature) }) }
}

/** Extract a source-named Calibre xRC DSPF from the unmodified verification inputs. */
export async function runLayoutPex(config, options, dependencies = {}) {
  const result = { ok: false, status: 'error', artifacts: {}, phases: {} }
  const execute = dependencies.run ?? run
  const executeScript = dependencies.runWithInput ?? runWithInput
  try {
    const { verification, pdk, timeoutMs = 300_000 } = options
    check(verification?.kind === 'virtuoso.layout-verification' &&
      ['pass', 'fail'].includes(verification.status) && verification.streamOut?.status === 'pass' &&
      verification.lvs?.status === 'pass' && verification.lvs.verdict === 'CORRECT',
    'extraction needs a completed layout verification with Calibre LVS CORRECT')
    const { gdsSha256, sourceCdlSha256, source, target } = verification
    check(validHash(gdsSha256) && validHash(sourceCdlSha256) && verification.artifacts?.gds &&
      verification.artifacts?.sourceCdl && validCell(source?.cell) && validCell(target?.cell),
    'verification record does not identify the GDS, independent source CDL and top cells')
    check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_453_647,
      'timeoutMs must be a positive extraction tool budget in milliseconds')
    const profile = extractionProfile(pdk, verification)
    const runId = randomUUID()
    const runDir = resolve(config.artifactDir, 'signoff', `pex-${runId}`)
    const remoteRunDir = `/tmp/dsh-layout-pex-${runId}`
    const { metalStack, drcDeck, drcDeckSha256, pexDeck, pexCapRules, pexResRules, pexCorner, pexGround } = profile
    const technologyOptions = { metalStack, drcDeck, drcDeckSha256, pexDeck, pexCapRules, pexResRules, pexCorner, pexGround,
      mode: 'RCC', format: 'DSPF' }
    Object.assign(result, { runId, runDir, remoteRunDir, pdk: profile.id, source, target, gdsSha256, sourceCdlSha256,
      verificationRunId: verification.runId, verificationDrc: verification.drc, technologyOptions })

    await mkdir(resolve(runDir, '..'), { recursive: true })
    await mkdir(runDir)
    for (const [key, expected] of Object.entries({ gds: gdsSha256, sourceCdl: sourceCdlSha256 })) {
      const path = join(runDir, FILES[key])
      await copyFile(verification.artifacts[key], path)
      check(await fileSha256(path) === expected, `${key} differs from the verification record`)
      result.artifacts[key] = path
    }
    const sourceSubckt = topSubcircuit(await readFile(result.artifacts.sourceCdl, 'utf8'), source.cell)
    check(sourceSubckt?.ports && (pexGround === '0' || sourceSubckt.ports.some((port) => port.toLowerCase() === pexGround.toLowerCase())),
      `PEX ground reference ${pexGround} is absent from the independent source CDL. Set pexGround to its real reference port.`)

    const prepare = await execute('ssh', sshArgs(config, `mkdir -m 700 -- ${shellArg(remoteRunDir)}`))
    check(prepare.ok, `could not create the guest extraction directory: ${transportFailure(prepare)}`)
    const scp = scpGuest(config)
    const upload = await execute('scp', [...scp.args, `./${FILES.gds}`, `./${FILES.sourceCdl}`,
      `${scp.host}:${remoteRunDir}/`], { cwd: runDir })
    check(upload.ok, `could not upload GDS and CDL: ${transportFailure(upload)}`)

    const location = { cell: target.cell, sourceCell: source.cell, pexGround, runId, remoteRunDir, ruleFile: RULE_FILE }
    const execution = await executeScript('ssh', sshArgs(config, 'bash -s'), {
      input: guestScript({ ...location, profile, gdsSha256, sourceCdlSha256, timeoutMs }), timeoutMs: timeoutMs + 30_000,
    })
    const evidence = remoteEvidence(execution.stdout ?? '', runId, { marker: MARKER, phases: PHASES, hashKeys: HASHES })
    for (const phase of PHASES) {
      const exitCode = evidence.codes[phase]
      result.phases[phase] = exitCode === undefined ? { status: 'notRun' }
        : { status: exitCode === 0 ? 'unverified' : 'error', exitCode }
    }

    if (evidence.opened && evidence.closed && evidence.files.size > 0) {
      const available = Object.entries(FILES).slice(2).filter(([, name]) => evidence.files.has(name))
      const download = await execute('scp', scpArgs(config, remoteRunDir, available.map(([, name]) => name)), { cwd: runDir })
      check(download.ok, `could not download extraction reports: ${transportFailure(download)}`)
      for (const [key, name] of available) {
        const path = join(runDir, name)
        check((await stat(path)).isFile(), `extraction artifact is not a file: ${path}`)
        result.artifacts[key] = path
      }
    }
    for (const key of HASHES.slice(3, -1)) technologyOptions[`${key}Sha256`] = evidence.hashes[key]
    check(execution.ok && evidence.opened && evidence.closed,
      execution.timedOut ? 'SSH timed out during extraction' : `guest extraction did not finish: ${transportFailure(execution)}`)
    check(evidence.hashes.gds === gdsSha256 && evidence.hashes.sourceCdl === sourceCdlSha256 &&
      evidence.hashes.drcDeck === drcDeckSha256, 'the extraction inputs did not match the verification record')
    const read = (key) => {
      check(result.artifacts[key], `Calibre PEX did not return ${FILES[key]}`)
      return readFile(result.artifacts[key], 'utf8')
    }
    for (const phase of PHASES) {
      const logKey = phase === 'prepare' ? 'preparationLog' : `${phase}Stdout`
      if (evidence.codes[phase] !== 0) {
        const log = result.artifacts[logKey] ? await read(logKey) : ''
        throw new Error(phaseFailure(phase, evidence.codes[phase], log))
      }
      if (phase === 'lvs') {
        const lvs = readLvsEvidence(await read('lvsReport'), await read('lvsExtractionReport'), location)
        result.phases.lvs = { ...lvs, exitCode: 0 }
        if (lvs.status === 'fail') return { ...result, status: 'fail', error: 'Calibre xRC LVS reported INCORRECT' }
        check(lvs.status === 'pass', `Calibre xRC LVS reported ${lvs.verdict}`)
      } else if (phase === 'prepare') {
        result.phases.prepare = { status: 'pass', exitCode: 0 }
      } else {
        result.phases[phase] = xrcPhaseEvidence(phase, await read(logKey))
      }
    }

    check(result.artifacts.dspf && evidence.hashes.dspf &&
      await fileSha256(result.artifacts.dspf) === evidence.hashes.dspf, 'downloaded DSPF differs from the Calibre output')
    result.pex = inspectDspf(await read('dspf'), await read('sourceCdl'), await read('report'), location)
    return { ...result, dspfSha256: evidence.hashes.dspf, ok: true, status: 'pass' }
  } catch (error) {
    return { ...result, error: error?.message ?? String(error) }
  }
}
