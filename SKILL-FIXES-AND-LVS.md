# SKILL 修正、DRC 收敛过程、LVS 通过

2026-10-17。三件事的结果，含全部失败过程。

---

## 一、SKILL 的问题：三个真错误，全部来自我自己

用户判断「可能是 SKILL 包表现不够好」。结论：**不是包的问题，是我三个方法错误。**

### 错误 1：用 `procedurep` / `getd` 探测函数是否存在 —— 全都无效

现象：`procedurep("streamOut")` 返回 `nil`，我据此断定"函数不存在"。但同一时刻
`procedurep("geOpen")` **也返回 `nil`**，而 `geOpen` 明明可用。

根因：IC6.1.7 上这两个探测函数对**编译进程序的内建函数**一律返回 `nil`（上游
`virtuoso-bridge-lite` 的 AGENTS.md 里就写着这条警告，我没当回事）。
更糟的是 `errset`：它把"函数不存在"和"函数拒绝执行"压成同一个 `nil`。
**调用失败 = nil** 这个假设，让整条诊断链失效了六轮。

### 错误 2：`streamOut` 不是 SKILL 入口，是 GUI 包装

查 Cadence 官方文档 `doc/sktransrefOA/sktransrefOA.pdf`（Design Data Translator's
SKILL Reference, IC6.1.7）：

```skill
xstSetField("strmFile" "out.gds")
xstSetField("library" "lib1")
xstOutDoTranslate()
```

文档明确写 **"Value Returned: nil"** —— 它**永远**返回 nil，因为它是非阻塞的
"发起"函数。nil 表示"已发起"，**不是失败**。我一直把正常返回读成失败。

### 错误 3：`xstSetField("topCell" ...)` 不生效，会静默导出整库

实测：设 `topCell = THIS_CELL_DOES_NOT_EXIST`，仍然生成了 GDS，里面是 `DSH_NMOS`
（库名）而没有 cell 名。日志却声称 "Translating cellView DSH_NMOS/dsh_nmos4/layout"。

**后果**：`nmos4.gds` 里装的是 `dsh_nmos2`，而 Calibre 报
`Specified primary cell dsh_nmos4 is not located within the input layout database`。
我用 DRC 白跑了一轮，原因只是 GDS 里根本不是那个 cell。

**结论**：GDS 导出用 `strmout` 二进制（`/opt/IC617/tools/dfII/bin/strmout`），
它 `-topCell` 准确、日志可信、0 错误。SKILL 的 XStream 路径适合交互，不适合脚本。

### 顺带：两个 SKILL 语言陷阱

| 陷阱 | 症状 | 正确写法 |
|---|---|---|
| **前缀算术不可用** | `(- 3.0 0.18)` 失败，报 `load ... at line N`（N 是 wrapper 末尾，指不到错误） | **中缀**：`a - 0.18`、`x + 0.18` |
| **列表取第 5 项** | `car(cdddr(r))` 返回的是**第 4 项**（x1），不是第 5 项 | `car(cddddr(r))` 才是 y1 |

第二个错误让每个矩形变成 `y1 = x1`：AA 画成 `(0.47 0.00)-(1.93 1.93)` 而不是
`(1.93 1.20)`，bbx 比预期高一截。**画对了坐标但取错了下标，看上去像"工艺问题"。**

---

## 二、DRC 收敛：22 → 13，八轮

| 版本 | 违规 | 做法 | 结果 |
|---|---|---|---|
| `dsh_nmos` | **22** | 手工坐标 | 不对称 |
| `dsh_nmos2` | **24** | 参数化镜像 | 对称了，DRC 反而 +2 |
| `dsh_nmos4` | **35** | 放大 AA 到 2.6×1.4 | **恶化**：新触发 GP_11a(8) M1_3&4(5) |
| `dsh_nmos5` | **36** | 按规则手算 | 更糟，且踩中前缀算术陷阱 |
| `dsh_nmos6` | **18** | 写求解器 `solve-nmos.py` | 减半 |
| `dsh_nmos7` | **16** | 求解器 + 数值解 M1_2 | |
| `dsh_nmos8` | **13** | 求解器 + GP_6/SP 规则 | ← **当前最好** |

### 核心教训：调参是错的方法

`dsh_nmos4` 那轮最关键：**把器件改大，DRC 从 24 变成 35。** 因为移动一条边会改变
哪条规则生效。闭集线性约束不该靠试。所以从 nmos6 起改成 `.validate/solve-nmos.py`：
把规则写成约束、求解、**求解器自己先验证**，再输出坐标。

求解器救了我两次：
- 算出 `M1_2`（<rv>）与"金属包住接触孔"（<rv>）**互相冲突**，除非金属只向**外侧**
  扩展。真实版图就是这么做的：金属在栅极那侧只给 0.08 线端余量。
- 算出 `M1_2` 实际要求 **AA 半宽 ≥ <rv>**，而不是我推的 <rv>（漏了 CT 项）。

### nmos8 剩下的 13 个

| 类别 | 数量 | 判断 |
|---|---|---|
| `PD.GTa/CGb/GPa/M1/M2/M3` | **6** | **密度规则**：GT 最小 <rv>、GP 最小 <rv>、M1/M2/M3 最小 <rv>、CG 最大 <rv>。一个 2×2.68 µm 的孤岛管子**不可能**满足。全芯片级约束，单管上属预期噪声 |
| `MIM_8a` | 1 | deck 里描述为空，含义未查清 |
| `SN_7_17` | 2 | SN 到栅包边 0.32（我给的是 0.35 间距，是另一个方向） |
| `SP_10&11` | 1 | P+ 拾取区规则，需要重排 tap |
| `SP_16` | 1 | 新增，未查 |
| `M1_6` | 1 | 某个 M1 面积仍 < 0.20 |
| `Convention_BAD_IMP` | 1 | 有 AA 无注入（tap 的 SP 没盖全） |

**真正待修 6 个**，且全部集中在 tap（衬底接触）那一块 —— 我把它当附属品随手放的，
而真实版图里 tap 有一整套独立规则。

**诚实结论：DRC 没有清零。** 从 22 降到 13，其中 6 个是单管无法满足的密度噪声，
6 个是 tap 结构没按规则设计。要清零需要**专门设计 tap 环**，那是下一步。

---

## 三、LVS：通过了

```
LVS completed. CORRECT. See report file: /tmp/lvs/dsh_nmos3.lvs.rep

             Layout    Source
Ports:            4 / 4
Nets:             4 / 4
Instances:        1 / 1     MN(<model>)
Unmatched:        0 / 0
```

Calibre 从版图**提取**出的网表：

```
.SUBCKT dsh_nmos3 D B G S
M0 S G D B <model> L=1.8e-07 W=1.2e-06
```

与手写网表完全一致。**器件识别正确**（`<model>`，L=0.18 µm），**四个端口全匹配**。

### LVS 需要什么（第一次跑缺的）

1. **SOURCE 网表**（`.cdl`）。`DSH_NMOS` 里没有原理图，所以手写了一个。这反而更有价值：
   LVS 检验的是"版图提取出的拓扑 == 我声称的电路"。
2. **端口标签**。LVS 第一次报 `4 missing port` 而 nets 全匹配，因为**端口是 label 不是矩形**——
   必须在 `M1 pin` 层画文字，且落在对应网络金属内。
3. **W 值写对**。第一次我猜 `w=2u`，LVS 报 `w: 1.2u vs 2u (40%)`。**1.2u 是 Calibre
   从我的 AA 量出来的**，不是猜的。改成 1.2u 后通过。

### LVS deck 的入口

```
smic18ee_IC617/calibre/lvs/SmicSP12R_<rev>.lvs
```

器件声明（决定网表怎么写）：
```
DEVICE MN(<model>) ngate18 gppoly(G) nsdpw(S) nsdpw(D) pwell(B)
```

---

## 四、顺带修掉的环境 bug

`virtuoso_vm up` 报 `Could not request local forwarding`。**不是端口冲突**：
**65453 落在 Windows 保留区间 `65407–65506`**（Hyper-V/WSL 预留），
`bind [127.0.0.1]:65453: Permission denied`。
已迁到 **62111**（`~/.virtuoso-bridge/.env` + 插件 `localPort`）。

---

## 五、复现

```bash
# 求解器（先验证约束再输出坐标）
python .validate/solve-nmos.py

# 画图（SKILL，中缀算术）
virtuoso_eval file=scratch/drc/draw-nmos8.il

# GDS（必须用 strmout，不是 SKILL streamOut）
bash scratch/drc/drc8.sh        # 导出 + DRC 一条龙

# 解析
python .validate/drc-detail.py artifacts/drc/nmos8.drc.results

# LVS
bash scratch/drc/run-lvs.sh
```

产物：`artifacts/drc/nmos{2,4,5,6,7,8}.drc.results`、`dsh_nmos3.lvs.rep`。

## 六、还没做

- **DRC 未清零**（13 个，6 个是密度噪声，6 个是 tap）
- 没有 guard ring（`GR_*` 34 项因此 NOT EXECUTED）
- 没有阱（NW/PW 完全没画）—— `<model>` 的器件定义里有 `pwell(B)`
- 未跑 PEX / 寄生提取
- 未做多指/共质心匹配
- `MIM_8a` 与 `SP_16` 的含义未查清
