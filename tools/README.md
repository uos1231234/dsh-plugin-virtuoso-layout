# tools/ — standalone, dependency-free helpers

These are deliberately **outside** the DSH plugin. The plugin's stage 1 stays a
single-variable activation test (`workspace_create` only); mechanisms are proven
here from the shell first, then wired in as thin adapters. Node builtins only, so
they run before any DSH restart.

## `drc.mjs` — structure Calibre DRC output

Verified against **real Calibre runs** (`v2015.2_36.27`) on a SMIC 0.18
(`smic18ee`) design, with the foundry deck `SmicDR10T_<rev>.drc`.

```powershell
node tools/drc.mjs summary <file.drc.summary>
node tools/drc.mjs results <file.drc.results>
node tools/drc.mjs check   <file.drc.summary> <file.drc.results>
```

`check` is the test, not a re-read: the `.summary` and `.drc.results` files are
written by the **same** Calibre run, so they must agree per check. Two
independent parsers agreeing is evidence, whereas re-reading one file is not.

| Cell | summary | results | agree |
|---|---|---|---|
| `work` | 273 | 273 | ✅ |
| `nmos` | 6 | 6 | ✅ |
| `work2` | 10 | 10 | ✅ |
| `DRC\nmos` | 33 | 33 | ✅ |
| `DRC\work_1` | 11 | 11 | ✅ |

All five exit 0 with `disagreements: []`. `work` also exercises the awkward
cases: a 427-check rule deck, 34 `NOT EXECUTED` checks, check names containing
`.` and `&` (`PB.1`, `PD.GTa`, `SN_10&11`), and both a global table and per-cell
detail blocks that must not be double-counted.

Grammar notes worth keeping, because both formats are padding-sensitive:

- Summary rows are `KEY name ....... tail` where **the name itself may contain
  dots**, so `\S+` would swallow the padding. The row regex is
  `^([A-Z]+)\s+(.+?)\s+\.{2,}\s*(.*)$` — lazy name, then two-or-more dots.
- A rulecheck appears in the global table *and* again inside each `CELL` block.
  Totals are therefore summed from one section only, or they inflate.
- `.drc.results` records are recognised by **shape** (bare name, then
  `<count> <count> <date>`, then `Rule File Pathname:`), never by a name pattern
  — otherwise violation geometry gets mistaken for a check name.
- Per-violation geometry is `p <n> <vertexCount>`, then a `CN <cell> ...`
  reference record, then that many `x y` pairs. All-zero runs contain no `p`
  records at all, which is the clean-case path.

`PIPO.LOG.*` / `PIPO.SUM.*` in the same directory are **not** verification
output — they are Virtuoso XStream `strmout` GDS-export statistics. Only
`*.drc.summary` / `*.drc.results` are DRC.

## `virtuoso.mjs` — VM and bridge lifecycle

```powershell
node tools/virtuoso.mjs config
node tools/virtuoso.mjs vm-status
node tools/virtuoso.mjs vm-start [--gui]
node tools/virtuoso.mjs vm-stop  [--hard]
node tools/virtuoso.mjs guest-ready [budgetMs]
node tools/virtuoso.mjs ssh <command...>
node tools/virtuoso.mjs virtuoso-running
node tools/virtuoso.mjs bridge-status
```

Config is `DEFAULT_CONFIG` overlaid by `../virtuoso.config.json` — the same file
the plugin will surface as a settings page. Overlay parse errors are reported,
not fatal.

Behaviours verified on this machine:

- `vmrun -T ws list` parses (`Total running VMs: 0`, `targetRunning: false`).
- `guest-ready` does a **TCP connect to sshd**, not ICMP: VMware NAT can answer
  ping before sshd accepts, and readiness only matters if the bridge can SSH in.
  It reports `tcp connect timed out after 3000ms` while the VM is off.
- `ssh` uses `BatchMode=yes`, so a missing key fails in ~10s instead of hanging
  on an interactive password prompt — the failure mode that would otherwise
  wedge a non-interactive caller forever.

### Blocker: the VM cannot be started without elevation

`vmrun -T ws start <vmx> nogui` fails in ~3s with `Error: 主机或客户机操作系统上发生了文件访问错误`
(exit -1), **not** a VM problem:

```
<VM_DIR>\RHEL6_ic617      Everyone: ReadAndExecute, Synchronize
                          BUILTIN\Administrators: FullControl
                          NT AUTHORITY\SYSTEM: FullControl
```

The invoking account is unelevated `laptop-dckvvhu3\hp`, so it only gets
ReadAndExecute. VMware must create a lock file next to the `.vmx`, so the start
fails and **no `.lck` is created**. Consequences:

- `memsize = "4096"` **cannot be lowered** — the `.vmx` is not writable.
- Any fix needs one of: run VMware Workstation elevated; grant the user account
  Modify on `<VM_DIR>\RHEL6_ic617`; or move the VM to a writable directory.
- Host free RAM was 4.1–5.8 GB against a 4 GB guest, so lowering memory was
  wanted for headroom, not because 4 GB is impossible.
