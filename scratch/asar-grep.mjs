// Bounded text scan inside the Electron asar (it is a plain concatenated blob,
// so a byte-offset search with a printed window answers "does this string exist
// and what surrounds it" without dumping anything unbounded).
//
//   node scratch/asar-grep.mjs <needle> [ctxLen=600] [maxHits=5] [file]
import fs from 'node:fs'

const [needle, ctxArg, maxArg, fileArg] = process.argv.slice(2)
if (!needle) {
  console.error('usage: node scratch/asar-grep.mjs <needle> [ctxLen] [maxHits] [file]')
  process.exit(2)
}
const file = fileArg ?? 'E:/dsp harness/resources/app.asar'
const ctxLen = Number(ctxArg ?? 600)
const maxHits = Number(maxArg ?? 5)

const s = fs.readFileSync(file).toString('latin1')
let i = -1
let hits = 0
while (hits < maxHits) {
  i = s.indexOf(needle, i + 1)
  if (i === -1) break
  hits += 1
  const a = Math.max(0, i - ctxLen)
  const b = Math.min(s.length, i + needle.length + ctxLen)
  console.log(`--- hit ${hits} at byte ${i} ---`)
  console.log(s.slice(a, b).replace(/[^\t\n\x20-\x7e]/g, '.'))
}
console.log(`[asar-scan] file=${file} bytes=${s.length} needle=${JSON.stringify(needle)} hits=${hits}`)
