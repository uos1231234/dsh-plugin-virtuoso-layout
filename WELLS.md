# 加入阱：两个实验、一个被纠正的判断

2026-10-17。用户要求「加入阱试试」。结果：**阱加上了，DRC 仍 7 个（零几何违规），
LVS 仍 CORRECT**，但**我上一轮关于"缺阱"的判断被证伪了一半**。

![dsh_nmos12：上为 N 阱 + N+ 拾取，下为 NMOS + tap](artifacts/nmos12-final.png)

---

## 一、最关键的事实：`PW` 不是画出来的层

上一轮我在 `NMOS-FINAL.md` 里写：

> ⚠️ 这块版图**没有阱**。`<model>` 的 LVS 定义里是 `pwell(B)`，但几何上 PW 层一个都没有。

**这个判断是错的。** deck 第 438 行写着：

```
PWO = ((BULK NOT NWi) NOT PBi) NOT DNWi
PW  = PWO NOT EXCLU
```

**P 阱是由 deck 计算出来的**——"不是 N 阱的部分就是 P 阱"。它从来不需要画。

### 实验 1：往 `PW` 上画一个框，看它是否进入 GDS

`dsh_nmos10` = nmos9 + 一个 `PW` 框 + 一个 `NW` 框。结果：

```
LAYER NWi ...... TOTAL Original Geometry Count = 1 (1)     ← NW 进去了
LAYER PWIi ..... TOTAL Original Geometry Count = 0 (0)     ← PW 被丢弃
```

层映射表里只有 **`PWI`（GDS 81）**，没有 `PW`。我画在 `PW` 上的东西在 stream-out 时
**静默消失**。

**结论**：`PW` 是派生层，不可画。上一轮"缺阱"的结论对 P 阱而言是**误判**。

---

## 二、`NW` 可以画，但必须带 N+ 拾取

实验 1 加上 NW 后，违规从 7 变成 8，多的那一条：

```
Convention_FLT_NW:  NW without N+ pick up
  NW NOT INTERACT NTAPi
```

**N 阱必须与 N+ 拾取区（NTAP）相交**，否则报错。

### 实验 2：NW + AA + SN + 接触孔

`dsh_nmos11` = nmos9 + NW + 阱内 AA/SN/CT/M1。结果：`Convention_FLT_NW` **消失**，
但新出现两条可修问题：

| 规则 | 原因 |
|---|---|
| `NW_3` | 与最高电源电位**不相连**的 NW 区域，**两个维度**都要满足最小尺寸（表达式形如 `INT < 2.1`）。我画的是 1.70 × 2.20 |
| `M1_6` | 拾取金属 0.42 × 0.42 = 0.176 < 0.20 |

`NW_3` 那条的 `NOT NET (... ?VDD? ?VCC?)` 值得注意：**若 NW 接到 VDD/VCC，此规则不适用**。
我的结构没有接电源，所以必须满足 2.10。

---

## 三、最终：`dsh_nmos12`

用 `.validate/solve-nwell.py` 求解后重画：

| 层 | 坐标 | 依据 |
|---|---|---|
| `NW` | `0.30 2.60 → 2.40 4.70` | `NW_3`：两维都 <rv> |
| `AA` | `0.54 2.84 → 2.16 4.46` | 阱内，留 `SN_OV+0.06` 边距 |
| `SN` | `0.36 2.66 → 2.34 4.64` | `SN_9`：超出 AA <rv> |
| `CT` | `1.24 3.54 → 1.46 3.76` | 居中，AA 包边 0.70 |
| `M1` | `1.10 3.40 → 1.60 3.90` | `M1_6`：<rv> µm² |

### 结果

```
DRC:  393 检查, 7 违规
      = 6 × PD.*（密度，单管无法满足）+ 1 × MIM_8a（deck 描述为空）
      → 零几何违规
LVS:  CORRECT
```

---

## 四、又一个被证伪的判断：加阱**不会**减少 NOT EXECUTED

上一轮我写：

> 下一步如果继续，最有价值的是加 NW/PW 阱 —— 那会让 34 项 `NOT EXECUTED` 真正执行

**这也是错的。** 实测：

```
nmos9  (无 NW):  NOT EXECUTED = 34,  执行 393
nmos12 (有 NW):  NOT EXECUTED = 34,  执行 393
```

`NW_1` / `NW_2a` / `NW_2b` / `NW_3` / `NWE_1..5` 这些检查**在没有 NW 时就已经在执行**
（结果为 0），加阱并没有"激活"它们。

### 34 项到底是什么

| 类别 | 数量 | 前提 |
|---|---|---|
| `SLOT_*` | **23** | 金属开槽——只在金属面积很大时适用 |
| `GR_*` | **9** | guard ring——需要专门画环形结构 |
| `MIM_*` | 2 | MIM 电容 |

**与阱完全无关。** 要让它们执行，需要的是 **guard ring** 和大块金属，不是阱。

---

## 五、所以现在这块版图的真实状态

**已达成**
- 几何 DRC 零违规（除 6 条密度 + 1 条空规则）
- LVS CORRECT：`MN(<model>)`，L=0.18 µm，W=1.2 µm
- **有 N 阱，且带 N+ 拾取**（`Convention_FLT_NW` 通过）
- P 阱隐式存在（deck 派生）

**仍未达成**
- **没有 guard ring** → 9 项 `GR_*` 仍未执行
- 23 项 `SLOT_*` 需要大块金属才适用
- 6 条密度规则单管无法满足
- 未跑 PEX
- 未做多指/共质心

**重要修正**：上一轮说"缺阱会让真实流片失败"——**对 P 阱不成立**（派生层），
**对 N 阱成立**（现已补上）。但**缺 guard ring 仍然是真实缺陷**：衬底噪声、闩锁效应
都需要它。

---

## 六、这两轮我犯了什么错，值得记下来

| 判断 | 实际 | 教训 |
|---|---|---|
| "版图没有阱" | P 阱是**派生层**，从来不需要画 | **先查层是画的还是算的**，再看几何 |
| "加阱会让 34 项 NOT EXECUTED 执行" | 数量不变，那些是 SLOT/GR/MIM | 判断 NOT EXECUTED 的原因要**看清单**，不要推测 |
| `hiZoomAbsoluteScale(0.06)` 会放大 | 值越小越缩小，0.9 是默认 | 参数方向要验证，不要假设 |
| 取"最后一个" window id 是最新的 | id 顺序不等于创建顺序 | 用**内容大小**判别，而不是顺序 |

两次错误都属于同一类：**把"合理的推测"当成"已验证的事实"**。这个项目里
凡是这么干的都错了，凡是实测的都对了。

---

## 七、复现

```bash
python .validate/solve-nwell.py          # 阱 + 拾取的约束求解
virtuoso_eval file=scratch/drc/draw-nmos12.il
bash scratch/drc/drc12.sh                # DRC -> 7（零几何）
bash scratch/drc/lvs12.sh                # LVS -> CORRECT
bash scratch/guest/shot_best.sh          # 截图（按内容大小选窗口）
```

实验单元保留在库里，可供复核：`dsh_nmos10`（PW 被丢弃的证据）、
`dsh_nmos11`（NW 单独触发 FLT_NW）。
