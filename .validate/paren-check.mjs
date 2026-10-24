// Paren balance for SKILL files, ignoring `;` line comments, `/* */` blocks and
// string literals. A load that fails at the last line usually means an unclosed
// `(` somewhere above, so this reports the running depth per line.
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const src = readFileSync(file, 'utf8')

let depth = 0
let inString = false
let inComment = false
let lineComment = false
let line = 1

for (let i = 0; i < src.length; i += 1) {
  const c = src[i]
  const n = src[i + 1]
  if (c === '\n') {
    line += 1
    lineComment = false
    continue
  }
  if (lineComment) continue
  if (inComment) {
    if (c === '*' && n === '/') {
      inComment = false
      i += 1
    }
    continue
  }
  if (inString) {
    if (c === '\\') {
      i += 1
      continue
    }
    if (c === '"') inString = false
    continue
  }
  if (c === '/' && n === '*') {
    inComment = true
    i += 1
    continue
  }
  if (c === ';') {
    lineComment = true
    continue
  }
  if (c === '"') {
    inString = true
    continue
  }
  if (c === '(') depth += 1
  if (c === ')') {
    depth -= 1
    if (depth < 0) {
      console.log(`UNBALANCED: extra ) at line ${line}`)
      process.exit(1)
    }
  }
  if (depth > 0 && c === ')') {
    // no-op: kept for clarity
  }
}

console.log(`final depth = ${depth} (0 means balanced)`)
console.log(`inString = ${inString}, inComment = ${inComment}`)

// Report the depth at the start of each line, so a line that leaves a level open
// stands out.
let d = 0
let inS = false
let inC = false
let lc = false
let ln = 1
const report = []
for (let i = 0; i < src.length; i += 1) {
  const c = src[i]
  const n = src[i + 1]
  if (c === '\n') {
    report.push(`${String(ln).padStart(3)} depth=${d}`)
    ln += 1
    lc = false
    continue
  }
  if (lc) continue
  if (inC) {
    if (c === '*' && n === '/') {
      inC = false
      i += 1
    }
    continue
  }
  if (inS) {
    if (c === '\\') {
      i += 1
      continue
    }
    if (c === '"') inS = false
    continue
  }
  if (c === '/' && n === '*') {
    inC = true
    i += 1
    continue
  }
  if (c === ';') {
    lc = true
    continue
  }
  if (c === '"') {
    inS = true
    continue
  }
  if (c === '(') d += 1
  if (c === ')') d -= 1
}
report.push(`${String(ln).padStart(3)} depth=${d}`)
console.log(report.join('\n'))
