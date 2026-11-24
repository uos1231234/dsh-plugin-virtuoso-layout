import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runLayoutPex } from '../dsh-plugin-virtuoso-layout/lib/layout-pex.js'
import { runLayoutSimulation } from '../dsh-plugin-virtuoso-layout/lib/layout-simulation.js'
import { fixturePdk } from './fixtures/layout-site.mjs'

const hash = (text) => createHash('sha256').update(text).digest('hex')

test('rejects the implicit VSS reference for a source with B as its only reference port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ground-regression-'))
  try {
    const cdl = '.SUBCKT pair IN OUT B\n.ENDS pair\n'
    const staleDspf = '.SUBCKT pair OUT IN B\n*|GROUND_NET VSS\nC0 OUT VSS 1f\n.ENDS pair\n'
    const gds = 'fixture GDS content'
    const paths = {
      gds: join(directory, 'layout.gds'), sourceCdl: join(directory, 'source.cdl'), dspf: join(directory, 'layout.spf'),
    }
    await Promise.all([writeFile(paths.gds, gds), writeFile(paths.sourceCdl, cdl), writeFile(paths.dspf, staleDspf)])
    const config = { artifactDir: directory }
    const source = { lib: 'test', cell: 'pair', view: 'schematic' }
    const artifacts = paths
    let attemptedRemote = false
    const remote = async () => { attemptedRemote = true; throw new Error('unexpected remote invocation') }
    const deps = { runWithInput: remote, run: remote }
    const pex = await runLayoutPex(config, { pdk: fixturePdk, verification: {
      kind: 'virtuoso.layout-verification', status: 'pass', streamOut: { status: 'pass' },
      lvs: { status: 'pass', verdict: 'CORRECT' }, pdk: 'smic18ee', source, target: { ...source, view: 'layout' }, artifacts,
      gdsSha256: hash(gds), sourceCdlSha256: hash(cdl), technologyOptions: {
        metalStack: 'p2mt6', drcDeck: fixturePdk.drcDeck, drcDeckSha256: hash('dummy DRC'),
      },
    } }, deps)
    assert.match(pex.error, /ground reference VSS is absent/)

    const sim = await runLayoutSimulation(config, { extraction: {
      ok: true, status: 'pass', source, artifacts, sourceCdlSha256: hash(cdl), dspfSha256: hash(staleDspf),
    } }, deps)
    assert.match(sim.error, /DSPF ground reference is not a source port/)
    assert.equal(attemptedRemote, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
