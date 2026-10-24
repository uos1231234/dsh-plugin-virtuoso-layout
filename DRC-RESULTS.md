# Calibre DRC 实跑结果

2026-10-17。答"我们能不能做 DRC"：**能，已经跑通了，而且跑的是真的 SMIC 规则手册。**

## 结论

| | dsh_nmos（手工坐标） | dsh_nmos2（参数化） |
|---|---|---|
| 执行规则 | 393 | 393 |
| **违规总数** | **22** | **24** |
| 失败检查 | 14 | 15 |
| 未执行 | 34 | 34 |

**参数化版违规反而多了 2 个。** 原因是修对称性时把 M1 拉宽了，导致两条 M1 之间的间距掉到
`M1_2` 的下限以下（<<rv> µm，2 处）；同时原来的 3 个 `M1_6`（M1 面积 <<rv> µm²）消失了。
净效果 +2。

**这是这一轮最重要的诚实结论**：我的几何审计（26 项全过）**和真实 DRC 不是一回事**。
审计证明的是"我写得对"，DRC 证明的是"工艺能造"。前者通过不保证后者。

## 环境：全部现成，不需要装任何东西

| 件 | 位置 | 状态 |
|---|---|---|
| Calibre | `/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin/calibre` | v2015.2_36.27，**不在 PATH 上**，必须显式加 |
| 许可证 | `/opt/calibre2015/license.dat` | 有效至 **2099-12-31** |
| 规则手册 | `smic18ee_IC617/calibre/drc/*.drc` | 4 个变体（p2mt3/4/5/6）。本次用 `p2mt3` |
| 层映射 | `smic18ee_IC617/stream/strmoutMap` | 必须显式传，否则不导出 |
| 技术库 | `smic18ee` | 已绑定到 `DSH_NMOS` |

## 三条踩出来的路

### 1. SKILL 的 `streamOut` 不可用，必须用 `strmout` 二进制

`streamOut(cv path)` 在**每一种调用形式下都静默返回 `nil`**，`CDS.log` 里**一条记录都没有**。
试过 2 参数、3 参数、`?mapFile`、`?hierDepth`、换目录——全 `nil`。

诊断过程本身值得记：`procedurep("streamOut")` 和 `getd('streamOut)` **对 `geOpen` 也返回 nil**，
所以这两个探测函数在 IC6.1.7 上对编译进程序的内建函数**完全无效**。
`errset` 更糟——它把"函数不存在"和"函数拒绝执行"变成同一个 `nil`。

**正确做法**：绕开 SKILL，用命令行
`/opt/IC617/tools/dfII/bin/strmout`。一次成功，18 个矩形，0 错误 8 警告。

```bash
strmout -library DSH_NMOS -strmFile out.gds -strmVersion 3 \
  -topCell dsh_nmos2 -view layout -techLib smic18ee \
  -layerMap ".../stream/strmoutMap" -translateUnmappedLPP
```

`-translateUnmappedLPP` 不能省：SN/SP 的某些 purpose 不在 map 文件里，
不加这个标志那些矩形会被**静默丢弃**，DRC 会因为"没东西可查"而通过——**通过得毫无意义**。

### 2. `-runset` 只属于 `calibre -gui`，批处理要改规则文件本体

```
calibre -drc ... -runset runset.drc deck.drc     # 被拒绝，打印用法
```

批处理模式只接受 `<rule_file_name>`。所以把占位符**原地替换**：

```bash
sed -i -e 's|^LAYOUT PATH "xxx.gds"|LAYOUT PATH "/tmp/drc/dsh_nmos2.gds"|' \
       -e 's|^LAYOUT PRIMARY "\*"|LAYOUT PRIMARY "dsh_nmos2"|' \
       -e 's|^DRC RESULTS DATABASE "drc_cal.out" ASCII|...|' \
       -e 's|^DRC SUMMARY REPORT "drc_cal.sum"|...|' effective.drc
```

**不能追加**（我第一次就是这么干的）：Calibre 把这些当**单值语句**而不是"后者覆盖"，
追加会得到 `Error SPC1 ... superfluous specification statement: layout primary`。

**也不能用 `INCLUDE`**：这个 deck 是 2004 版 Calibre 写的，2015 版报
`SYN1 unrecognized operation`。原地替换是唯一稳的。

规则手册本身**一字节没改**，改的是副本。

### 3. 只执行了 393 / 427 项

34 项 `NOT EXECUTED`，主要是 `GR_*`（guard ring）和 `SLOT_*`（金属开槽）。
这两类规则的前提（guard ring、大面积金属）在这个 2×2.68 µm 的单管里根本不成立，
deck 自己跳过了，不是错误。

另有 2 条运行时警告（无 `VDD`/`VCC` 网络数据）——单管没有电源网，正常。

## 24 个违规逐条

| 检查 | 数量 | 规则 | 性质 |
|---|---|---|---|
| `CT_6a` | 4 | AA 包住 AA 接触孔 ≥ X µm | 真问题：孔贴边太紧 |
| `M1_6` | 3 | M1 最小面积 0.20 µm² | 真问题：金属块太小 |
| `M1_2` | 2 | M1 间距 ≥ X µm | **修对称引入的新问题** |
| `GP_7` | 2 | 场氧多晶到 AA 间距 ≥0.10 | 真问题 |
| `SN_7_17` | 2 | SN 到 N 沟道栅包住 0.32 / 间距 0.35 | 真问题：注入层没按栅拉长 |
| `CT_7a` | 2 | GP 包住栅接触孔 ≥0.10 | 真问题：pad 太小 |
| `SN_9` | 1 | SN 超出有源区 ≥0.18 | 真问题：我用了 0.10 |
| `CT_4a` | 1 | 栅接触孔到 AA 间距 ≥0.20 | 真问题 |
| `MIM_8a` | 1 | （deck 里描述为空） | 待查 |
| `PD.GTa/CGb/GPa/M1/M2/M3` | 6 | **密度规则** | 见下 |

**6 条是密度规则**（`PD.*`）：GT 最小 <rv>、GP 最小 <rv>、M1/M2/M3 最小 <rv>、CG 最大 <rv>。
一个 2×2.68 µm 的孤岛管子**不可能**满足任何面积密度规则——那是全芯片/大区块层面的约束。
这 6 条在单管上属于**预期内噪声**，不是设计缺陷。

所以真正需要修的是**其余 18 条**，其中 9 条（`CT_6a` 4 + `M1_6` 3 + `M1_2` 2）都指向同一个根因：
**接触孔和金属的画法没有按工艺最小尺寸反推，而是按"看起来居中"摆的。**

## 复现方式

```bash
# 完整流程：OA -> GDS -> Calibre -> 解析
bash scratch/drc/run-calibre.sh          # dsh_nmos2
bash scratch/drc/run-original.sh         # dsh_nmos（对照）
```

产物：`artifacts/drc/{dsh_nmos,dsh_nmos2}.drc.{results,summary}`。

解析用现成的两个工具：

```powershell
virtuoso_drc artifacts/drc/dsh_nmos2.drc.summary --compareWith ...results   # 交叉校验
python .validate/drc-detail.py artifacts/drc/dsh_nmos2.drc.results          # 规则原文+坐标
```

`virtuoso_drc` 的 `compareWith` 会核对 summary 和 results 两份文件，
本次两边都是 24，`agreement: true`——所以"24"这个数字不是从一份可能过期的报告里读出来的。

## 还没做的

- **没跑 LVS**。deck 旁边就有 `calibre/lvs`，但 LVS 需要原理图网表对得上，
  而 `DSH_NMOS` 里没有原理图。所以"版图对不对"目前只到 DRC 层面。
- **没跑 PEX / 寄生提取**。
- **密度规则无法在单管上满足**，需要放到有足够周边填充的语境里才谈得上。
- `MIM_8a` 的描述在 deck 里是空的，含义未查清。
