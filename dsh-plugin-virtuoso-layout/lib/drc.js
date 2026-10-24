#!/usr/bin/env node
/**
 * drc.mjs — structure Calibre DRC output into JSON.
 *
 * Verified against real Calibre v2015.2_36.27 runs on a SMIC 0.18
 * (`smic18ee`) design, using the foundry DRC deck `SmicDR10T_<rev>.drc`.
 *
 * Two artefacts, two grammars:
 *
 * `*.drc.summary` — the human SUMMARY REPORT. Header `Key: value` lines, then
 *   `--- SECTION NAME` blocks. Inside them, padded rows:
 *     RULECHECK GP_13 ............... TOTAL Result Count = 90    (90)
 *     RULECHECK GR_1 ................ NOT EXECUTED
 *     LAYER AAi ...... TOTAL Original Geometry Count = 3 (3)
 *     CELL work ......................... TOTAL Result Count = 11 (11)
 *   The same rulecheck appears in a global table and again in per-cell detail
 *   blocks, so counts must be read per-section or they double-count.
 *
 * `*.drc.results` — the ASCII results database: `<cell> <maxResults>`, then one
 *   record per check:
 *     GP_6                              <- check name
 *     80 80 2 Apr  3 21:46:05 2026      <- count, mirrored count, timestamp
 *     Rule File Pathname: /home/...
 *     <free-text rule description>      <- rule description, never parsed
 *     p 1 4                             <- violation: polygon, layer, vertex count
 *     CN work c 1 0 0 1 0 0 0           <- cell reference record
 *     177745 -560560                    <- vertex, as x y pairs
 *
 * CLI:
 *   node tools/drc.mjs summary <file.drc.summary>
 *   node tools/drc.mjs results <file.drc.results>
 *   node tools/drc.mjs check <file.drc.summary> <file.drc.results>   # cross-validate
 */

import { readFile } from 'node:fs/promises'

/** A padded `KEY name .... rest` row. Names may contain dots (`PB.1`) and `&`. */
const PADDED_ROW = /^([A-Z]+)\s+(.+?)\s+\.{2,}\s*(.*)$/
/** `TOTAL Result Count = 90    (90)` */
const RESULT_COUNT = /TOTAL Result Count = (\d+)\s*\((\d+)\)/
/** `TOTAL Original Geometry Count = 3 (3)` */
const GEOMETRY_COUNT = /TOTAL Original Geometry Count = (\d+)\s*\((\d+)\)/
/** A `--- SECTION NAME` banner (separator lines are all dashes and do not match). */
const SECTION = /^-{3,}\s+(\S.*?)\s*$/
/** Header `Key: value`, tolerating `/` and `()` inside the key. */
const HEADER_FIELD = /^([A-Za-z][A-Za-z0-9 /()]*):\s*(.*)$/

const KB = new Set([
  'Execution Date/Time',
  'Calibre Version',
  'Rule File Pathname',
  'Rule File Title',
  'Layout System',
  'Layout Path(s)',
  'Layout Primary Cell',
  'Current Directory',
  'User Name',
  'Maximum Results/RuleCheck',
  'Maximum Result Vertices',
  'DRC Results Database',
  'Summary Report File',
  'Layout Depth',
  'Text Depth',
])

/** Split `KEY name ... rest` rows; returns undefined for anything else. */
function paddedRow(line) {
  const match = PADDED_ROW.exec(line)
  if (match === null) return undefined
  return { keyword: match[1], name: match[2].trim(), tail: match[3].trim() }
}

/**
 * Parse a Calibre DRC summary report.
 *
 * @returns header fields, runtime warnings, per-section rows, and totals. The
 *   `totals` block counts only the global `RULECHECK RESULTS STATISTICS` section
 *   so per-cell detail blocks cannot inflate the violation count.
 */
export function parseSummary(text) {
  const lines = text.split(/\r?\n/)
  const header = {}
  const warnings = []
  const sections = []
  let section = { name: '(header)', checks: [], layers: [], cells: [], other: [] }
  sections.push(section)
  let lastKey
  let inWarnings = false

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.trim() === '') continue

    const sectionMatch = SECTION.exec(line.trim())
    if (sectionMatch !== null) {
      section = { name: sectionMatch[1], checks: [], layers: [], cells: [], other: [] }
      sections.push(section)
      inWarnings = /WARNING/i.test(sectionMatch[1])
      lastKey = undefined
      continue
    }
    // `===` banners and `----` rules carry no data.
    if (/^[=]{3,}/.test(line.trim()) || /^-{3,}$/.test(line.trim())) continue

    if (inWarnings) {
      if (/^There is|^WARNING|^ERROR/i.test(line.trim())) warnings.push(line.trim())
      continue
    }

    const row = paddedRow(line.trim())
    if (row !== undefined) {
      lastKey = undefined
      if (row.keyword === 'RULECHECK') {
        const count = RESULT_COUNT.exec(row.tail)
        section.checks.push(
          count !== null
            ? { name: row.name, status: 'executed', count: Number(count[1]), mirror: Number(count[2]) }
            : { name: row.name, status: /NOT EXECUTED/i.test(row.tail) ? 'not-executed' : 'unknown', note: row.tail },
        )
      } else if (row.keyword === 'LAYER') {
        const count = GEOMETRY_COUNT.exec(row.tail)
        section.layers.push({ name: row.name, count: count === null ? undefined : Number(count[1]) })
      } else if (row.keyword === 'CELL') {
        const count = RESULT_COUNT.exec(row.tail)
        section.cells.push({ name: row.name, count: count === null ? undefined : Number(count[1]) })
      } else {
        section.other.push({ keyword: row.keyword, name: row.name, tail: row.tail })
      }
      continue
    }

    const field = HEADER_FIELD.exec(line)
    if (field !== null && KB.has(field[1])) {
      header[field[1]] = field[2].trim()
      lastKey = field[1]
      continue
    }
    // Wrapped continuation of the previous known header field.
    if (lastKey !== undefined && /^\s{10,}\S/.test(raw)) {
      header[lastKey] = `${header[lastKey]} ${line.trim()}`.trim()
      continue
    }
    lastKey = undefined
  }

  const global = sections.find((s) => s.checks.length > 0 && s.cells.length === 0) ?? sections.find((s) => s.checks.length > 0)
  const globalChecks = global?.checks ?? []
  const executed = globalChecks.filter((c) => c.status === 'executed')
  const failing = executed.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)

  return {
    kind: 'calibre-drc-summary',
    header,
    warnings,
    sections,
    globalSection: global?.name,
    totals: {
      violations: failing.reduce((sum, c) => sum + c.count, 0),
      failingChecks: failing.length,
      executedChecks: executed.length,
      notExecutedChecks: globalChecks.filter((c) => c.status === 'not-executed').length,
      totalChecks: globalChecks.length,
    },
    failing,
  }
}

/**
 * Parse a Calibre ASCII DRC results database.
 *
 * A check record is recognised by shape rather than by a name pattern: a bare
 * name line followed by a `<count> <count> <date>` line and a
 * `Rule File Pathname:` line. That avoids mistaking violation geometry for a
 * check name.
 */
export function parseResults(text) {
  const lines = text.split(/\r?\n/)
  const head = /^(\S+)\s+(\d+)\s*$/.exec(lines[0] ?? '')
  const checks = []

  for (let i = 0; i + 3 < lines.length; i++) {
    const counts = /^(\d+)\s+(\d+)\s+(\d{1,2} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})/.exec(lines[i + 1] ?? '')
    if (counts === null) continue
    if (!/^Rule File Pathname:/.test(lines[i + 2] ?? '')) continue
    const name = (lines[i] ?? '').trim()
    if (name === '' || /\s/.test(name)) continue
    checks.push({
      name,
      count: Number(counts[1]),
      mirror: Number(counts[2]),
      date: counts[3],
      ruleFile: lines[i + 2].replace(/^Rule File Pathname:\s*/, '').trim(),
      description: (lines[i + 3] ?? '').trim(),
      nameIndex: i,
      bodyStart: i + 4,
    })
  }

  for (let k = 0; k < checks.length; k++) {
    const check = checks[k]
    const end = k + 1 < checks.length ? checks[k + 1].nameIndex : lines.length
    const body = lines.slice(check.bodyStart, end)
    const polygons = body.filter((line) => /^p\s/.test(line))
    const vertices = []
    if (polygons.length > 0) {
      const header = /^p\s+\S+\s+(\d+)/.exec(polygons[0])
      const expected = header === null ? 0 : Number(header[1])
      // Vertices follow the `CN` reference record, as `x y` pairs.
      const cn = body.findIndex((line) => /^CN\s/.test(line))
      if (cn !== -1) {
        for (const line of body.slice(cn + 1)) {
          const pair = /^(-?\d+)\s+(-?\d+)$/.exec(line)
          if (pair === null) break
          vertices.push([Number(pair[1]), Number(pair[2])])
          if (vertices.length >= expected) break
        }
      }
    }
    // A CN record marks a real violation geometry; bare counts are not geometries.
    check.polygonRecords = polygons.length
    check.firstViolationVertices = vertices
    check.records = body.filter((line) => /^(p|b|v|CN)\s/.test(line)).length
  }

  const violating = checks.filter((c) => c.count > 0)
  return {
    kind: 'calibre-drc-results',
    cell: head?.[1],
    maxResultsPerCheck: head === null ? undefined : Number(head[2]),
    checks,
    totals: {
      violations: violating.reduce((sum, c) => sum + c.count, 0),
      totalChecks: checks.length,
      failingChecks: violating.length,
    },
    failing: violating.slice().sort((a, b) => b.count - a.count),
  }
}

/**
 * Cross-validate a summary against its results database.
 *
 * The two files are written by the same run and must agree per check, so a
 * disagreement means one of the two parsers is wrong — which is exactly the
 * property that makes this a test rather than a re-read.
 */
export function reconcile(summary, results) {
  const fromSummary = new Map((summary.failing ?? []).map((c) => [c.name, c.count]))
  const fromResults = new Map((results.failing ?? []).map((c) => [c.name, c.count]))
  const names = [...new Set([...fromSummary.keys(), ...fromResults.keys()])].sort()
  const disagreements = []
  for (const name of names) {
    const a = fromSummary.get(name)
    const b = fromResults.get(name)
    if (a !== b) disagreements.push({ name, summary: a ?? null, results: b ?? null })
  }
  return {
    kind: 'calibre-drc-reconcile',
    summaryViolations: summary.totals?.violations,
    resultsViolations: results.totals?.violations,
    agreement: disagreements.length === 0 && summary.totals?.violations === results.totals?.violations,
    disagreements,
  }
}

/** Read and parse a file by extension; returns a structured result, never throws. */
export async function parseFile(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return { ok: false, path, error: String(error?.message ?? error) }
  }
  const parsed = path.endsWith('.drc.results') ? parseResults(text) : parseSummary(text)
  return { ok: true, path, data: parsed }
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

/** Compact human line for one failing check. */
const describe = (check) => `  ${String(check.count).padStart(5)}  ${check.name}${check.description ? `  — ${check.description}` : ''}`

async function main(argv) {
  const [command, ...rest] = argv
  switch (command) {
    case 'summary': {
      const result = await parseFile(rest[0])
      if (!result.ok) {
        console.error(result.error)
        return 1
      }
      const { data } = result
      console.log(`cell=${data.header['Layout Primary Cell']} rule=${data.header['Rule File Pathname']}`)
      console.log(`checks=${data.totals.totalChecks} executed=${data.totals.executedChecks} not-executed=${data.totals.notExecutedChecks}`)
      console.log(`violations=${data.totals.violations} failingChecks=${data.totals.failingChecks}`)
      console.log(data.failing.map(describe).join('\n'))
      return 0
    }
    case 'results': {
      const result = await parseFile(rest[0])
      if (!result.ok) {
        console.error(result.error)
        return 1
      }
      const { data } = result
      console.log(`cell=${data.cell} checks=${data.totals.totalChecks} violations=${data.totals.violations} failingChecks=${data.totals.failingChecks}`)
      console.log(data.failing.map(describe).join('\n'))
      return 0
    }
    case 'check': {
      const [a, b] = await Promise.all([parseFile(rest[0]), parseFile(rest[1])])
      if (!a.ok || !b.ok) {
        console.error(a.ok ? b.error : a.error)
        return 1
      }
      const verdict = reconcile(a.data, b.data)
      console.log(JSON.stringify(verdict, null, 2))
      return verdict.agreement ? 0 : 1
    }
    default: {
      console.log('usage: node tools/drc.mjs <summary|results|check> <file> [file2]')
      return 1
    }
  }
}

import { pathToFileURL } from 'node:url'
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
