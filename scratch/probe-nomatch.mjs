import { listHostWindows, captureHostWindow } from "../dsh-plugin-virtuoso-layout/lib/host.js"
const noMatch = await captureHostWindow({ match: "VMware", output: "C:/Users/HP/Documents/deepseek-harness/default-workspace/virtuoso-layout/artifacts/probe-nomatch.png" })
console.log("ok:", noMatch.ok, "| error:", noMatch.error)
console.log("available:", JSON.stringify(noMatch.available ?? []))
