/**
 * Regression test for `virtuoso_run`'s background-job payload.
 *
 * The bug this pins down was found *live*, not here: a completed job printed its
 * output twice, because the job streamed every stdout chunk through
 * `job.append` **and** the settled payload copied the whole of stdout into
 * `result`. The discriminator was a two-channel probe —
 * `echo OUT-ONLY; echo ERR-ONLY 1>&2` came back as OUT-ONLY, [stderr] ERR-ONLY,
 * OUT-ONLY: stdout doubled, stderr (which `result` never carried) did not.
 *
 * So the assertion that matters is negative: the settled payload must not
 * contain the streamed bytes. It is testable offline because the payload is
 * built by `jobOutcome()` in virtuoso.js rather than inside the tool closure —
 * the tool closure needs a live ssh to run at all.
 *
 * Run: node .validate/job-test.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { jobOutcome } from '../dsh-plugin-virtuoso-layout/lib/virtuoso.js'

const here = dirname(fileURLToPath(import.meta.url))
const INDEX = join(here, '..', 'dsh-plugin-virtuoso-layout', 'lib', 'index.js')

let checks = 0
const failures = []

function check(label, fn) {
  checks += 1
  try {
    fn()
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures.push(`${label}: ${error.message}`)
    console.log(`  FAIL ${label}\n         ${error.message}`)
  }
}

console.log('job payload checks')

const STDOUT = 'OUT-ONLY\n'
const STDERR = 'ERR-ONLY\n'

check('completed: status and reason, nothing else', () => {
  const payload = jobOutcome({ ok: true, code: 0, stdout: STDOUT, stderr: STDERR })
  assert.deepEqual(payload, { status: 'completed', detail: 'ssh exited 0' })
  assert.deepEqual(Object.keys(payload).sort(), ['detail', 'status'])
})

check('completed: streamed stdout is NOT repeated (the bug)', () => {
  const payload = jobOutcome({ ok: true, code: 0, stdout: STDOUT, stderr: STDERR })
  const text = JSON.stringify(payload)
  assert.ok(!text.includes('OUT-ONLY'), `payload re-sent stdout: ${text}`)
  assert.ok(!text.includes('ERR-ONLY'), `payload re-sent stderr: ${text}`)
  assert.ok(!('result' in payload), 'payload still carries a `result` field')
})

check('timeout: killed, with the budget that was exceeded', () => {
  const payload = jobOutcome({ ok: false, code: 1, timedOut: true, stdout: STDOUT }, 2500)
  assert.deepEqual(payload, { status: 'killed', detail: 'exceeded 2500ms' })
})

check('nonzero exit: failed, with the code', () => {
  const payload = jobOutcome({ ok: false, code: 2, stdout: STDOUT, stderr: STDERR })
  assert.deepEqual(payload, { status: 'failed', detail: 'ssh exited 2' })
})

check('spawn failure: says ssh could not start instead of inventing an exit code', () => {
  const payload = jobOutcome({ ok: false, code: 1, error: 'spawn ssh ENOENT' })
  assert.equal(payload.status, 'failed')
  assert.ok(payload.detail.includes('ENOENT'), payload.detail)
})

check('missing code: still a readable detail, never "undefined"', () => {
  const payload = jobOutcome({ ok: false })
  assert.equal(payload.status, 'failed')
  assert.ok(!payload.detail.includes('undefined'), payload.detail)
})

// --- wiring guard -----------------------------------------------------------
// jobOutcome() being correct is useless if the tool does not call it. These two
// are source-level assertions on purpose: reaching the real closure would need a
// live ssh, and the failure mode they guard against is exactly "someone adds the
// stdout copy back".
const source = readFileSync(INDEX, 'utf8')

check('index.js imports jobOutcome', () => {
  assert.ok(/^\s*jobOutcome,$/m.test(source), 'jobOutcome is not in the ./virtuoso.js import list')
})

check('index.js settles the job through jobOutcome', () => {
  assert.ok(/handle\.done\.then\(\(result\) => jobOutcome\(/.test(source), 'the job does not settle via jobOutcome')
  assert.ok(!/result:\s*clip\(result\.stdout/.test(source), 'the duplicated-stdout payload is back in index.js')
})

console.log()
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S) out of ${checks} checks`)
  for (const failure of failures) console.log(` - ${failure}`)
  process.exit(1)
}
console.log(`ALL JOB-PAYLOAD CHECKS PASSED (${checks} checks)`)
