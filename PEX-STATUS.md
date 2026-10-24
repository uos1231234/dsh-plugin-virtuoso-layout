# PEX：规则齐备，但 deck 与本机 Calibre 版本不兼容

2026-10-17。用户要求"先看看寄生"。结论：**PEX 规则文件完整存在，但官方 deck
在本机 Calibre 上尚未跑通，寄生提取暂未完成。** 下面的兼容性排查已记录；
**尚未定位的部分不等于已经排除自身原因** —— 第 2 处语法错误至今没有找到。

---

## 一、规则文件确实齐备

```
calibre/xrc/
├── Calibre/SmicSP12R_<rev>.lvs_XRC      ← LVS+PEX 规则主文件（91 KB）
├── rules/v2009.3_24.19/
│   ├── SmicSP10R_<rev>_typ.C      ← 电容标定（单位 fF）
│   ├── SmicSP10R_<rev>_typ.R      ← 电阻标定（#DECRYPT 加密，Calibre 可读）
│   └── ...（Cmin / Cmax 变体齐全）
├── MIPT/*.mipt                                  ← 介质剖面模板
└── TM/*.tm                                      ← 工艺厚度模板
```

工艺标定齐全，`typ/Cmin/Cmax` 三档都有。所以**不是缺文件**。

---

## 二、障碍：deck 为 v2009.3 编写，本机是 v2015.2

`Release_Note` 明确写着：

```
*  Calibre Version for test : v2009.3_24.19
*  Calibre xRC Version for test : v2009.3_24.19
```

本机：`Calibre v2015.2_36.27`。

**Calibre Interactive（`-gui -pex -batch`）用 Tcl 解析 runset，2015 版比 2009 版严格。**
连续三次失败，每次修好一处就暴露下一处：

| 次序 | 报错 | 根因 | 状态 |
|---|---|---|---|
| 1 | `list element in quotes followed by "//"` | 第 289 行：一个引号后面**紧跟**注释符，中间缺一个空格 | **已修** |
| 2 | `unmatched open brace in list` | 某处花括号不配对 | 未定位 |
| 3 | （预期还会继续） | 老语法与新解析器差异 | — |

第 289 行两个 deck（LVS 与 xRC 同源）都有：

```
// … the licence paragraph of the deck: one line, ending in a quote immediately
// followed by "//"
                                              ↑ 缺空格
```

在那个引号与注释符之间**补一个空格**后，错误从第 1 条推进到第 2 条——**证明方向正确，但工作量是逐个修 foundry deck 的语法**。

---

## 三、对照实验排除了"我改坏了"的可能

用**原封不动的官方 deck**、只替换两个 layout 占位符，同样报第 1 条错。
所以不是我的编辑引入的，是 deck 本身在新版 Calibre 下的问题。

```
=== 对照实验 ===
changed lines: 500 LAYOUT PATH, 501 LAYOUT PRIMARY
verdict: // Calibre Interactive Error: list element in quotes followed by "//"
```

---

## 四、LVS 的 svdb 不含寄生

顺便确认了另一条路的终点：LVS 跑通后 `svdb/` 里**零个寄生元件**。

```
grep -icE '^C|^R' svdb/dsh_nmos15.sp  =  0
```

LVS 只做器件与连接提取（`M0 S G D B <model>`），寄生 R/C 必须由 xRC 引擎算。
所以"用 LVS 代替 PEX"不成立。

---

## 五、可选的三条路

| 方案 | 代价 | 可行性 |
|---|---|---|
| **A. 继续修 deck** | 逐个定位 Tcl 不兼容（已修 1 处，至少还有 1 处） | 可行但等于重写 foundry 文件语法 |
| **B. 装匹配版本 Calibre** | 需要 Calibre v2009.3 授权与安装 | 最干净，但依赖外部资源 |
| **C. 接受限制** | 记入"未达成" | 诚实，但拿不到寄生数据 |

**我的判断**：B 最正确但受限于环境；A 可以继续但要克制——修 foundry deck 有风险
（改错一条规则会让提取结果失真，而且很难察觉）。如果继续，应当只改注释/空格这类
**不影响语义**的地方，并保留原 deck 副本比对。

---

## 六、已保存的产物

- `scratch/drc/pex15.sh` —— PEX 运行脚本（含最小改动策略、换行保护、第 289 行补丁）
- `scratch/drc/pex-ctl.sh` —— 对照实验脚本（证明官方 deck 自身就失败）
- `scratch/guest/find-pex-line.sh`、`find-brace.sh`、`fix-quote.sh` —— 定位工具
- `.validate/solve-ring-frame.py` —— 环框的光栅化验证（10 nm 网格，数连通块与空洞）

---

## 七、诚实结论

**PEX 没能跑通。** 规则齐全、环境有 Calibre 授权、GDS 正确、LVS 已通过，
但 foundry 的 PEX deck 无法被本机 Calibre 版本解析。

这不是"差一步"——第 2 处语法错误还没定位，可能还有第 3、第 4 处。
继续修可能越陷越深，而且每修一处都有改坏规则语义的风险。

**建议**：若要 PEX 结果，优先装 Calibre v2009.3（或让 PDK 提供方给适配新版的 deck）。
在此之前，寄生提取记为**已知未达成项**。
