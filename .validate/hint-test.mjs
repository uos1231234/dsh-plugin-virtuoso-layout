// Exercises the failure-diagnosis layer against payloads actually observed on
// this machine. Runs offline: no VM, no guest, no bridge CLI.
import { hintFor, withHint, diagnoseEvalResult } from '../dsh-plugin-virtuoso-layout/lib/virtuoso.js'

let fails = 0

const cases = [
  ['tunnel-down', 'CLI status error: connect ECONNREFUSED 127.0.0.1:65453'],
  ['modal-block', 'no answer: socket said the daemon reported a timeout'],
  ['skill-load', '("load" 0 t nil ("*Error* load: error while loading file - "/tmp/vb_eval_kWxe__.il" at line 5"))'],
  ['missing-file', "ENOENT: no such file or directory, open 'C:\\nope.drc.summary'"],
  ['ssh-auth', 'Permission denied (publickey,password).'],
  ['lossless', 'tool "virtuoso_eval" returned invalid output: value is not lossless JSON'],
]

for (const [name, text] of cases) {
  const hint = hintFor(text)
  if (hint.length === 0) fails += 1
  console.log(`${hint.length > 0 ? 'HINT' : 'MISS'}  ${name.padEnd(13)} ${hint.slice(0, 68)}…`)
}

// An unrecognised failure must stay untouched: a wrong hint is worse than none.
const unknown = 'totally alien failure'
console.log(`identity on unknown:  ${withHint(unknown) === unknown ? 'OK' : 'BROKEN'}`)
if (withHint(unknown) !== unknown) fails += 1

// A recognised one must gain a real newline, not a literal backslash-n.
const joined = withHint('boom: ECONNREFUSED')
console.log(`newline in withHint:  ${joined.includes('\nHint: ') ? 'OK' : `BROKEN ${JSON.stringify(joined)}`}`)
if (!joined.includes('\nHint: ')) fails += 1

// The real payload from the earlier `virtuoso_eval` probe.
const failed = diagnoseEvalResult({
  ok: false,
  errors: ['("load" 0 t nil ("*Error* load: error while loading file - "/tmp/vb_eval_kWxe__.il" at line 5"))'],
})
console.log(`diagnosed kind:       ${failed.errorKind}`)
console.log(`extracted errorText:  ${failed.errorText}`)
if (failed.errorKind !== 'skill-load' || !failed.hint || !failed.errorText) fails += 1

// A success must gain nothing at all.
const clean = diagnoseEvalResult({ ok: true, errors: [] })
if (Object.keys(clean).length !== 0) {
  console.log(`BROKEN: success was annotated: ${JSON.stringify(clean)}`)
  fails += 1
} else {
  console.log('success untouched:    OK')
}

console.log(fails === 0 ? 'ALL HINTS OK' : `${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)
