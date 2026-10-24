# dsh-plugin-virtuoso-layout

A DeepSeek Harness bundle that makes the Virtuoso layout toolchain reachable by the model.

Status: **all twelve tools written; each new code path exercised live through the CLI shim, and the
plugin verified offline. One restart loads the tool surface into DSH.** The write gate lives in
`lib/guard.js` and is reported by `virtuoso_status.writeGuard` — a restart is what arms it.

`lib/virtuoso.js` is now the *single* implementation of the VM/bridge logic, and
`tools/virtuoso.mjs` is a thin shim that imports it and calls the same `main()`. The two used to
be separate near-copies that had already drifted (13 405 vs 11 298 bytes), so every helper below is
verifiable from a plain shell — before any restart, and without DSH at all.

## Verified live (no restart)

The plugin's row was mounted by hot-editing the profile's user patch layer, and
`workspace_create` then executed against the real registry, producing
`id 1dcf3c9d-b68a-4de4-9481-512b87f12117` for the `virtuoso-layout` directory —
persisted in `~/.dsh/storages/workspace.json`. Provenance was checked, not
assumed: the shipped `workspace_create` is a zod-validated **RPC method** in
`dsh-api-workspace-controller` (`workspaceId`/`workspace` result), and the phrase
in the *tool* description exists only in this repo.

Two limits of that lever, learned the hard way:

- **HMR watches the patch file, not the module.** Editing `lib/index.js` changes
  nothing; only a patch-layer change that the loader recomposes is picked up. A
  cache-busted URL (`…/lib/index.js?v=2`) does **not** force a re-import — the row
  keeps its original module instance, so new tools in that module never appear.
  A restart is the reliable way to load new code.
- **`Config.listConfigs` is not an activation indicator.** Rows inserted at the
  root carry no include-prefixed patch id, so this plugin never appears there even
  while active. Use `Tool.listTools` instead.

## Tools

| Tool | State | Notes |
|---|---|---|
| `workspace_create` | verified live | Registers a workspace; idempotent per path. |
| `virtuoso_status` | verified live | Four layers: VM, guest sshd, **tunnel**, CIW. `deep:false` skips the probes. |
| `virtuoso_config` | verified live | `show`/`set`/`unset` over a JSON settings file; applied on the next call, no restart. |
| `virtuoso_vm` | verified live | `status`/`start`/`up`/`stop`/`down`. `up` is the one-call bring-up through to a proven CIW. |
| `virtuoso_recover` | verified live | Tunnel, then screensaver, then modals — re-proving health after every step. |
| `virtuoso_windows` | verified live | SKILL titles (authoritative) plus X11 ids (dismissable). |
| `virtuoso_screenshot` | verified live | PNG to the artifact dir; returns path/exists/bytes. Verify it with `.validate/image-census.py` — `read_image` needs a model that accepts image input, which `deepseek-flash` does not. |
| `virtuoso_eval` | verified live | SKILL over `eval --stdin`; inline or from a `.il` file. **A call that would write requires a confirmation token bound to its arguments** — see below. |
| `virtuoso_run` | verified live | Long guest command as a background job, with a synchronous fallback. The job is a real DSH job: `job_output` reads the guest's stdout, `job_list` shows it settle. Same argument-bound write confirmation. |
| `virtuoso_drc` | verified live | Structures Calibre `*.drc.summary` / `*.drc.results`; `compareWith` **fails loudly** on disagreement. |
| `context_usage` | verified live | **Not a layout tool.** Reports this session's own token budget from the harness token meter: used, window, percent, pressure band, baseline, largest contributors. Read-only; answers "how close am I to compaction" before a big read instead of after. First live call: `46,055 of 512,000 tokens (9%, low)`, resolved through `exec.agent` — the first identity channel, so the `agents.currentInitiator()` fallback was never needed. |

[`../TOOLS.md`](../TOOLS.md) is the model-facing reference: every tool with its arguments, its
returned shape, and the hint attached to each recognised failure. It is **generated** from the
live definitions by `.validate/gen-tools-doc.mjs`, so it cannot drift — re-run that script after
changing a description, parameter or output schema.

Failures are diagnosed in one place. `hintFor`/`withHint` map the raw signatures
(`ECONNREFUSED`, socket timeout, `error while loading file`, `ENOENT`, SSH auth,
`not lossless JSON`) onto a `Hint:` naming the next action, and `registerSafely` applies that to
every tool's `execute`, so a tool added later cannot forget it. `virtuoso_eval` additionally
returns `errorKind`/`errorText`/`hint` instead of the raw errset payload, and `virtuoso_drc`
lists the Calibre result files that *do* exist in the directory when a path is wrong. Covered by
`node .validate/hint-test.mjs` and `node .validate/tool-error-test.mjs`.

### A write needs a confirmation token bound to its arguments (`lib/guard.js`)

`dbSave` persists over a cellview the human may have open, `ddCreateLib` claims a library name for
the whole Virtuoso session, and `virtuoso_run` reaches the entire guest filesystem. So one guard
(`ctx.tools.guard()`) watches `virtuoso_eval` and `virtuoso_run` and, when the call would write,
**denies it before execution** and returns a confirmation token in the reason:

```text
virtuoso-layout write gate: BLOCKED before execution — this SKILL call writes (dbSave) and this
session is not in danger-full-access mode (mode: workspace-write). Nothing ran and nothing was
written. Next: to approve this exact write, re-issue the same call with confirm: "1f3c9ad2". …
```

The token is a SHA-256 digest of the payload, so it is **stateless** and bound to *that* call's
arguments: re-issuing an identical call yields the **same** token and replays harmlessly, while any
edit to the SKILL or the command yields a new one and asks again. There is **no use-once
invalidation** — the gate answers "are these the arguments you were shown?", not "has this token
been spent?". `confirm: true` is deliberately not accepted; it would be a rubber stamp.
Read-only work is never gated (`dbOpenCellViewByType(… "r")`, `cv~>shapes`, `sleep; echo`), and
`2>&1`/`>=` are not treated as writes, so probing stays frictionless.

**In `danger-full-access` the gate abstains entirely.** That mode has already granted blanket write
permission, so the confirmation is skipped — the human's setting decides, not the model's. Anywhere
else it is enforced, and it **fails closed**: an unreadable sandbox policy, or a guard that throws
while classifying, denies the call with an explicit reason instead of waving it through.

`approval.request()` exists in the same runtime and is deliberately unused: it needs an open turn and
the session's approval policy, and a session with approvals disabled rejects requests automatically —
wiring writes to it would break the very mode the gate is meant to stay out of the way in.

`virtuoso_status` carries `writeGuard` (`installed`, `defaultMode`, `sessionMode`, `enforcedByDefault`,
`enforcedNow`, `summary`), because a gate nobody can observe is indistinguishable from no gate.
Not yet gated, by choice: `virtuoso_vm` (start/stop) and `virtuoso_config set/unset` — explicit,
single-target, and reversible by the same tool. Covered by `node .validate/guard-test.mjs`.

Offline harness: `node .validate/plugin-test.mjs` (register against a mock ctx, then
call each tool). It passes, including 273 violations on real Calibre output and a
cross-validation mismatch that correctly raises. Registration is defensive — each
tool is wrapped, so one bad definition degrades that tool rather than failing the row.

`node .validate/context-test.mjs` covers the one tool that reads host services through
`ctx.get()` (`context_usage`) with a mock ctx that owns `get()`: 50 checks over the
present, absent and fallback identity channels, a provider that declares no window, a
throwing `requestContext()`, the pressure-band edges, and the lossless-JSON rule. It
skipped a real bug that way — the band was compared against the unrounded ratio, so
`149999/200000` printed "75%" next to the word `moderate`.

`node .validate/job-test.mjs` covers `virtuoso_run`'s settled job payload. That payload is
built by `jobOutcome()` in `lib/virtuoso.js` rather than inside the tool closure, precisely
so it can be tested without a live ssh. The assertion that matters is negative: the payload
must not contain the streamed bytes. Eight checks, including a source guard that fails if the
stdout copy is ever added back.

`node .validate/guard-test.mjs` tests the write gate at all three layers a gate can be wrong at:
classification (does the payload look like a write, inline and from a `file:`), policy (denied in
`workspace-write`, abstaining in `danger-full-access`, closed on an unreadable policy), and
registration (`apply()` installs exactly one guard). 69 checks.

## Activation

The bundle is installed in the `desktop` profile, so the row is declared by
`dsh.profile.bundles` and needs **one restart**:

```powershell
# after restart, expect exactly one row and these three tools
node --input-type=module -e "const m=await import('file:///.../dsh-plugin-virtuoso-layout/lib/index.js'); console.log(Object.keys(m))"
```

Wrong patch shape is the failure to watch for: a bundle adding its **own** row must
use `insert:`; an id targeted at a non-existent row only warns and is dropped.
`dsh-plugin-virtuoso-layout/cordis.patch.yml` is correct and validated by
`--dump-config` (1 row, 0 warnings).

Note `plugin_manager install_bundle` **copies** the package into
`~/.dsh/profiles/desktop/node_modules`, so after editing the source you must
re-copy (or re-install) before a restart, or the profile keeps running stale code.


## Two failure modes already burned here — do not repeat them

**1. A bundle adding its own row must use `insert:`.** A bundle's patch layer is a list of
`@deepseek-ai/cordis-plugin-include` `PatchOptions`, and the two shapes fail *silently* when mixed
up:

```yaml
- id: existing-row        # id-targeted OVERRIDE of a row that already exists.
  config: {...}           # A fresh id matches nothing -> "patch: entry X not found" -> dropped.

- insert: [...]           # NEW rows. This is the shape a bundle needs.
```

Verified in `cordis-plugin-include/lib/index.js`: `if (insert)` is a separate branch, and an
`insert` carrying its own top-level `id` means "push into *that group's* config", not "append".
Omitting the top-level `id` is what appends at the top level.

**2. `plugin_manager install_bundle` COPIES the package — it does not link it.** After installing,
`~/.dsh/profiles/desktop/node_modules/dsh-plugin-virtuoso-layout` is a plain directory with no
`LinkType`/`Target`. **Editing this source directory therefore has no effect on the runtime until
you re-install or copy the files across.** (An earlier claim in this repo that it was a link was
wrong.)

## Validating a patch change without restarting DSH

Bundle patch layers are composed once at profile boot (`loadProfile`), and `patchReload: "live"`
covers only the profile's own user layer. `plugin_manager set_bundle` on/off does **not**
recompose them. So a patch edit needs a restart — but the *composition* can be checked first with a
throwaway `DSH_HOME`:

```powershell
$val = '<repo>/virtuoso-layout/.validate'
$env:DSH_HOME = $val
node '<HOME>\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js' --profile desktop --dump-config
```

`.validate/profiles/desktop/` holds a minimal manifest whose `bundles` list names this package, plus
a junction to the live profile's `node_modules` so the bundle resolves. A correct run prints a
section headed `# == dsh-plugin-virtuoso-layout` containing the `file://` URL of `lib/index.js`. A
wrong patch shape instead prints `patch: entry "virtuoso-layout" not found`.

## What is here

| Path | Role |
|---|---|
| `lib/index.js` | The plugin: registers all 12 tools and installs the write gate. Imports the other four modules; no external dependency. |
| `lib/virtuoso.js` | The VM/bridge implementation: config, ssh, tunnel, jobs, and the shared `Hint:` layer. |
| `lib/drc.js` | Calibre DRC result parsing and cross-validation. |
| `lib/guard.js` | The write gate: what counts as a write, the argument-bound token, the policy. |
| `lib/host.js` | Host (Windows) window enumeration / raise / capture, for `host_window`. |
| `lib/host-window.ps1` | The PowerShell payload `host.js` drives: user32 P/Invoke + `System.Drawing`. |
| `cordis.patch.yml` | The bundle's patch layer: exactly one `insert` row. |
| `package.json` | Declares `dsh.bundle.patch`, and **no dependencies at all**. |

## Why this bundle has zero dependencies

The running desktop runtime is **0.2.0-rc.2**, while the only readable published packages are
**0.1.2-rc.1**. Any `@deepseek-ai/*` range this bundle declared (`^0.1.2-rc.1`) would fail to
resolve against the live runtime, and incompatible DSH peers block installation outright.

So this plugin imports nothing. That is possible because the tool contract is **plain data plus a
function**:

```ts
interface ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
interface ToolDefinition extends ToolSchema {
  readonly output: ToolOutputDefinition          // { schema: JsonSchemaNode; render(...) }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
}
```


`defineTool` from `@deepseek-ai/dsh-tools` is a convenience wrapper that normalizes an authoring
DSL into this shape; it is not a requirement. Two consequences to respect if you edit this file:

- `parameters` must be **raw JSON Schema** (object-level `required: [...]`), not the DSL that uses
  `required: true` inside each property. The live registry stores raw JSON Schema — verify with
  `cordis_inspect_query host Tool listTools`.
- `output.schema` is typed `JsonSchemaNode`, i.e. also raw JSON Schema.

## Why `workspace_create` exists

`@deepseek-ai/dsh-workspace` is host-side only. Its own README:

> The package is host-side only: the model, tools, and agent loop never see it, so it adds no
> tokens, prompts, or request context.

The only production caller of `ctx.workspaceRegistry.create(path, title?)` is the Web UI's
directory-picker flow. Writing `~/.dsh/storages/workspace.json` directly is not a workaround: the
registry keeps an in-memory entity cache, there is a `pendingMutation` guard against partial
writes, and the `workspace-invariant` companion declares that a bypassing write path **fails the
invariant**. So a plugin tool is the sanctioned way to give the model this capability.

## Install / verify

Installed with (this wrote the profile, not this directory):

```
plugin_manager install_bundle
  target: file:C:/Users/HP/Documents/deepseek-harness/default-workspace/virtuoso-layout/dsh-plugin-virtuoso-layout
```

Result: pnpm exit 0, package linked into `<DSH_HOME>\profiles\desktop\node_modules\`, and
`dsh-plugin-virtuoso-layout` appended to `dsh.profile.bundles`.

**The bundle rows are read at profile boot, so the row does not mount live** — confirmed by
`listConfigs` returning `total: 0` and `workspace_create` being absent from `listTools`
immediately after a successful install. A DSH restart is required.

Because the profile links this directory rather than copying it, editing `lib/index.js` and
restarting is enough to iterate; no reinstall.

After restart, verify with:

```
cordis_inspect_query host Config listConfigs  {"name": "dsh-plugin-virtuoso-layout"}
cordis_inspect_query host Tool  listTools
```

Profile backups taken before installing (restore if the profile stops booting):

- `<DSH_HOME>\profiles\desktop\package.json.bak-20261016-221514`
- `<DSH_HOME>\profiles\desktop\cordis.patch.yml.bak-20261016-221514`

To uninstall: `plugin_manager remove_bundle`, target `dsh-plugin-virtuoso-layout`.

## Stage 2 (delivered) — operational rules that cost real time to learn

**Readiness has four layers, and the third one is a trap.** Observed live: the VM was running,
sshd answered, Virtuoso held five live pids, and the guest daemon was listening on
`0.0.0.0:65452` — yet every SKILL call failed with `Connection refused to 127.0.0.1:65453`,
because `virtuoso-bridge start`'s `ssh -N -L` forward was simply gone. The tunnel is opened **per
CLI invocation** and torn down on exit; there is no persistent listener between commands. So a
closed socket on the tunnel port means "no tunnel right now", never "Virtuoso is down", and
`virtuoso_status` reports the layer separately for exactly this reason. `virtuoso_recover` and
`virtuoso_status --deep` call `ensureTunnel()` first, because a missing tunnel otherwise sends
diagnosis down the wrong path (this README previously mis-described that very failure as a wedged
CIW).

**Suspend the screensaver before any XTEST work.** The bridge dismisses dialogs with XTEST, which
delivers keys to whatever holds the X input focus. An active `gnome-screensaver` holds it, so every
`dismiss-*` call still printed `Dismissed: 0x…` while the modal never closed. Rule:
`gnome-screensaver-command -d` (plus `xset s off; xset -dpms`) before dismissal — built into
`guestPrep()`, which every VM-lifecycle and recovery path runs.

**Guest commands must avoid `"` and `#`.** Remote commands reach a shell that re-parses them: `"`
is lost in the argv tail, and `#` starts a comment that silently swallows the rest of the line.

**`eval --stdin` is the only robust SKILL channel.** An inline argv expression is re-quoted by the
host shell and split by the CRT's argv parser (`unrecognized arguments:`); stdin survives arbitrary
SKILL, auto-wrapped in `progn`.

**The bridge CLI writes chatter to stdout.** `using .env: …`, `[cmd] …` and `tunnel.warm = …` all
land on stdout *ahead of* the JSON, so `JSON.parse(stdout)` fails with `Unexpected token 'u',
"using .env"` — which reads like a broken bridge. `parseBridgeJson()` strips those lines first.

**The daemon needs a half-close, and does not always use its delimiter.** The daemon reads until
EOF, so a request without `socket.end()` leaves it blocked in `recv`; because its accept loop is
sequential, every later connection is then silently dropped. It may also answer without the `0x15`
delimiter and close instead (observed: `\x02` + `2`), so a close *with* bytes in hand counts as a
complete response.

**X11 titles are unreliable here.** There is no window manager publishing `WM_NAME`, so
`list-windows` returns fragments like `": ("`. Titles come from the SKILL window list; the X11 list
is used only for dismissable ids.

### Settings: why a file and a tool, not a settings page

`settings.section` and `settings.plugins.tab` are **client** slots. A page there needs a browser
half: `dsh.client` in `package.json`, a built bundle at `exports["./client"]`, and the DSH dev
checkout (`pnpm run dev:web`) to rebuild it — and `plugin_manager install_bundle` copies the package,
so a source edit would not reach the running client. On top of that, this row is inserted at the
patch root and carries no include-prefixed patch id, so `Config.listConfigs` never lists it (see the
activation note above): the built-in Plugins page would not surface it even with a `Config` export.

So the settings surface is host-side and live: `virtuoso_config` reads and writes
`~/.dsh/virtuoso-layout.json` (override with `DSH_VIRTUOSO_CONFIG`; a tree-level
`virtuoso.config.json` also works, user file wins). `loadConfig()` re-reads the overlay on **every**
call, so a change applies to the very next tool call with no restart. `show` reports each setting,
the path in force, and which values differ from the built-in defaults. This solves the actual
complaint — reconfiguring at every startup — without reopening the dependency question: the package
still has **no dependencies**, which is what lets it install at all against a `0.2.0-rc.2` runtime
whose published peers are all `0.1.2-rc.1`.

### Still open

- `virtuoso_run`'s job path is **verified live** (`sleep 20; echo JOBDONE`: `mode: job`, `jobId`
  `bash-1`, then `job_output` returned the guest's own stdout and `job_list` showed
  `bash-1 [bash] completed`). That probe found a real defect: a finished job printed its output
  **twice**, because the job streamed every stdout chunk *and* the settled payload copied all of
  stdout into `result`. A stderr probe (`echo OUT-ONLY; echo ERR-ONLY 1>&2` → OUT-ONLY,
  `[stderr]` ERR-ONLY, OUT-ONLY) proved the duplicate was `result`, not a double `append`.
  Fixed in `jobOutcome()`, pinned by `.validate/job-test.mjs`. The same probe after the 2026-10-17
  restart came back with `OUT-ONLY` and `[stderr] ERR-ONLY` **once each** — the fix is live.
- A guest command's job is registered with `kind: 'bash'`, since `JobKindMap` admits only `bash`
  and `subagent`.
- ~~`ctx.tools.guard()` forcing confirmation on mutating SKILL (`dbSave`/`dbCreate*`) is not done.~~
  **Done** (`lib/guard.js`, see "A write needs a confirmation token bound to its arguments"):
  one global guard over `virtuoso_eval` and `virtuoso_run`, a payload-digest token, and a
  deliberate abstention in `danger-full-access`.
  What remains open is the scope decision: `virtuoso_vm` and `virtuoso_config set/unset` are still
  ungated, with a plan to keep it that way unless the human asks.
- `lib/virtuoso.js`, `lib/drc.js` and the new `lib/guard.js` must be re-copied into the profile after
  any edit (see the activation note).

## Creating a layout library in SKILL — the recipe, and six traps

Verified end to end on this machine: a new library `DSH_LAYOUT` at `<GUEST_HOME>/DSH_LAYOUT` with its
technology bound to `VB_DEMO`, cell `dsh_demo`, five shapes over four layers, saved and read back
(`made=5 saved=t shapes=5`). The recipe is short; getting to it was not.

```skill
lib = ddCreateLib("DSH_LAYOUT" "<GUEST_HOME>/DSH_LAYOUT")   ; 2nd arg = the LIBRARY directory
techBindTechFile(lib "VB_DEMO")                            ; 2nd arg = a TECHNOLOGY LIBRARY NAME
techGetTechLibName(lib) == "VB_DEMO"                       ; verify exactly this way
cv = dbOpenCellViewByType("DSH_LAYOUT" "dsh_demo" "layout" "maskLayout" "a")
dbCreateRect(cv list("Metal1" "drawing") list(list(0 8) list(40 12)))
dbSave(cv)
```

This is not guesswork — it is what the bridge itself does in
`virtuoso_bridge/virtuoso/library/management.py`, which is worth reading before inventing a library
API here.

**1. `techBindTechFile` takes a technology *library name*, not a techfile path.** Given a path it
does not raise; it returns non-nil and `techGetTechFile()` reports a bound techfile, so the mistake
looks like success — while *every* `dbCreateRect` afterwards fails, even with a real LPP object
borrowed from a known-good cell. Bind by name, and check `techGetTechLibName(lib)`.

**2. `ddCreateLib(name, path)`: the second argument is the library directory.** Passing a techfile
path there returns a recycled handle and registers nothing — the name never appears in
`ddGetLibList()`. Check the list, not the return value.

**3. `ddCreateLib` returns a handle even when it fails**, so `car(errset(...))` is not a success
test. `ddGetObj(name)` afterwards is.

**4. `rm -rf` on a library directory wedges that name for the whole session.** The stale in-memory
entry squats it: `ddCreateLib` then hands back the dead handle, `ddGetObj` returns nil, and
`ddDeleteObj` does **not** unregister it (it returns nil and the name stays in `ddGetLibList()`).
There is no in-session recovery — use a fresh name, or restart Virtuoso. Do not delete library
directories while Virtuoso is running.

**5. `errset(x t)` returns `(value)` or nil, and never the message.** The documented
`(value message)` pair does not survive here, so `errset` cannot diagnose anything. Worse, an
*uncaught* error during `load` is reported at **end-of-file**: three different failures all blamed
the last line of the file, which sent me hunting a syntax error that did not exist. When a SKILL
load error blames your last line, suspect a runtime error, not a paren.

**6. Windows PowerShell 5.1 strips `"` from arguments to native commands.** `eval $skill` silently
turns `ddGetObj("VB_DEMO")` into `ddGetObj(VB_DEMO)`, and the guest then echoes the mangled program
back as a string — which reads as a bridge fault. This is why `eval --file <path.il>` exists: the
program is read from disk and sent over stdin, never through argv. Anything containing a string
literal belongs in a file.

## What this plugin has actually produced (2026-10-17)

The plugin is not just plumbing: it drew a real transistor on a real process and verified it with
the foundry's own tools.

`DSH_NMOS/dsh_nmos15` — a single NMOS on **SMIC 0.18 µm (`smic18ee`)**, with a four-sided P+ guard
ring, 38 shapes, bbox 3.72 × 4.51 µm. Produced entirely through `virtuoso_eval`.

| Check | Result |
|---|---|
| **DRC** (Calibre v2015.2, 393 checks) | **6 violations, all density rules** (`PD.*`, `MIM_8a`) — zero geometry violations |
| **LVS** | **CORRECT** — `N=4 EP=4 FDC=1`, `M0 S G D B <model> L=1.8e-07 W=1.2e-06` |
| Convergence | 22 → 24 → **35** → 36 → 18 → 16 → 13 → 7 → 6 |

The 35 is worth remembering: *enlarging* the device made DRC worse, because moving an edge changes
which rules bind. From that point the geometry came from `.validate/solve-*.py` — scripts that state
each rule as a constraint, solve, and verify their own answer before printing coordinates — rather
than from tuning.

Also settled along the way:
- SKILL's `streamOut` is unusable (returns nil silently for every calling form; `procedurep`/`getd`
  cannot detect it because they report nil even for `geOpen`). GDS comes from the **`strmout` binary**
  with `-translateUnmappedLPP`.
- `LVS SOFT SUBSTRATE PINS` must be YES or the substrate node stays internal and no label can make it
  a port; port text belongs on `M1/drawing` (the layer map has no `M1 pin`).
- A guard ring must be verified to *have a hole* — a solid bar is also one connected component, and
  only a screenshot revealed that the "ring" was filled in.

**Not done, and stated so it is not mistaken for finished:** PEX (the foundry's xRC deck is written
for Calibre v2009.3 and this machine has v2015.2, whose Interactive runset parser rejects it — see
`PEX-STATUS.md`), density rules (impossible on an isolated device), `SLOT_*`/`GR_*` checks (need large
metal / are poly-resistor rules), multi-finger and common-centroid matching.

The full working set — scripts, decks, results, and the record of every wrong turn — is in the
`virtuoso-layout` repository, not here.

