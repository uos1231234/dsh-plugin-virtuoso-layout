import { listHostWindows } from "../dsh-plugin-virtuoso-layout/lib/host.js"
const list = await listHostWindows()
console.log("ok:", list.ok, "count:", list.count, "total:", list.total)
for (const w of (list.windows ?? []).slice(0, 12)) console.log("  ", w.pid, JSON.stringify(w.title).slice(0,60), JSON.stringify(w.class), w.rect.w + "x" + w.rect.h)
