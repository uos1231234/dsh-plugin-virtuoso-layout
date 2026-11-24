#!/usr/bin/env node
/**
 * drc.mjs — structure Calibre DRC output into JSON.
 *
 * Verified against Calibre v2015.2_36.27 summary and ASCII results reports.
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
 * `*.drc.results` — the ASCII results database: `<cell> <databasePrecision>`, then one
 *   record per check:
 *     GP_6                              <- check name
 *     80 80 2 Apr  3 21:46:05 2026      <- count, mirrored count, timestamp
 *     Rule File Pathname: /home/...
 *     Minimum extension from AA region to GP  0.32     <- rule description
 *     p 1 4                             <- violation: polygon, ordinal, vertex count
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
    checks: globalChecks,
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

const MARKER = /^([ep])\s+(\d+)\s+(\d+)$/i
const COORDINATES = /^-?\d+(?:\s+-?\d+)+$/

function readMarker(lines, index, end, header) {
  const [, signature, ordinal, size] = header
  const type = signature.toLowerCase() === 'p' ? 'polygon' : 'edges'
  const dimensions = type === 'polygon' ? 2 : 4
  const count = Number(size)
  let cellReference
  let cursor = index + 1
  // Optional properties precede the coordinates. Only the cell transform
  // participates in coordinate conversion. Never forward check text.
  while (cursor < end && !COORDINATES.test(lines[cursor]) && !MARKER.test(lines[cursor])) {
    const [property, cell, space, ...values] = lines[cursor++].split(/\s+/)
    if (property === 'CN') {
      const transform = values.slice(0, 6).map(Number)
      cellReference = { cell, cellSpace: space === 'c',
        transform: transform.length === 6 && transform.every(Number.isSafeInteger) ? transform : null }
    }
  }
  const coordinates = []
  for (let n = 0; n < count && cursor < end; n++, cursor++) {
    const line = lines[cursor]
    if (!COORDINATES.test(line)) break
    const numbers = line.split(/\s+/).map(Number)
    if (numbers.length !== dimensions || !numbers.every(Number.isSafeInteger)) break
    coordinates.push(numbers)
  }
  return { type, ordinal: Number(ordinal), ...(cellReference && { cellReference }),
    coordinates, complete: coordinates.length === count && count >= (type === 'polygon' ? 3 : 1) }
}

/** Parse ASCII DRC check headers and, on request, both marker geometries. */
export function parseResults(text, { markers = false } = {}) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim())
  const head = /^(\S+)\s+(\d+)$/.exec(lines[0] ?? '')
  const checks = []
  const countsLine = /^(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}|\d{1,2}\s+\w{3}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\b/
  let i = 1
  while (i + 1 < lines.length) {
    const name = lines[i]
    const counts = countsLine.exec(lines[i + 1])
    if (!name || /\s/.test(name) || !counts) {
      i++
      continue
    }
    const [, count, mirror, textLines, date] = counts
    const bodyStart = i + 2 + Number(textLines)
    const checkText = lines.slice(i + 2, bodyStart)
    let end = bodyStart
    while (end + 1 < lines.length && !countsLine.test(lines[end + 1])) end++
    if (end + 1 === lines.length) end = lines.length
    const check = {
      name, count: Number(count), mirror: Number(mirror), date,
      ruleFile: checkText.find((line) => line.startsWith('Rule File Pathname:'))
        ?.replace(/^Rule File Pathname:\s*/, ''),
      description: checkText.find((line) => !line.startsWith('Rule File Pathname:')),
      polygonRecords: 0, firstViolationVertices: [], records: 0,
      ...(markers && { markers: [] }),
    }
    for (let j = bodyStart; j < end; j++) {
      if (/^(p|b|v|e|CN)\s/i.test(lines[j])) check.records++
      const header = MARKER.exec(lines[j])
      if (!header) continue
      const polygon = header[1].toLowerCase() === 'p'
      if (polygon) check.polygonRecords++
      if (markers || (polygon && check.polygonRecords === 1)) {
        const marker = readMarker(lines, j, end, header)
        if (polygon && check.polygonRecords === 1) check.firstViolationVertices = marker.coordinates
        if (markers) check.markers.push(marker)
      }
    }
    checks.push(check)
    i = end
  }

  const violating = checks.filter((check) => check.count > 0)
  const precision = head ? Number(head[2]) : undefined
  return {
    kind: 'calibre-drc-results',
    cell: head?.[1],
    precision,
    // Preserve the historical field for callers of the summary tooling.
    maxResultsPerCheck: precision,
    checks,
    totals: {
      violations: violating.reduce((sum, check) => sum + check.count, 0),
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
  const summaryCell = summary.header?.['Layout Primary Cell']
  const resultsCell = results.cell
  const sameReportKind = summary.kind === 'calibre-drc-summary' && results.kind === 'calibre-drc-results'
  const sameCell = Boolean(summaryCell) && summaryCell === resultsCell
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
    summaryCell,
    resultsCell,
    reason: !sameReportKind ? 'expected a summary and an ASCII results database' :
      !sameCell ? 'summary and results identify different top cells' : undefined,
    agreement: sameReportKind && sameCell && disagreements.length === 0 &&
      summary.totals?.violations === results.totals?.violations,
    disagreements,
  }
}

/** Parse and verify the native report envelope before exposing any counts. */
export function parseReport(text, kind, options) {
  if (kind === 'results') {
    const data = parseResults(text, options)
    if (!data.cell || !Number.isSafeInteger(data.precision) || data.precision <= 0 ||
        (data.checks.length === 0 && text.trim().split(/\r?\n/).length !== 1)) {
      throw new Error('invalid or incomplete Calibre ASCII DRC results database')
    }
    return data
  }
  if (kind !== 'summary') throw new Error('expected DRC report type summary or results')

  const data = parseSummary(text)
  const finishedChecks = /^TOTAL DRC RuleChecks Executed:\s*(\d+)\s*$/m.exec(text)
  const finishedResults = /^TOTAL DRC Results Generated:\s*(\d+)\s*(?:\(\d+\))?\s*$/m.exec(text)
  if (!/^=+\s+CALIBRE::DRC(?:-H)? SUMMARY REPORT\s*$/m.test(text) ||
      !data.header['Layout Primary Cell'] || data.globalSection !== 'RULECHECK RESULTS STATISTICS' ||
      !finishedChecks || Number(finishedChecks[1]) !== data.totals.executedChecks ||
      !finishedResults || Number(finishedResults[1]) !== data.totals.violations ||
      data.totals.executedChecks === 0 || data.checks.some((check) => check.status === 'unknown')) {
    throw new Error('invalid or incomplete Calibre DRC summary report')
  }
  return data
}

/** Read and parse a report, reporting errors in the same shape as file I/O. */
export async function parseFile(path) {
  try {
    const text = await readFile(path, 'utf8')
    const kind = path.endsWith('.drc.results') ? 'results' : 'summary'
    return { ok: true, path, data: parseReport(text, kind) }
  } catch (error) {
    return { ok: false, path, error: String(error?.message ?? error) }
  }
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

/** Compact human line for one failing check. */
const describe = (check) => `  ${String(check.count).padStart(5)}  ${check.name}${check.description ? `  — ${check.description}` : ''}`

export async function main(argv) {
  const [command, ...args] = argv
  const asJson = args.includes('--json')
  const rest = args.filter((arg) => arg !== '--json')
  switch (command) {
    case 'summary': {
      const result = await parseFile(rest[0])
      if (!result.ok) {
        console.error(result.error)
        return 1
      }
      const { data } = result
      if (asJson) {
        console.log(JSON.stringify(data))
        return 0
      }
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
      if (asJson) {
        console.log(JSON.stringify(data))
        return 0
      }
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
      console.log(JSON.stringify(verdict, null, asJson ? undefined : 2))
      return verdict.agreement ? 0 : 1
    }
    default: {
      console.error('usage: node tools/drc.mjs <summary|results|check> <file> [file2] [--json]')
      return 1
    }
  }
}

import { pathToFileURL } from 'node:url'
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
