import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { runLayoutVerification } from '../dsh-plugin-virtuoso-layout/lib/layout-verification.js'
import { fixturePdk } from './fixtures/layout-site.mjs'

const sha256 = (content) => createHash('sha256').update(content).digest('hex')
const gds = Buffer.from([0, 6, 0, 2, 2, 88, 0, 4, 4, 0])
const matching = '.SUBCKT sch D G S B\nMN1 D G S B example_nmos w=1.2u l=0.18u\n.ENDS sch\n'
const mismatching = matching.replace('MN1 D G S B', 'MN1 G G S B')

// Keep the artifacts at the SSH/SCP boundary. The production function still
// builds each run request, writes its input and checks the downloaded reports.
function guestTransport({ wrongGds = false, missingSummary = false, lvsExit = 0 } = {}) {
  let remoteDir
  let files
  return {
    async runWithInput(command, args, { input }) {
      assert.equal(command, 'ssh')
      assert.equal(args.at(-1), 'bash -s')
      const runId = /^run_id='([^']+)'$/m.exec(input)[1]
      remoteDir = /^work='([^']+)'$/m.exec(input)[1]
      assert.equal(remoteDir, `/tmp/dsh-layout-${runId}`)
      const receivedCdl = Buffer.from(/<<'DSH_SOURCE_CDL'\n([\s\S]+?)\nDSH_SOURCE_CDL/.exec(input)[1], 'base64')
      const verdict = receivedCdl.includes('MN1 G G S B') ? 'INCORRECT' : 'CORRECT'
      const layoutPath = `${remoteDir}/layout.gds`
      const lvsReport = `${remoteDir}/layout.lvs.rep`
      files = {
        'layout.gds': gds,
        'strmout.log': "INFO (XSTRM-234): Translation completed. '0' error(s) and '1' warning(s) found.\n",
        'layout.drc.summary': `=== CALIBRE::DRC-H SUMMARY REPORT
Layout Path(s): ${layoutPath}
Layout Primary Cell: lay
--- RULECHECK RESULTS STATISTICS
RULECHECK DEMO .... TOTAL Result Count = 0 (0)
--- SUMMARY
TOTAL DRC RuleChecks Executed: 1
TOTAL DRC Results Generated: 0 (0)
`,
        'layout.drc.results': 'lay 1000\n',
        'layout.lvs.rep': `REPORT FILE NAME: ${lvsReport}
LAYOUT NAME: ${remoteDir}/svdb/lay.sp ('lay')
SOURCE NAME: ${remoteDir}/source.cdl ('sch')
RULE FILE: effective.lvs
OVERALL COMPARISON RESULTS
       #   #     #    ${verdict}    #        |
************************************************
CELL SUMMARY
${verdict} lay sch
`,
        'layout.lvs.rep.ext': `REPORT FILE NAME: ${lvsReport}.ext
LAYOUT NAME: ${wrongGds ? '/tmp/prior-run/layout.gds' : layoutPath} ('lay')
`,
      }
      if (missingSummary) delete files['layout.drc.summary']
      const lines = [
        'opened',
        'exit streamOut 0',
        'exit drc 0',
        `exit lvs ${lvsExit}`,
        `hash gds ${sha256(gds)}`,
        `hash sourceCdl ${sha256(receivedCdl)}`,
        ...Object.keys(files).map((name) => `file ${name}`),
        'closed',
      ]
      return { ok: true, code: 0, stdout: lines.map((line) => `DSH_LAYOUT_VERIFY ${runId} ${line}`).join('\n') }
    },
    async run(command, args, { cwd }) {
      assert.equal(command, 'scp')
      const requested = args.filter((arg) => arg.startsWith('guest@127.0.0.1:'))
      assert.deepEqual(requested, Object.keys(files).map((name) => `guest@127.0.0.1:${remoteDir}/${name}`))
      await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(join(cwd, name), contents)))
      return { ok: true, code: 0 }
    },
  }
}

test('signoff uses reports bound to a fresh GDS and source netlist', async (t) => {
  const artifactDir = await mkdtemp(join(tmpdir(), 'layout-verification-test-'))
  t.after(async () => {
    assert.equal(dirname(resolve(artifactDir)), resolve(tmpdir()))
    await rm(artifactDir, { recursive: true, force: true })
  })
  const config = { artifactDir, sshPort: 22, sshUser: 'guest', guestIp: '127.0.0.1' }
  const verify = (sourceCdl, mode) => runLayoutVerification(config, {
    library: 'test', cell: 'lay', sourceCell: 'sch', sourceCdl, pdk: fixturePdk,
  }, guestTransport(mode))

  const first = await verify(matching)
  assert.equal(first.status, 'pass', first.error)
  assert.equal(first.gdsSha256, sha256(gds))
  assert.equal(first.sourceCdlSha256, sha256(matching))
  assert.equal(first.drc.totals.violations, 0)
  assert.equal(first.lvs.verdict, 'CORRECT')

  const rerun = await verify(Buffer.from(mismatching))
  assert.equal(rerun.status, 'fail', rerun.error)
  assert.equal(rerun.lvs.verdict, 'INCORRECT')
  assert.equal(rerun.lvs.exitCode, 0)
  assert.notEqual(rerun.runId, first.runId)
  assert.notEqual(rerun.remoteRunDir, first.remoteRunDir)
  assert.equal(await readFile(rerun.artifacts.sourceCdl, 'utf8'), mismatching)
  assert.equal(await readFile(first.artifacts.sourceCdl, 'utf8'), matching)

  const wrongGds = await verify(matching, { wrongGds: true })
  assert.equal(wrongGds.status, 'error')
  assert.match(wrongGds.lvs.error, /this run’s GDS/)

  const missingSummary = await verify(matching, { missingSummary: true })
  assert.equal(missingSummary.status, 'error')
  assert.match(missingSummary.drc.error, /did not write/)
  assert.equal(missingSummary.lvs.status, 'pass')

  const toolError = await verify(matching, { lvsExit: 4 })
  assert.equal(toolError.status, 'error')
  assert.equal(toolError.lvs.exitCode, 4)
})
