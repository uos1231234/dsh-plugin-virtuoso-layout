import { captureHostWindow, listHostWindows } from "../dsh-plugin-virtuoso-layout/lib/host.js"
const list = await listHostWindows({ pattern: "DeepSeek" })
console.log("match DeepSeek:", list.ok, JSON.stringify(list.windows?.map(w=>w.title)))
const cap = await captureHostWindow({ match: "DeepSeek", output: "C:/Users/HP/Documents/deepseek-harness/default-workspace/virtuoso-layout/artifacts/probe-dsh-window.png", mode: "focus" })
console.log("capture ok:", cap.ok, "| title:", cap.title, "| bytes:", cap.bytes, "| sha:", (cap.sha256??"").slice(0,16))
console.log("rect:", JSON.stringify(cap.rect))
