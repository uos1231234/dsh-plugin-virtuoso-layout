# Layout tool reference

Generated from the live plugin definitions by `.validate/gen-tools-doc.mjs` — 12 tools, do not edit by hand. Re-run the script after changing a description, parameter or output schema.

Every tool returns lossless JSON. Failures are either thrown (bad arguments, missing files) or returned as `ok: false` (operational results such as a failed SKILL program), and every recognised failure carries a `Hint:` naming the next action — see the last section.

## At a glance

| Tool | What it does | Changes |
| --- | --- | --- |
| `workspace_create` | Register a DeepSeek Harness workspace for an existing directory, so it appears in the sidebar project list. | no |
| `virtuoso_status` | Report whether the IC layout toolchain is usable, as four independent layers: the VMware VM, the guest sshd, the host-side SSH tunnel to the bridge daemon, and the CIW answering SKILL. | no |
| `virtuoso_config` | Read or change the layout toolchain settings: VM path, vmrun path, guest IP, ssh user/port, bridge repo, artifact directory, tunnel ports, default screenshot target. | host file |
| `virtuoso_vm` | Bring the layout toolchain up or down. | yes |
| `virtuoso_recover` | Put the guest GUI back into a usable state and PROVE it with a real SKILL evaluation. | guest GUI |
| `virtuoso_windows` | List what Virtuoso has open. | no |
| `virtuoso_screenshot` | Screenshot one Virtuoso window and copy the PNG back to this machine, returning its path, byte size, and whether the file really exists and is non-empty. | host file |
| `host_window` | Enumerate, raise or capture top-level windows on the HOST Windows desktop — the VMware Workstation console that shows the same VM these tools drive, and anything else you need to show a human. | host file |
| `virtuoso_eval` | Evaluate a SKILL program in the guest CIW and return the parsed result (status, output, errors, warnings). | yes |
| `virtuoso_run` | Run a long shell command inside the guest as a background job and return immediately with a job id. | yes |
| `virtuoso_drc` | Parse a Calibre DRC result file into structured JSON: total violations, failing checks with counts, descriptions, and NOT EXECUTED checks. | no |
| `context_usage` | Report how full this session`s context window is, from the harness token meter: tokens used, the window size when the provider declares one, the fixed baseline cost, and the largest contributing messages. | no |

## Tools in detail

### `workspace_create`

Register a DeepSeek Harness workspace for an existing directory, so it appears in the sidebar project list. Passing a path that already has a workspace returns that workspace unchanged. A path that does not exist, or that is a file rather than a directory, is rejected. The workspace registry is otherwise invisible to the model, so this is the only model-reachable way to add one.

- Effect: Registers a directory in the sidebar; touches the workspace registry only.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes | Absolute path to an existing directory. |
| `title` | string | no | Optional display title; defaults to the directory name. |

- Returns: `path`, `id`, `title` (always present: `path`)

### `virtuoso_status`

Report whether the IC layout toolchain is usable, as four independent layers: the VMware VM, the guest sshd, the host-side SSH tunnel to the bridge daemon, and the CIW answering SKILL. Read-only and safe to call at any time; call it FIRST whenever a layout operation fails, because a missing tunnel, a dead guest and a blocked CIW all look identical from the caller`s side. The tunnel layer matters most: it is created per bridge invocation, so it is routinely absent while the VM and Virtuoso are perfectly healthy. The report also carries `writeGuard`, which says whether the plugin`s write gate is armed and whether THIS session would have to confirm a mutating SKILL or shell call.

- Effect: Read-only. Always the first call after any layout failure.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `deep` | boolean | no | Also probe the CIW (1+1 over the tunnel), the Virtuoso pids, the screensaver and the open windows. Adds a few seconds. Defaults to true when the guest is reachable. |

- Returns: `summary`, `vm`, `guest`, `tunnel`, `health`, `virtuoso`, `screensaver`, `windows`, `config`, `writeGuard` (always present: `summary`, `vm`, `guest`, `tunnel`)

### `virtuoso_config`

Read or change the layout toolchain settings: VM path, vmrun path, guest IP, ssh user/port, bridge repo, artifact directory, tunnel ports, default screenshot target. Values persist in a JSON file under the DSH home and are applied on the very next call — no restart, no rebuild. Use `show` first; it reports every setting, which path is in force, and which values you have overridden.

- Effect: Writes ~/.dsh/virtuoso-layout.json; applied on the next call, no restart.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `action` | enum(show, set, unset) | no | show (default): read settings. set: write the given keys. unset: return keys to defaults. |
| `settings` | object | no | For set: the keys to write. Known keys: vmrun, vmx, guestIp, sshUser, sshPort, bridgeRepo, artifactDir, localPort, daemonPort, daemonHost, screenshotTarget, manageScreensaver. |
| `keys` | array | no | For unset: the keys to remove from the overlay, returning them to their defaults. |

- Returns: `action`, `activePath`, `writablePath`, `overridden`, `effective`, `written`, `removed`, `error` (always present: `action`)

### `virtuoso_vm`

Bring the layout toolchain up or down. `up` is the one-call repair: start the VM if needed, wait for sshd, suspend the guest screensaver, open the bridge SSH tunnel, then prove the CIW answers. `status` reports the three host-visible layers without changing anything. `start` and `stop` touch only the VM. `down` stops the VM (soft).

- Effect: start/up/down change VM power state. `up` is the one-call repair.
- Timeout: 600000 ms

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `action` | enum(status, up, start, stop, down) | no | Defaults to status. |
| `gui` | boolean | no | For start/up: show the VMware console window. Defaults to false. |
| `timeoutMs` | number | no | Budget for waiting on the guest to finish booting, in ms. Defaults to 300000 (5 min). |

- Returns: `action`, `ok`, `summary`, `vm`, `guest`, `tunnel`, `screensaver`, `health`, `steps` (always present: `action`, `ok`)

### `virtuoso_recover`

Put the guest GUI back into a usable state and PROVE it with a real SKILL evaluation. Run this when SKILL calls stop answering or report a socket timeout. It repairs in dependency order: open the bridge tunnel if it is missing, suspend the screensaver, then dismiss blocking modal dialogs, re-checking after every action. The screensaver step is not cosmetic: an active screensaver holds the X input focus, so XTEST-based dialog dismissal reports success while delivering keys to the screensaver, and the modal stays up forever.

- Effect: Suspends the screensaver and dismisses dialogs, then proves the CIW answers.
- Timeout: 420000 ms

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `attempts` | number | no | Dialog-dismissal rounds before falling back to per-window keys. Defaults to 2. |

- Returns: `ok`, `recovered`, `steps`, `health` (always present: `ok`, `steps`)

### `virtuoso_windows`

List what Virtuoso has open. Reports the SKILL window list (authoritative titles, e.g. "Layout Suite L Editing: LIB CELL layout") and the X11 window list (the ids that virtuoso_recover can dismiss). Use this before reaching for screenshots, to know which targets exist.

- Effect: Read-only window census.
- Arguments: none

- Returns: `titles`, `raw`, `x11`, `count` (always present: `titles`)

### `virtuoso_screenshot`

Screenshot one Virtuoso window and copy the PNG back to this machine, returning its path, byte size, and whether the file really exists and is non-empty. This is how layout work becomes visible. `target` accepts ciw, current, a view name (layout, schematic, maestro) or a window number, and defaults to the configured screenshotTarget. Returns { ok, target, path, exists, bytes, hint }. To actually look at the result, pass the path to the read_image tool — that works only when the running model accepts image input, so when it reports that the model does not declare image input, verify the render programmatically with `python .validate/image-census.py <path>` (size, background, and a saturated-pixel census per layer colour) and hand the file to the human, who can see it.

- Effect: Writes one PNG into the configured artifact directory.
- Timeout: 240000 ms

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `target` | string | no | Defaults to the configured screenshotTarget (layout). |
| `name` | string | no | Optional file name; defaults to <target>-<timestamp>.png. |

- Returns: `ok`, `target`, `path`, `exists`, `bytes`, `hint`, `stderr` (always present: `ok`, `path`)

### `host_window`

Enumerate, raise or capture top-level windows on the HOST Windows desktop — the VMware Workstation console that shows the same VM these tools drive, and anything else you need to show a human. This is the "show me" counterpart to virtuoso_screenshot, which can only see inside the guest. Actions: `list` (visible titled windows with pid, title, class, rect), `info` (the best-matching window rect and minimised/maximised state), `raise` (restore or maximise and bring to front), `capture` (raise, then copy the window to a PNG and report its byte size and sha256). Matching is by `match` (substring of title or class, case-insensitive on the PowerShell side via -like) or `pid`. When nothing matches, the result is ok:false with the candidate windows listed, so a miss is diagnosable rather than silent. A capture under 1024 bytes is reported as a failure, because that is a blank image, not a picture of the window. Windows only; on other platforms it returns ok:false instead of throwing.

- Effect: raise/capture may move or resize a Windows window and write one PNG. `list` is read-only. This is the host desktop, not the guest: use virtuoso_screenshot for Virtuoso content.
- Timeout: 120000 ms

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `action` | enum(list, info, raise, capture) | no | Defaults to list. |
| `match` | string | no | Substring of the window title or class, e.g. "VMware" or "RHEL6". |
| `pid` | number | no | Match one process id instead of a title substring. |
| `mode` | enum(focus, maximize, restore) | no | For raise/capture: how to present the window. Defaults to focus (raise only). |
| `name` | string | no | For capture: file name only (resolved against the configured artifact directory), e.g. "vmware-now.png". Absolute paths are rejected. |

- Returns: `ok`, `action`, `count`, `total`, `windows`, `pid`, `title`, `class`, `rect`, `path`, `bytes`, `sha256`, `candidates`, `available`, `error`, `hint` (always present: `ok`, `action`)

### `virtuoso_eval`

Evaluate a SKILL program in the guest CIW and return the parsed result (status, output, errors, warnings). The program is shipped over stdin, which is the only channel that survives arbitrary SKILL: `(progn ...)` wraps it and the value of the last form is returned. Use this to draw geometry (dbCreateRect), query the design database (geGetEditCellView, cv~>shapes) or drive the layout editor. Pass `skill` inline, or `file` to read a .il file from this machine. Prefer a guest-side file when the program is long.

- Effect: Runs arbitrary SKILL: it can create, modify and DELETE design data.
- Timeout: 300000 ms

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `skill` | string | no | SKILL source to evaluate. Multiple statements are fine. |
| `file` | string | no | Absolute path to a .il file to send instead of `skill`. |
| `confirm` | string | no | Only for a call that would WRITE (dbCreate*, dbSave, dbDelete*, ddCreateLib, techBindTechFile…): the confirmation token bound to this exact payload, which the write gate returned. Not needed for read-only SKILL, and not needed at all in danger-full-access mode. |
| `timeoutSec` | number | no | SKILL timeout in seconds. Defaults to 60. |

- Returns: `ok`, `status`, `output`, `errors`, `warnings`, `errorKind`, `errorText`, `hint`, `executionMs`, `elapsedMs`, `timedOut`, `command` (always present: `ok`)

### `virtuoso_run`

Run a long shell command inside the guest as a background job and return immediately with a job id. Read it with the job_output tool. Use this for anything slow — Calibre DRC, extraction, batch SKILL — so the conversation is not blocked and the output is not lost. When the job registry is unavailable the command runs synchronously instead and says so in the result.

- Effect: Runs an arbitrary guest shell command, normally in the background.
- Timeout: 3600000 ms

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `command` | string | yes | Shell command to run in the guest. |
| `label` | string | no | Short label for the job list. Defaults to the command. |
| `timeoutMs` | number | no | Wall-clock budget in ms. Defaults to 3600000 (1 hour). |
| `background` | boolean | no | Set false to force synchronous execution. Defaults to true. |
| `confirm` | string | no | Only for a command that would WRITE in the guest (a `>`/`>>` redirection, or rm/mv/cp/mkdir/touch/chmod/tee/sed -i): the confirmation token bound to this exact command, which the write gate returned. Not needed for read-only commands, and not needed at all in danger-full-access mode. |

- Returns: `mode`, `jobId`, `label`, `ok`, `code`, `stdout`, `stderr`, `detail`, `hint` (always present: `mode`)

### `virtuoso_drc`

Parse a Calibre DRC result file into structured JSON: total violations, failing checks with counts, descriptions, and NOT EXECUTED checks. Accepts either `*.drc.summary` (the DRC-H summary report) or `*.drc.results` (the ASCII results database) and detects which by filename. Use this instead of reading the raw file, which is hundreds of padded lines. Pass both files from the same run to cross-validate them against each other.

- Effect: Parses an existing Calibre result file; runs no tool.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `path` | string | yes | Absolute path to a *.drc.summary or *.drc.results file. |
| `compareWith` | string | no | Optional sibling file from the same run; the two are reconciled per check and disagreement is reported. |
| `verbose` | boolean | no | Include every check, not just the failing ones. Defaults to false. |

- Returns: `path`, `kind`, `cell`, `ruleFile`, `totals`, `failing`, `warnings`, `checks`, `comparison` (always present: `path`, `totals`)

### `context_usage`

Report how full this session`s context window is, from the harness token meter: tokens used, the window size when the provider declares one, the fixed baseline cost, and the largest contributing messages. Read-only, no model call, no guest access. Call it BEFORE reading a large file or dumping a whole registry, and again when a compaction notice appears, so the remaining budget is a number instead of a surprise. This is a DeepSeek Harness measurement, not a layout operation: it lives in this bundle only because this is the installed host plugin.

- Effect: Read-only, and a DSH measurement rather than a layout one: it reports this session`s token budget from the harness token meter and never touches the VM.

| Argument | Type | Required | Meaning |
| --- | --- | --- | --- |
| `top` | integer | no | How many of the largest contributing messages to list, 1-25. Defaults to 8. |
| `full` | boolean | no | Also return the raw TokenMeasurement (logRevision, baseline, surfaceTokens, surfaceDeltaTokens, nodes). Defaults to false, which keeps the result small. |

- Returns: `ok`, `summary`, `source`, `sessionId`, `provider`, `model`, `contextWindow`, `used`, `remaining`, `percent`, `pressure`, `baselineKind`, `baselineTokens`, `surfaceTokens`, `contributors`, `detail`, `hint`, `measurement` (always present: `ok`, `summary`)

## Failure feedback

Failures are diagnosed centrally, so every tool reports them the same way and the operational knowledge does not depend on the caller remembering a runbook. A thrown error gains a final `Hint:` line; a returned failure gains `errorKind`, `errorText` and `hint` fields.

| Signature in the raw failure | Hint attached |
| --- | --- |
| `ECONNREFUSED` | The bridge tunnel is not listening on its local port. |
| socket timeout / no answer | The CIW stopped answering. |
| `error while loading file` | SKILL failed while loading the program. |
| `ENOENT` / no such file | The path does not exist on the machine that read it. |
| SSH auth failure | SSH authentication to the guest failed. |
| `not lossless JSON` | The tool produced a value the harness cannot serialise — one undefined-valued property is enough. |

A DRC parse failure additionally lists the Calibre result files that *do* exist in the same directory, so a mistyped path is recoverable from the error itself.
