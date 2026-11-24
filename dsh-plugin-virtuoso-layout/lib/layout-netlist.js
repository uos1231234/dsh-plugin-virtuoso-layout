import { bridgeEval, ensureTunnel, runWithInput, sshArgs } from './virtuoso.js'

const shellWord = (text) => `'${String(text).replaceAll("'", "'\\''")}'`
const skillString = (text) => JSON.stringify(text)

const invoke = async (config, args, script, timeoutMs) => {
  const command = `bash -s -- ${args.map(shellWord).join(' ')}`
  return runWithInput('ssh', sshArgs(config, command), { input: script, timeoutMs })
}

/** Export a saved source schematic with Virtuoso's own batch netlister. */
export async function exportSourceCdl(config, source, { timeoutMs = 120_000 } = {}) {
  let directory
  try {
    const allocated = await invoke(config, [], 'mktemp -d /tmp/dsh-layout-cdl.XXXXXXXX\n', timeoutMs)
    const parent = allocated.stdout.trim()
    if (!allocated.ok || !/^\/tmp\/dsh-layout-cdl\.[A-Za-z0-9]+$/.test(parent)) {
      throw new Error(`cannot create source netlist directory: ${allocated.stderr.trim() || 'SSH command failed'}`)
    }
    // IC617 raises a blocking confirmation if the actual run dir already exists
    // without si.env. Reserve its parent and let Virtuoso create the child.
    directory = `${parent}/netlist`
    const tunnel = await ensureTunnel(config)
    if (!tunnel.ok) throw new Error(tunnel.detail)
    const args = [directory, source.lib, source.cell, source.view, 'auCdl'].map(skillString).join(' ')
    const environment = await bridgeEval(config,
      `prog(() simInitEnvWithArgs(${args} nil) return(simplifyFilename("./cds.lib")))`,
      { timeoutSec: Math.ceil(timeoutMs / 1000) })
    if (!environment.ok) {
      throw new Error(environment.errors?.join?.(' ') || environment.stderr || environment.parseError ||
        'CIW could not initialize auCdl')
    }
    const raw = environment.output
    const cdsLib = typeof raw === 'string' ? raw.trim().replace(/^"|"$/g, '') : ''
    if (!cdsLib.startsWith('/') || /[\r\n]/.test(cdsLib)) throw new Error('CIW did not identify its cds.lib')

    const result = await invoke(config, [directory, cdsLib], `set -eu
cd "$1"
export CDS_Netlisting_Mode=Analog
test -s si.env || { echo "CIW did not create si.env" >&2; exit 2; }
test -r "$2" || { echo "CIW cds.lib is unavailable: $2" >&2; exit 2; }
# IC617's setup helper omits these two auCdl options from si.env.
for option in incFILE setEQUIV; do
  grep -q "^$option[[:space:]]*=" si.env || printf '\\n%s=""\\n' "$option" >> si.env
done
si=$(command -v si || true)
: "\${si:=/opt/IC617/tools/dfII/bin/si}"
"$si" -batch -cdslib "$2" -command netlist > si.log 2>&1 || {
  tail -n 18 si.log >&2
  exit 2
}
test -s netlist || { tail -n 18 si.log >&2; exit 2; }
cat netlist
`, timeoutMs)
    if (!result.ok) throw new Error(result.stderr.trim() || 'si batch netlisting failed')
    const subcircuits = [...result.stdout.matchAll(/^\s*\.SUBCKT\s+(\S+)/gim)]
    if (!subcircuits.some((match) => match[1].toLowerCase() === source.cell.toLowerCase())) {
      throw new Error(`auCdl output has no .SUBCKT for ${source.cell}`)
    }
    return { ok: true, sourceCdl: result.stdout, directory }
  } catch (error) {
    return { ok: false, error: `${error.message}${directory ? ` (guest netlist directory ${directory})` : ''}` }
  }
}
