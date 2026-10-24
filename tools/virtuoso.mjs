#!/usr/bin/env node
/**
 * virtuoso.mjs — standalone CLI, wired to the plugin's single implementation.
 *
 * This file used to be a hand-maintained near-copy of
 * `dsh-plugin-virtuoso-layout/lib/virtuoso.js`. Two copies of VM/bridge logic
 * drift, and the copy that drifts silently is always the one the CLI uses, so the
 * duplicate is gone: everything below delegates to the plugin's library, and the
 * only thing this shim owns is being runnable from a plain shell — before any DSH
 * restart, and without DSH at all.
 *
 * Zero dependencies (Node builtins only), which is what makes it usable as the
 * plugin's test harness: every helper the plugin relies on can be exercised here
 * first.
 *
 * Run as a CLI:
 *   node tools/virtuoso.mjs config|config-show|config-set|config-unset
 *   node tools/virtuoso.mjs vm-status|vm-start|vm-stop
 *   node tools/virtuoso.mjs guest-ready [timeoutMs]|prep|health|recover
 *   node tools/virtuoso.mjs ssh <command...>
 *   node tools/virtuoso.mjs virtuoso-running|bridge-status|windows
 *   node tools/virtuoso.mjs screenshot [target]
 *   node tools/virtuoso.mjs eval <skill expression>
 *
 * All named exports are re-exported, so a one-off script can import this path
 * instead of reaching into the package directory.
 */
export * from '../dsh-plugin-virtuoso-layout/lib/virtuoso.js'

import { main } from '../dsh-plugin-virtuoso-layout/lib/virtuoso.js'

// `main` is the same switch the library exposes, so the CLI surface cannot fall
// behind the library surface.
process.exit(await main(process.argv.slice(2)))
