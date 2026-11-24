---
name: virtuoso-layout
description: 从已保存的 Cadence Virtuoso 原理图生成并验证明确约束的 OA 版图。支持模拟匹配和保护环、Calibre DRC/LVS 与 xRC DSPF、同测试平台的 Spectre 前后仿对比。
---

# Virtuoso 原理图到版图

此技能是操作指南，实际读写和验证由项目中的 `tools/virtuoso.mjs`、Virtuoso bridge、PDK 和验证工具完成。以本次命令的实际输出为准；不要把技能被加载、方案生成、版图写入成功或历史实验结果说成当前设计已通过 DRC/LVS。

从本项目根目录运行下面的命令。项目的 `AGENTS.md` 与 `TOOLS.md` 记录环境和现有工具；需要直接编写其他 Virtuoso SKILL 或调用上游 Python API 时，先查 `virtuoso-bridge-lite/skills/virtuoso/SKILL.md`、其 references 和 examples，核对实际签名，不凭记忆编造 API。不要重启 Virtuoso 或改动用户正在编辑的原理图来恢复连接。

## 输入与约束

- 明确源原理图的库、cell 和视图，以及目标版图的库和 cell。`read` 默认读取已保存的 `schematic` 视图；该 cellview 有未保存修改时命令会报错，不能把窗口状态当成已读取的内容。相关内容尚未保存时如实说明，由用户决定如何处理。不要自行保存或覆盖原理图。
- `plan` 使用的 `placement.json` 要表达实际方案：目标 layout、技术库、每个源实例对应的 PDK layout master 与参数和端子映射、摆放位置和方向、明确的路线、过孔与顶层引脚。目标库须已存在并绑定所选技术库，目标 layout cellview 须不存在；可以与源 schematic 属于同一个 cell。依据真实读取结果、用户约束和对应 PDK 的实际信息制定；不要从器件名字猜 master、参数、端子、网络、坐标或规则。
- 实例参数映射的键是原理图参数名，值是 PDK PCell 参数名；端子映射的键是原理图端子名，值是 PDK master 端子名。将实际存在且需要传递的 W/L/nf/m 等源参数按正确映射交给 PCell，不用自行编造的模型参数替代原理图数值。不能映射或方案缺信息时，报告具体缺口；有依据可补全的方案继续处理，不增加审批环节。
- 参数同类型可直接写目标名。需转换 Cadence 工程数值字符串时，写 `{name, type}`，例如把 `180n` 映射给 `float` 型的 `l`。目标需要单指宽度时，可在数值映射中用 `divideBy` 指明源指数字段，例如 `w: {name: "fw", type: "float", divideBy: "fingers"}`。单实例的 `m=1` 可由实际单实例表达。涉及非单位倍乘时按目标 PDK 的参数语义显式映射。
- 路线和过孔使用读取到的网络；顶层引脚对应读取到的原理图端子。当前实现要求逐一摆放顶层实例并映射其全部端子；原理图中有意悬空的端子保留为 `null`，不凭空接网。每个原理图端口至少指定一个版图引脚；实例需能作为 PDK PCell 写入。当前接口依赖明确的摆放和布线方案，不宣称自动布局、自动布线或支持任意层次化电路。使用站点实际安装的 PDK 与验证配置。

`placement.json` 的主要字段如下；坐标、层、master、过孔定义和映射必须取自本次设计及 PDK。引脚可选 `label`，其 `text` 为对应源端口名、`origin` 位于该引脚 `bbox` 内；标签层和用途根据实际 stream layer map 选取：

| 字段 | 内容 |
| --- | --- |
| `target` | `{lib, cell, view: "layout"}`，目标版图单元 |
| `techLib` | 绑定到目标库的技术库名称 |
| `instances` | 每项为 `{source, master: {lib, cell, view: "layout"}, origin: [x, y], orient, parameterMap, terminalMap}` |
| `routes` | 每项为 `{net, layer, purpose, points: [[x, y], ...], width, style}` |
| `vias` | 每项为 `{net, definition, origin, orient, parameters: [{name, value}]}` |
| `pins` | 每项为 `{term, layer, purpose, bbox: [[x0, y0], [x1, y1]]}`；可选 `label: {layer, purpose, origin, text, justification, orient, font, height}` |
| `rectangles` | 每项为 `{id, net, layer, purpose, bbox: [[x0, y0], [x1, y1]]}`，用于保护环等显式 OA 几何 |

`routes[].style` 使用 Cadence `dbCreatePath` 的样式值，例如 `extendExtend`。确认样式与需要的路径端点延伸一致。

### 模拟版图约束

把设计要求写入 `placement.json` 的可选 `constraints`。`plan` 检查方案，`build` 用保存后重开的 OA 数据检查同一组要求。几何约束、集总电气连接和性能指标分别由回读、Calibre 和仿真提供证据。

- `matchedPairs` 的每项为 `{instances: [左实例, 右实例], axisX, netPairs: [[左网, 右网], ...]}`。列出需要镜像的差分网络。检查 PCell 和参数、实例坐标与方向，以及指定网络走线的层、宽度、路径、长度、过孔及 pin 的镜像关系。
- `guardRings` 的每项为 `{net, inner, outer, layers, contact?, encloses?}`。`layers` 每项是 `{layer, purpose, rectangles: [矩形 ID, ...], inner?, outer?}`。可为包边层单独指定边界。检查矩形并集完整覆盖环带并保留开口。`contact: {definition, minimum}` 检查环带上同网、指定类型的接触数。`encloses` 列出需要落在开口内的实例，OA 回读按实际外框验证。保护环与体端的物理连通仍须看源网表和 Calibre LVS。
- `matchedArrays` 的每项为 `{groups: {A: [实例名, ...], B: [实例名, ...]}, rows: [[按位置排列的实例名, ...], ...], dummies?: [实例名, ...], commonCentroid?: true}`。按从下到上、从左到右列实际交叉阵列。dummy 必须是方案和独立 LVS 源网表里已有的实例。检查单元尺寸、行列顺序和各组单元位置的公共质心。

## 只读查询与修版

- 用 `layout inspect pcell --lib <master-lib> --cell <master-cell>` 读默认 master 的端子、图形层用途、局部边界和参数类型。实际 W/L/指宽不同时，用 `--in-lib <target-lib> --params <params.json>` 求值指定参数。参数输入为 `[{name,type,value}]`，`--params -` 可读 stdin。求值使用未保存的 scratch OA 视图，关闭后释放。坐标属于 master 局部空间，按摆放方向和原点变换后才能用于路线。
- 用 `layout inspect tech --lib <target-lib> --layer <layer> --via <via>` 查该库所绑定的真实工艺。选项可重复。图层清单给出 layer/purpose 和 OA 的 valid 标志；stdVia 的 cut、行列和包边是默认几何。已明确写入方案的过孔参数会覆盖默认值。标签能否被流出仍以站点 layer map 为准。
- 几何 DRC 失败后，将完整的 `virtuoso.layout-verification` JSON 传给 `layout inspect drc [<verify.json>|-]`。可用 `--check <rule>` 和 `--layer <OA-layer>` 重复筛选，`--radius` 以 µm 为单位，`--offset`、`--limit` 用于分页，`--nearest` 用于控制每个标记的候选数。对比标记的多边形或边，以及附近图形的网络、层用途、路线点和宽度、过孔和引脚。候选按包围盒距离排序；这是定位证据，责任图形和修正仍须结合几何并由下一轮 Calibre 验证。查看 `reportedCount`、`markerCount` 及无法定位的记录，确认覆盖范围。修版后可用首版的 verify JSON 再运行 `layout inspect drc`，用 `layoutStamp` 核对首版仍与验证时相同。
- `inspect` 与 `read` 是查询入口，`plan` 仅计算方案。持久写 OA 只用 `build`，目标须是事先不存在且在任务授权范围内的 cellview。每版使用独立方案和输出，把首版及报告留下；严禁删除、改名、覆盖或清空现有 cellview 来重用名字。先保存修正版方案并改为新目标，再依次运行 `plan → build → verify`。只有同轮验证允许时再进行 `extract → simulate`。

## 数据流

发布仓库的 `verify` 与 `extract` 都需要 `--pdk` 指定站点 JSON。使用站点已安装的映射、规则、xRC 标定及工具路径。字段见 `tools/README.md`。运行 `simulate` 时，`bench.json` 应显式写入 `model.file` 与 `model.section`。若 Spectre 不在来宾机 PATH 中，用 `simulator.executable` 指定绝对路径。可选 `simulator.licenseFile` 指定站点许可证文件路径。

1. **读原理图**：`node tools/virtuoso.mjs layout read --lib <source-lib> --cell <source-cell> [--view schematic]`。保存/传递返回的 `virtuoso.schematic` JSON，依据其中真实实例、参数、端子和网络准备方案。源是已保存的 cellview。
2. **生成方案**：`node tools/virtuoso.mjs layout plan --spec <placement.json> [<read.json>|-]`。根据 `read` 的结果和明确方案生成 `virtuoso.layout-plan`；`-` 或省略位置参数从 stdin 读取。方案是后续输入，尚不是已写入的版图。
3. **写入版图**：`node tools/virtuoso.mjs layout build [<plan.json>|-]`。使用对应方案，在目标新建 layout cellview 中写入真实 PDK PCell、OA nets/pins 和约定的几何；命令会复核读取标记，并在保存后重开读取。将 `virtuoso.layout-build` 记录交给验证阶段。查看构建与重读结果，不能把写入成功等同于物理连通或 LVS 通过。
4. **同轮 DRC/LVS**：`node tools/virtuoso.mjs layout verify [<build.json>|-] --pdk <profile.json>`。基于该构建记录，对同一次导出的 GDS 执行 DRC 和 LVS，并用独立从源原理图导出的网表作 LVS 参考；检查源、网表和版图摘要与本次构建的对应关系。不要从版图或方案自行生成参考网表冒充独立源网表。 DRC 若报几何违规，用 `layout inspect drc` 查看本轮标记和附近 OA 图形，再按上面的修版流程处理。
5. **提取寄生**。运行 `node tools/virtuoso.mjs layout extract [<verify.json>|-] --pdk <profile.json>`。从该验证记录取得实际金属栈、同一次 GDS 和独立 CDL。按同栈的官方 xRC 规则调用 Calibre 批处理并输出 DSPF。站点配置须指定同栈的 `pexDeck`、`pexCapRules`、`pexResRules` 与 `pexCorner`。默认参考网为 `VSS`。若原理图的参考端口是 `B` 等其他名称，用 `pexGround` 指定真实参考端口。若设计使用全局 `0`，可显式指定 `pexGround: "0"`。LVS 必须为 `CORRECT`。孤立单元的 DRC 密度失败随结果保留，作为工程分析可继续提取。缺同栈标定时报告缺项，禁止把别的金属栈的 DSPF 写成原栈验收证据。
6. **串行前后仿**。运行 `node tools/virtuoso.mjs layout simulate [<extraction.json>|-] --bench <bench.json>`。前仿用独立源网表，后仿由 Spectre 按端口名绑定 DSPF。两个阶段各用独立运行目录和同一共享测试平台、模型角、温度、负载、激励与求解选项。低内存时在同一 VM 依次运行提取和仿真，保留同一覆盖范围和精度。缺许可证、阶段未完成、波形缺失或量测未触发都要明确报告。

机器可读结果的 `kind` 依次为 `virtuoso.schematic`、`virtuoso.layout-plan`、`virtuoso.layout-build`、`virtuoso.layout-verification`、`virtuoso.layout-extraction`、`virtuoso.layout-simulation`。有记录时 JSON 走 stdout，诊断走 stderr。输入或工具异常可能只产出诊断。退出码 `0` 为成功，`1` 为设计约束或检查失败，`2` 为输入或工具错误。逐步核对记录及退出码。

例如，在当前 PowerShell 7 环境可将各阶段 JSON 分别保存，便于检查和复用（将示例名替换成实际源、方案和配置）：

```powershell
node tools/virtuoso.mjs layout read --lib <source-lib> --cell <source-cell> --view schematic > read.json
node tools/virtuoso.mjs layout plan --spec placement.json read.json > plan.json
node tools/virtuoso.mjs layout build plan.json > build.json
node tools/virtuoso.mjs layout verify build.json --pdk profile.json > verify.json
node tools/virtuoso.mjs layout extract verify.json --pdk profile.json > extraction.json
node tools/virtuoso.mjs layout simulate extraction.json --bench bench.json > comparison.json
```

逐行运行并先检查前一行的 `$LASTEXITCODE` 和 JSON；验证返回 `1` 时仍要查看验证结果和报告。不要仅凭合并管道的最终退出码判断各阶段均成功，因为中间命令的退出码可能被掩盖。也可通过 stdin 传递，例如 `Get-Content -Raw -Encoding UTF8 read.json | node tools/virtuoso.mjs layout plan --spec placement.json -`。保持文件和管道为 UTF-8；Windows PowerShell 5.1 的重定向及原生命令管道编码可能不同，避免让非 ASCII 名称或 JSON 编码发生变化。

## Spectre 测试平台

`bench.json` 用 `pins` 将 DUT 的全部原理图端口映射到测试网。`sources` 每项用 `name`、`positive`、`negative` 和 `type` 指定源。`dc` 使用 `volts`，`current` 使用 `amps`，`pulse` 使用 `lowVolts`、`highVolts`、`delaySeconds`、`riseSeconds`、`fallSeconds`、`widthSeconds`、`periodSeconds`。可添加 `capacitors` 或 `resistors`，每项给出名称、两端网络和 `farads` 或 `ohms`。`transient` 提供 `stopSeconds`、`maxStepSeconds` 和 `temperatureC`。`model` 用 `{file, section}` 指定真实工艺模型与模型角。

`measurements` 每项有 `name` 和 `kind`。`min`、`max`、`swing` 使用 `node`，可加 `afterSeconds` 或 `beforeSeconds`。`value` 使用 `node` 和 `atSeconds`。`delay` 使用 `from`、`to` 两个测量端，每端提供 `node`、`edge`、`volts`，可加时间窗口。为两次运行共用同一份指标定义，报告带单位的前值、后值和差值。

## 结果如何交付

报告本次源和目标 cell、实际金属栈与提取角、约束回读、DRC 违规与未执行检查、LVS 结果、DSPF、前后仿波形与指标，以及各原始报告路径。用阶段结果描述已完成和失败的项。将孤立单元的密度问题留到具有真实边界和工艺填充条件的块级或顶层检查。
