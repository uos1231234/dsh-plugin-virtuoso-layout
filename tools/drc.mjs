#!/usr/bin/env node
// The standalone CLI and DSH both use the bundle's report parser.
export * from '../dsh-plugin-virtuoso-layout/lib/drc.js'
import { main } from '../dsh-plugin-virtuoso-layout/lib/drc.js'
process.exitCode = await main(process.argv.slice(2))
