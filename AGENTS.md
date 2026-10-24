# AGENTS.md — 项目记忆：用 DSH 插件远程驱动 Virtuoso 画版图

> 这是本工作区的**项目记忆**。DSH 会自动把工作区根目录的 `AGENTS.md` 当作项目指令加载
> （子目录 `virtuoso-bridge-lite\AGENTS.md` 是上游 bridge 仓库的说明，更具体者优先）。
> 本文件用中文维护（用户要求）。最后更新：写操作闸门 `lib/guard.js`（改版图 / 写文件前要一次性
> `confirm` 令牌）**已在真实会话里跑通「拒绝 → 令牌 → 放行」四种情形**（详见 §7）、清掉过期引用、
> 保存 21 号窗口、保留演示库，并按用户批准删掉了旧归档
> `<HOME>\virtuoso-bridge-lite（以后可以考虑删除）`（175.9 MB）；
> 本轮补记 v1 原型 `vblayout\` 的历史定位（§1 末行）与回滚点的**精确文件路径**（§8）。
> **再更新（真实画版图那一轮，2026-10-17）**：① 用 `read_image` **亲眼看过截图**（§2 的
> 「我看不了图」已作废）；② 画出并保存了真库真工艺的 `DSH_NMOS/dsh_nmos`（18 rect，§2）；
> ③ 把「SKILL 通道超时」的**真因**定案为「**由 CIW 求值器发起**的交互命令在等点一下」
> （§3，本轮最有价值；注意“状态栏里有 `Cmd:`”**不等于**卡死，判据是**谁发起的**）；
> ④ 纠正「屏保报 inactive 却截出全黑图」= **DPMS**（§3）；⑤ 自我纠错：把「连上但不回」误判成
> 「65453 有僵死监听」是**错的**（§3）。

## 0. 项目是什么

把「AI 远程驱动 Virtuoso 画版图」封装成 DSH 插件与工具。三层结构：

```
VMware / guest (RHEL 6.5, Virtuoso 6.1.7-64b)     ← 真正画图的地方
        ↑ virtuoso-bridge-lite (CLI v0.8.0 + SKILL daemon)   【Python，第三方开源】
        ↑ dsh-plugin-virtuoso-layout (12 个工具，宿主侧，零依赖)  【Node.js / JS，本项目】
```

### 语言分工（容易混，明确记下来）

| 组件 | 语言 | 运行时 | 说明 |
|---|---|---|---|
| **DSH 插件主体** | **Node.js (ESM)** | DSH 宿主进程 | `lib/{index,virtuoso,drc,guard,host}.js`，**只用 Node 内建模块** |
| 宿主机窗口采集器 | PowerShell | 子进程 | `lib/host-window.ps1`（PS 5.1 + user32 P/Invoke） |
| 验证 / 分析脚本 | **Python** | 独立 CLI | `.validate/*.py`（审计、几何求解、连通性、DRC 解析） |
| **bridge CLI** | **Python** | 子进程 | `virtuoso-bridge-lite`（MIT，作者 Zhishuai Zhang / Xintian Li / Nan Sun / Lu Jie） |

**关键区分**：Python 部分是**被调用的外部工具链**（`virtuoso-bridge.exe`）或**离线分析工具**，
不参与插件运行时。插件本身可以完全不用 Python 就驱动整个 EDA 流程。

插件用 JS 的原因：DSH 是 Electron 应用，插件是跑在宿主机进程里的 Node 模块；
且零外部依赖解决了 peer 版本不匹配（运行时 0.2.0-rc.2 vs 已发布 0.1.2-rc.1）。

### 文档索引

| 文档 | 内容 |
|---|---|
| `AGENTS.md` | 本项目记忆（路径、环境事实、排障、配方） |
| `README.md` | 仓库入口：项目是什么、复现方式、边界 |
| `HISTORY.md` | 项目编年史、Bug 账本、被推翻的判断 |
| `TOOLS.md` | 12 个工具的生成文档（**生成物，勿手改**） |
| `LAYOUT-AUDIT.md` | 手写几何审计 → 发现 DRC 才是权威 |
| `DRC-RESULTS.md` | Calibre DRC 实跑（393 检查、22→13） |
| `SKILL-FIXES-AND-LVS.md` | SKILL 三处方法错误 + LVS 首次通过 |
| `NMOS-FINAL.md` | 器件收敛到 7 个密度违规 |
| `WELLS.md` | 加阱实验（PW 是派生层、NW 需 N+ pickup） |
| `RING-AND-CONNECTIVITY.md` | 连通性实测：8 个孤岛、环只解决 1/3 |
| `RING-CLOSED.md` | 环闭合、LVS CORRECT（6 违规全密度） |
| `PEX-STATUS.md` | **PEX 未达成**：deck 版本不兼容（已知开放项） |

## 1. 关键路径

| 作用 | 路径 |
|---|---|
| 工作区（项目根） | `<REPO>` |
| 插件源码（JS） | `…\dsh-plugin-virtuoso-layout\lib\{index.js,virtuoso.js,drc.js,guard.js,host.js}` |
| 宿主机窗口采集器 | `…\dsh-plugin-virtuoso-layout\lib\host-window.ps1`（PS 5.1，`host_window` 工具用） |
| **DSH 实际加载的副本** | `<DSH_HOME>\profiles\desktop\node_modules\dsh-plugin-virtuoso-layout\` |
| 工具 CLI（JS） | `…\virtuoso-layout\tools\*.mjs` |
| 验证 / 分析（Python） | `…\virtuoso-layout\.validate\*.py`（审计、几何求解、连通性、DRC 解析） |
| 验证 / 测试（JS） | `…\virtuoso-layout\.validate\*-test.mjs`、`gen-tools-doc.mjs` |
| 面向模型的工具文档 | `…\virtuoso-layout\TOOLS.md`（**生成物，勿手改**） |
| DRC/LVS/PEX 脚本 | `…\virtuoso-layout\scratch\drc\*.sh`、`*.il`、`*.cdl` |
| 截图产物 | `…\virtuoso-layout\artifacts\*.png`（含 `drc\*.results`） |
| 画图配方 | `…\virtuoso-layout\scratch\draw-nmos15.il`（**当前最终版**） |
| **历史遗留**（v1 原型，勿扩展） | `…\virtuoso-layout\vblayout\vblayout.py`（2026-10-16 22:19，Python 单文件 CLI 727 行）——它的职责（路径发现 / EDA 报告解析 / VM 控制 / bridge 契约）已全部搬进零依赖的 `lib/*.js` + `tools/*.mjs`；全项目对它**0 处引用**（grep 只命中它自己），最后一次改动早于 `lib/` 的重写（00:25 vs 02:22）。留作历史，不要在上面加功能。 |

- 改完源码**必须**复制到 profiles 副本，且 `lib/*.js` 的改动**要重启 DSH 才生效**
  （HMR 只监听 patch 文件）。`lib/host-window.ps1` 是新文件，同样要一起复制。
- 运行中的 App 会锁住 `package.json`（Copy-Item 报“正由另一进程使用”）；内容已一致，忽略即可。

## 2. 环境事实

- VM 镜像 `RHEL6_WORK.vmx`；guest `192.168.233.128`（用户 `work`）。**系统是 RHEL 6.5，不是 6.10**：
  实测 `uname -a` → `2.6.32-431.el6.x86_64`、`/etc/redhat-release` → `Red Hat Enterprise Linux
  Server release 6.5 (Santiago)`；本文件以前写的 6.10 与实测不符。
- daemon 端口 `65452`，主机侧隧道本地口 **`62111`**（2026-10-17 从 `65453` 迁出）；
  `.env` 在 `<HOME>\.virtuoso-bridge\.env`，插件配置在 `<DSH_HOME>\virtuoso-layout.json`
  （当前 `{"sshPort":22,"localPort":62111}`）。
- **迁移原因**：`65453` 落在 Windows 保留端口区间 `65407–65506`（Hyper-V/WSL 预留），
  `bind [127.0.0.1]:65453: Permission denied`——**不是端口冲突**（`Get-NetTCPConnection` 为空）。
  用 `netsh int ipv4 show excludedportrange protocol=tcp` 可查；`62111` 实测可绑。
- bridge CLI：`…\virtuoso-bridge-lite\.venv\Scripts\virtuoso-bridge.exe`。
- 客人端库 `<GUEST_HOME>/DSH_LAYOUT`，cell `dsh_demo`（已保存，5 个 shape，假工艺演示库）；
  **真库真工艺** `<GUEST_HOME>/DSH_NMOS`，tech **真绑 `smic18ee`**（SMIC 0.18 µm）。
  迭代中的 cell（`~/.validate/solve-*.py` 的产物）：
  `dsh_nmos`(22 DRC) → `dsh_nmos2`(24) → `dsh_nmos4`(35) → `dsh_nmos5`(36)
  → `dsh_nmos6`(18) → `dsh_nmos7`(16) → `dsh_nmos8`(13) → `dsh_nmos9`(7)
  → `dsh_nmos10/11`(阱实验) → `dsh_nmos12`(N 阱+拾取) → `dsh_nmos13`(实心环)
  → **`dsh_nmos15`(6 违规，全密度；LVS CORRECT；当前最终版)**。
- **Calibre 实跑已通**：`/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin/calibre`
  （v2015.2_36.27，许可有效至 2099-12-31）。DRC deck：
  `smic18ee_IC617/calibre/drc/SmicDR10T_<rev>.drc`；
  LVS deck：`…/calibre/lvs/SmicSP12R_<rev>.lvs`；xRC（PEX）套件：`…/calibre/xrc/`
  （含 `rules/v2009.3_24.19/*_{typ,Cmin,Cmax}.{C,R}`）——**但 PEX 未跑通，见 PEX-STATUS.md**。
- **GDS 必须用 `strmout` 二进制**（`/opt/IC617/tools/dfII/bin/strmout`），不能用 SKILL 的
  `streamOut`（各种调用形式都静默返回 nil）或 `xstSetField("topCell")`（会导出整个库）。
  必需参数：`-library -strmFile -strmVersion 3 -topCell -view layout -techLib smic18ee
  -layerMap …/stream/strmoutMap -translateUnmappedLPP`。
- 窗口：`1` CIW、**`20` = 用户未保存的原理图 `OSC_DESIGN CMP_MAIN`（绝对不要动）**、
  `21` `VB_DEMO demo_showcase layout`（**已保存**）、`22` `DSH_LAYOUT dsh_demo layout`、
  以及为画版图开的一系列 `DSH_NMOS *` 窗口（`23`~`34` 左右，会随 `geOpen` 递增）。
- **我能看图，而且看图是首选手段**（2026-10-17 实测）：`read_image` 对本模型 `deepseek-flash`
  真的返回像素，我亲眼看过根桌面截图和 23 号窗口截图，并据此读出了窗口状态栏里的交互提示。
  本文件旧版写的“我看不了图 / 无图像输入”**是错的，已作废**。
  **视觉是独立的证据通道**：「环其实是实心条」这件事没有任何 DRC 规则能报出来，
  只有截图能看出来（见 RING-CLOSED.md）。
  `.validate/image-census.py` 仍然有用，但降级为**量化补充**（颜色直方图/占比/饱和度），
  用于“我看到了但需要一个数字”的场合（例如对比度前后对比）。
- **X11 窗口模型（关键，踩过坑）**：metacity 的**框架窗口**才是 root 的子窗口（WM_NAME 是空的），
  Virtuoso 真窗口是框架的**子窗口**且带真 WM_NAME。bridge CLI 却把**子窗口 id 配框架的标题/几何**
  打印出来 → `dismiss-window` / `bootstrap --window` 按它给的 id 找不到窗口。
  给窗口发键/点击必须先 `x11_drive.py focus <子窗口id>`（内部做 XRaiseWindow + XSetInputFocus）；
  截图用 `xwd -screen -id <框架id>`（`-screen` 才拿得到真实像素，`-id <子窗口>` 是空白）。
- X 屏幕 `1280x768`，客人端有 `xwininfo` / `xwd` / `convert` / `identify` / `python2`，
  **没有** `xdotool` / `wmctrl` / `xwdtopnm`。
- **DPMS 唤醒铁律**：`xset s off; xset -dpms` **不会点亮已经关掉的屏**——必须先注入一次输入事件
  （`x11_drive.py focus <id>`）再 `xwd`。同样一条命令，唤醒前产出 354 B 两色空白图，唤醒后 88 KB 真实图。

## 3. 四层就绪模型 + 排障顺序（血泪教训）

四层互相独立：① VM 在跑 ② guest sshd 通 ③ **主机侧隧道 127.0.0.1:62111** ④ CIW 能答 SKILL。
**`ECONNREFUSED` ≠ Virtuoso 挂了**，通常只是“这一次调用没有隧道”。

**“连得上但一直不回”也 ≠ 隧道过期**（我本轮就误判过）：我曾判定“65453 上有个僵死的监听进程
（PID 15284）”，还另开 65460 隧道绕路——**这是错的**。同一个 65453 在 CIW 解开之后 87 ms 就答
`1+1 = 2`，`virtuoso_status` 也报 `CIW answered 1+1 = 2 directly over the tunnel in 101ms`。
`ssh -L` 的远端连接是**按需建立、用完即关**，所以客人端 `netstat` 看不到 `ESTABLISHED` 属于正常，
**不能**由一次快照推断“隧道死了”。判断通道好坏只有一条硬标准：**发 `1+1`，看它回不回 2**。

排障顺序：`virtuoso_status` → **看目标窗口状态栏**（见下）→ `virtuoso_recover` → `virtuoso_vm up`
→ 最后才怀疑 CIW。**不要**因为通道不通就重启 Virtuoso（用户有未保存的原理图）。

**屏保 / 黑屏铁律（本轮纠正）**：任何 XTEST 按键、点击、`xwd` 截图之前，必须先
`gnome-screensaver-command -d` + `xset s off; xset -dpms`。
**`gnome-screensaver-command -q` 说 “inactive” 不等于屏幕可用**：本轮所有 `xwd` 都只有 ~300 B、
2 色（全黑）的空白图，而屏保查询一直报 inactive——真因是 **DPMS 把屏幕关了**；补上
`xset s off; xset -dpms` 之后同一条命令立刻产出 85 KB / 315 KB 的真实图。
gnome 的电源管理会**周期性重新打开 DPMS**，所以这是**每次操作前都要重做**的动作，不是一次性设置；
`virtuoso_status` 的 `screensaver.active=false` 因此**不足以**说明“能截图”。

> `virtuoso_status` 报 `screensaver ACTIVE` 是“现在就是开着”，`virtuoso_recover` 报 `inactive`
> 是“它刚 `-d` 之后的状态”——两者**不矛盾**，是时序差异。

**“CIW 卡死”的真因（本轮定案，最有价值的一条）**：SKILL 通道连 `1+1` 都超时，
**不是** Virtuoso 挂了、**不是** 有模态框（我把 49 个 root 子窗口的全树都翻了，没有任何模态框）、
**不是**隧道过期——而是**某个图形窗口里有一个等待“点一下”的交互命令**。
本轮实测证据：23 号窗口自己的状态栏写着
`22/23  Enter the first corner of the box you wish to enlarge.` + `Cmd: ZoomIn` + `mouse L: mouseAddPt()`
——一次 **box-zoom 正等着第一个点**。SKILL 解释器停在这个阻塞调用里，桥的
`ipcBeginProcess` + `evalstring` 数据回调**根本没机会执行**，于是 daemon 侧所有请求一律
`TimeoutError`（并留不下任何 `CDS.log` 痕迹，因为 `evalstring` 不走 CIW 交互回显——
这正是它骗过我的地方：日志停在 11:59，看起来“没人动过”）。

- **定位方法（可复用）**：`x11_drive.py focus <子窗口id>` 把目标窗口抬到最前 →
  `xwd -screen -id <框架id>` 截图 → **直接读那个窗口自己的状态栏**，它写着“我在等什么”。
  `virtuoso_recover` 的“逐窗口发 Enter/Escape”之所以没用，是因为它没先看清谁在等、等的是什么。
- **关键区分（我靠自己的截图才发现，必须记住，否则会误判）**：状态栏显示
  `Cmd: ZoomIn` / `Enter the first corner…` **本身不等于通道卡死**。
  `artifacts/w23-raised.png`（12:21）的状态栏正是这个状态，而它前后两次 `virtuoso_eval` 都在
  ~1.2 s 内正常返回、18 个 rect 全部画完并保存——**通道是活的**。
  真正卡死通道的条件是**这次交互由 CIW 的 SKILL 求值器发起**（我从桥里调 `hiZoomIn(w)`）：
  求值器停在这个调用里等点，`evalstring` 才没机会执行。而用户（或我之前用 XTEST）在版图窗口
  通过工具条武装起来的 `ZoomIn` 跑在**窗口自己的事件循环**里，求值器空闲 → **不卡**。
  判据是「这个等待中的交互**是谁发起的**」，不是「状态栏里有没有 Cmd:」。
- **解法**：给**那个窗口**发一次 `Escape` 取消交互命令
  （`x11_drive.py key <子窗口id> Escape`）。实测 90 ms 内 `1+1` 就恢复成 `<STX>2`。
- **预防**：`hiZoomIn` 这类**图形交互函数绝不要**用 SKILL 远程调（要缩放就发 XTEST 按键/点击）。
  这是本轮唯一一个“能自己把自己锁死”的操作。

## 4. 已验证的画版图配方（以及六个坑）

```skill
ddCreateLib("DSH_LAYOUT" "<GUEST_HOME>/DSH_LAYOUT")
techBindTechFile(lib "VB_DEMO")            ; 要技术库【名字】，不是路径！
assert techGetTechLibName(lib) == "VB_DEMO"
cv = dbOpenCellViewByType(lib "dsh_demo" "layout" "maskLayout" "a")
dbCreateRect(cv list("M1" "drawing") list(list(x0 y0) list(x1 y1)))
dbSave(cv)
```

坑：
1. `techBindTechFile` 收技术库**名**（`"VB_DEMO"`），传路径会让所有 `dbCreateRect` 失败。
2. `geOpen` 可能被模态框卡住 CIW（表现为 `socket timeout`）→ 先 `virtuoso_recover`。
3. **`rm -rf` 删掉库目录会把库名在整个 Virtuoso 会话里卡死**——不要用删除来“重来”。
4. SKILL 经命令行 argv 传递会**丢光双引号**（PowerShell 5.1 也有同样毛病）→ 用
   `eval --file <path>`，它走 stdin。
5. 客人端命令里避免 `"` 和 `#`。
6. bridge CLI 的 stdout 混有杂讯 → 必须 strip 掉跟踪行再 parse JSON。

## 5. 工具面与文档（这一轮新增）

- **12 个工具**（2026-10-17 起，新增 `host_window`）：
  `workspace_create`、`virtuoso_status`、`virtuoso_config`、`virtuoso_vm`、
  `virtuoso_recover`、`virtuoso_windows`、`virtuoso_screenshot`、**`host_window`**、
  `virtuoso_eval`、`virtuoso_run`、`virtuoso_drc`、`context_usage`。
  **不加 `virtuoso_` 前缀的两个**：`host_window`（操作 Windows 桌面，不是 Virtuoso）
  与 `context_usage`（DSH 计量）。理由同 `workspace_create`——它们不属于版图域。
- `host_window`（`lib/host.js` + `lib/host-window.ps1`）是「show me」能力，解决人机功效：
  枚举 / 抬起 / 截图**宿主机**窗口（VMware 控制台等）。四个 action：
  `list`（可见有标题窗口，含 pid/title/class/rect）、`info`、`raise`（restore/maximize/focus）、
  `capture`（置顶 + `CopyFromScreen` → PNG，返回 bytes/sha256，**<1024 B 判为空白图失败**）。
  实测：`list` 5 窗口、`capture` DSH 窗口 151,702 B。
  **已知边界**：它读宿主机桌面，与 `virtuoso_screenshot`（读客人机）是两条独立通道；
  非 win32 返回 `ok:false` 而非抛错。
- `TOOLS.md` 由 `.validate/gen-tools-doc.mjs` 从**活的注册定义**生成 → 改了描述/参数/输出就重跑，
  文档不可能与实际漂移。README 只保留状态表并指向 `TOOLS.md`。
- **错误反馈集中在一处**：`virtuoso.js` 的 `hintFor`/`withHint` + `index.js` 的 `registerSafely`
  （对每个工具的 `execute` 统一追加 `Hint:`）。已知六类签名：`ECONNREFUSED`、socket timeout、
  `error while loading file`、`ENOENT`、SSH 认证、`not lossless JSON`。
  **未知错误原样透传**——宁可没有提示，也不要给错的提示。
- `virtuoso_eval` 失败返回结构化的 `errorKind`/`errorText`/`hint`；`virtuoso_drc` 路径写错时会
  列出同目录里**真实存在**的 Calibre 结果文件。
- 加新工具时必须同时做四件事：在 `gen-tools-doc.mjs` 的 `NOTES` 里补一条（否则表格出现 `?`）、
  重跑生成脚本、同步 profiles 副本（含新文件）、**重启 DSH**。
  另需同步 `TOTAL_TOOLS`（`lib/index.js`）与 `.validate/guard-test.mjs` 的计数断言。
- 验证命令：`node --check <file>`；`.validate/plugin-test.mjs`（mock ctx 真调 `execute`，
  **不用重启**）；`.validate/context-test.mjs`（50 项：服务缺失、身份回退、无窗口的 provider、
  `requestContext()` 抛错、压力档边界、无损 JSON）；`.validate/job-test.mjs`（8 项：job 的 settled
  payload 不得包含已流式输出的字节，含一条源码守卫）；`.validate/hint-test.mjs`；
  `.validate/tool-error-test.mjs [drcDir]`；`.validate/guard-test.mjs`（69 项：分类 / 策略 / 注册三层）；
  `.validate/paren-check.mjs <file.il>`。
- ToolDefinition 的 `execute` 必须返回**无损 JSON**：一个值为 `undefined` 的属性就会让整次调用
  失败（`value is not lossless JSON`）→ 已用 `jsonSafe` 包住（它会剥掉 undefined 值的键，
  所以“可选字段”可以放心地条件赋值）。

### 写操作闸门（`lib/guard.js`，这一轮新增）

- 机制只有一种：`ctx.tools.guard(fn)`。契约从 app.asar 里核实过，**它决定了整个设计**：
  - guard 是**同步**的（`(execution) => string | undefined`），**等不了人类回答**；
  - 它在 `tools/pre-execute` waterfall **之后**运行，**只能拒绝**（返回原因字符串）或弃权（undefined），
    **任何 guard 都不能强制放行**；
  - 传进来的是 `{ callId, name, arguments, agent, signal }`——是 **`arguments` 不是 `args`**，
    而且模型参数 JSON 解析失败时 `arguments` 是**原字符串**（所以必须容忍非对象）。
- 决策链：`writeIntent()` 用正则判断“这次调用会不会写”→ `danger-full-access` 直接**弃权**
  （用户已在文件策略里给了全权写权限，闸门让路，这正是用户的要求）→ 否则要求传
  `confirm: "<8 位 sha256 摘要>"`。摘要取自 payload 本身 → **无状态**：同一 payload 重复提交无害，
  改一个字符就换 token 重新问。`confirm: true` **故意不接受**（那是橡皮图章）。
- **读操作永不拦**：`dbOpenCellViewByType(… "r")`、`cv~>shapes`、`sleep; echo`、`2>&1`、`>=`
  都不算写——否则会训练出“不看就贴 token”的坏习惯。
- **故障时 fail-closed**：沙箱策略读不到、或 guard 自己分类时抛错 → **拒绝**，绝不静默放行；
  `tools.guard` 不存在时只警告，插件照常工作（`writeGuard.installed=false`）。
- **刻意不用 `approval.request()`**：它要求 turn 处于打开状态，且本会话**审批提示是禁用的**
  （自动拒绝）→ 接上去会把写操作整体弄坏。
- 可观测性：`virtuoso_status` 输出带 `writeGuard`
  （`installed/defaultMode/sessionMode/enforcedByDefault/enforcedNow/summary`）——
  **没人看得见的闸门等于没有闸门**。
- 覆盖范围：只有 `virtuoso_eval` + `virtuoso_run`（含 `file:`，且 `file` 优先于 `skill`，与 execute 一致）；
  `virtuoso_vm`、`virtuoso_config set/unset` **有意不盖**（单目标、可逆、同一工具可撤销），需要时可扩展。
- 生效条件：`lib/guard.js` 是**新模块** → 必须复制到 profiles 副本并**重启 DSH**（HMR 不认新模块）。

## 6. 上下文 / 压缩：查清的事实与对策（用户要求记录）

**已核实的事实**

- 压缩由核心服务 `compaction.compactIfNeeded(agent, trigger, signal)` 按阈值触发，
  **不是“读到大文件”这件事本身**触发的。
- 在那之前，`toolResultPruner` 会先做确定性的 head/middle/tail 裁剪——我看到的
  “middle pruned”“Omitted 31533 bytes”就是它在工作。
- 核心**已经有 `tokenMeter` 服务**（`measure(session)` / `estimateMessage(message)`），
  但**没有任何 Inspect provider 暴露它**（host 侧只有 `Service`/`Event`/`Config`/`Tool`），
  所以我看不到自己的上下文占用，只能撞墙才知道。
- `Tool.listTools` 的 inputSchema 是空对象且 `additionalProperties:false` →
  **无法只查一个工具**，只能全量 dump（这本身就是一次大输出）。
- 核心代码在本机**不可改**：`E:\dsp harness\resources\app.asar` 是一个 **121 MB 的文件**；
  `app.asar.unpacked\dsh` 里只有 `node_modules`。（系统提示里写的 `app.asar\dsh` 这个路径不存在。）

**对策**

1. **我的读取纪律（立刻执行，零成本）**：先 `grep` 定位，再 `read` 带 `offset`/`limit`；
   绝不整读超过 ~500 行的文件；不查全量工具表除非必要；命令输出尽量小。
2. **可控升级（已实现：`context_usage`，只读）**：把已有的 `tokenMeter` 暴露出来，我就能在大读取
   **之前**看预算，而不是撞墙之后。契约已核实（用 `Service` 的 `{service}` 定向查询拿到类型声明）：
   - 身份：`sessions.get(id)` 是 `SessionId → Session` 的**唯一**解析器；`Agent { readonly id }`。
   - `tokenMeter.measure(session) → TokenMeasurement`，字段全部必填：`totalTokens`（= 已用量）、
     `surfaceTokens`、`surfaceDeltaTokens`、`baseline`（`{kind:'none'|'estimated'|'usage', tokens}`）、
     `nodes[]`、`logRevision`。
   - `TokenSurfaceNode = { seq, tokens, heuristicTokens }`——**没有 label/role**，所以贡献者只能按
     `seq` 索引，无法按角色命名。
   - `session.requestContext() → { provider, model, contextWindow? }`，**`contextWindow` 可能缺失**
     → 缺了只报绝对 token 数，不造百分比（`percent`/`pressure` 字段直接省略）。
   - **已证实（重启后实测）**：`execute(args, exec)` 里的 `exec.agent.id` **确实存在**，第一次真调就走通了
     这条通道（返回值 `source: "exec.agent"`），`agents.currentInitiator()?.id` 只是保险。工具仍会把
     **用了哪条通道**写进 `source`——自诊断，而不是猜。
   - **已证实**：`totalTokens`（对外叫 `used`）就是“已用量”，且来自 provider 的 usage 基线
     （首测 `46,055` = `baseline.tokens`，`kind:'usage'`，而 `surfaceTokens` 只有 `29,509`）；
     `contextWindow` 也给得出（首测 `512,000` → `9%` / low）；provider/model 是
     `teamrouter/deepseek-flash`。
   - 压力档位按**四舍五入后的百分比**判定（`<50 low / <75 moderate / <90 high / else critical`）；
     若用未舍入的比值，`149999/200000` 会印出 “75%” 却标 `moderate`（这个矛盾是边界测试抓出来的）。
   - `session.requestContext()` 抛错时**不能丢掉**已量到的 token 数 → 捕获后照样返回 `used`，
     只不给百分比，并在 `detail`/`hint` 里说明原因。
3. **需要上游源码仓库的升级（本机做不到）**：给 Inspect 加 Token provider；
   给 `Tool.listTools` 加 `{name}` 过滤。
4. 我自己的诱因（要主动避免）：整读 `virtuoso.js` / `index.js`（都上千行）、
   `Tool.listTools` 全量 dump、范围过大的 `glob`。

## 7. 已完成 / 待办

**已完成（2026-10-17，全部实测）**

- **DRC 收敛**：`DSH_NMOS/dsh_nmos15` 393 检查，**6 违规全为密度规则**（`PD.*` + `MIM_8a`），
  零几何违规。收敛曲线 22→24→**35**(放大器件反而恶化)→36→18→16→13→7→6。
- **LVS CORRECT**：`N=4 EP=4 FDC=1`，`M0 S G D B <model> L=1.8e-07 W=1.2e-06`。
- **保护环闭合**：四边 AA 框 + SP 框，光栅化验证有孔（`solve-ring-frame.py` 数空洞）。
- **Git 仓库已建**：`virtuoso-layout\.git`，主线提交 8 个（含完整文档与失败记录）。
- **SKILL 三处方法错误已定案**：`procedurep`/`getd` 探测不可靠（对 `geOpen` 也返回 nil）；
  前缀算术 `(- x d)` 不可用（必须中缀）；`car(cdddr(r))` 取不到第 5 项（要用 `car(cddddr(r))`）。
- **GDS 必须 `strmout`**（见 §2），SKILL `streamOut` 静默返回 nil。

**待办 / 未达成**

- **PEX 未跑通（已知开放项，见 `PEX-STATUS.md`）**：xRC 规则齐备（`calibre/xrc/` 下
  `rules/v2009.3_24.19/*_{typ,Cmin,Cmax}.{C,R}` + MIPT + TM），但官方 deck 为
  Calibre xRC **v2009.3** 编写，本机 **v2015.2** 的 Interactive 解析器拒绝它：
  已修第 289 行（引号与注释符之间缺空格），随后报 `unmatched open brace in list`（未定位）。
  已做对照实验排除自身编辑因素。**建议装 v2009.3 或让 PDK 方给新版 deck**；
  在此之前不要逐个改 foundry deck 语法（有悄悄改坏规则语义的风险）。
- **密度规则无法在单管上满足**（6 条）：需周边填充或放进完整版图语境。
- **23 项 `SLOT_*` 未执行**：需大块金属才适用。
- **9 项 `GR_*` 未执行**：注意 `GR_*` 是 **Gate Resistor（多晶硅电阻）**规则，不是 guard ring
  （规则体是 `INT (GPR INSIDE EDGE SAB)`、SAB 间距、"no dog-bone"）——曾误判过。
- 未跑 PEX / 未做多指 / 共质心匹配。
- 未推远程仓库（目前纯本地 `.git`，硬盘坏了就没了）。

**历史条目**

- ~~重启后第一件事~~ **已完成**：`context_usage` 重启后真调成功（两条已证实的事实见 §6 对策 2），
  README 状态行已从 “offline-verified / live call pending” 翻成 “verified live”。
- `virtuoso_run` 的后台 job 路径**已实测通过**（`sleep 20; echo JOBDONE` → `mode:job`、`jobId`
  `bash-1` → `job_output` 拿到客人端 stdout → `job_list` 显示 `bash-1 [bash] completed`）。
  实测顺手抓到一个真 bug：**完成的 job 会把输出打印两遍**（job 已流式 `append` stdout，settled
  payload 又把整个 stdout 塞进 `result`）；用双通道探针（`echo OUT-ONLY; echo ERR-ONLY 1>&2` →
  OUT-ONLY / `[stderr]` ERR-ONLY / OUT-ONLY）证明重复来自 `result`，而不是 `append` 触发两次。
  已抽成 `jobOutcome()`，`.validate/job-test.mjs` 8 项 + 源码守卫守住。
  **重启后复测：`OUT-ONLY` 与 `[stderr] ERR-ONLY` 各只出现一次 → 修复已生效。**
- ~~考虑给改版图的 SKILL（`dbSave`/`dbCreate*`）加 `ctx.tools.guard()` 确认~~ **已完成并生效**
  （`lib/guard.js`，见 §5 末）：已复制到 profiles 副本，**重启后已确认挂上**（见本节的最后一条）。
- ~~过期引用~~ **已处理**：`<HOME>\.config\mimocode\skills\virtuoso\LOCAL-SETUP.md` 里 4 处路径
  已全部改指本工作区（原先旧根目录只留一条「这是归档，别照做」，该归档现已删除，说明改为「已删除」）。
  `.workbuddy\modify_backup\*.md` 里的同类命中是历史会话备份，**不要改**。
- ~~`21` 号窗口未保存~~ **已保存**（`scratch/save-demo-showcase.il` → 标题星号消失）；
  用户自己的 `20` 号窗口（`OSC_DESIGN CMP_MAIN` 原理图）全程未碰。
- `<GUEST_HOME>/DSH_LAYOUT/dsh_demo`（5 个 shape）**保留**（用户决定：演示库）。
- ~~可选清理：`<HOME>\virtuoso-bridge-lite（以后可以考虑删除）` 里 171.8 MB 的 `.venv`~~
  **已删除**（2026-10-17，用户批准）：删前做了逐文件比对——归档里**没有任何** live clone 没有的文件
  （338 vs 340 个文件，差集为空），且**两边都没有 `.git`**，所以没有不可恢复的东西；整个目录
  175.9 MB 一次删掉（`.venv` 占其中 171.8 MB）。`LOCAL-SETUP.md` 的「归档说明」同步改成「已删除」。
- ~~待观察：`tools.guard` 装上了但没见过真实拒绝~~ **已在真实会话里全部实测通过**（2026-10-17）。
  先在 danger-full-access 下看到 `enforcedNow: false`（闸门按设计让路），用户把会话切到
  workspace-write 后 `enforcedNow: true`，随即跑完四种情形：
  1. **SKILL 写**：不带令牌的 `dbSave` → **拒绝**，理由点名 `(dbSave)`；拿返回的令牌 `a76f4047`
     原样重发 → `dbSave` 返回 `t`，**真的执行了**。
  2. **shell 写**：`touch …; ls …; rm -f …` → **拒绝**，且只点名真正的写操作 `(touch, rm)`，
     **没冤枉只读的 `ls`**；用令牌 `2ab129d2` 重发 → job `bash-1` 输出
     `-rw-rw-r-- … /tmp/dsh-gate-probe.txt` 且 `ssh exited 0`（输出只出现一次，job 修复仍有效）。
  3. **错令牌**：`confirm: "deadbeef"` → **照样拒绝**，并明说“该令牌不是本 payload 的令牌”。
  4. **只读永不拦**：`cat /etc/redhat-release; id -un` 不带任何令牌 → 直接执行，零摩擦。
  结论：拒绝 → 令牌 → 放行、错令牌、读操作豁免，四种都是**真实 DSH 工具调用**验证的，
  不再只是离线 69 项。要再现场看一次，把会话文件策略切到 `workspace-write` 即可复现。

## 8. 回滚点

`plugin_manager remove_bundle dsh-plugin-virtuoso-layout`；
profile 备份（**是文件，不是目录**，都在 `<DSH_HOME>\profiles\desktop\` 下）：
`cordis.patch.yml.bak-20261016-221514`、`cordis.patch.yml.bak-20261017-004021-preuserinsert`、
`package.json.bak-20261016-221514`；
VM 配置备份：`<VM_DIR>\RHEL6_ic617\RHEL6_WORK.vmx.bak-20261017-005101-prememsize`（把内存调到 4 GB 之前
的 vmx），同目录另有更早的 `RHEL6_WORK.vmx.bak-20260906`；
生成的工具文档旧版：`…\virtuoso-layout\TOOLS.md.bak`。
**profile 的 user patch 层无探测代码、逐字节精确——不要动。**
（2026-10-17 核实：上面这些**确实都还在**；我一度按目录名去找 `profiles\.bak-*`，那是找不到的——
它们是文件级备份，名字里带的就是备份时刻。）

## 9. 与 `virtuoso-bridge-lite\AGENTS.md` 的关系

那份是上游 bridge 仓库的说明，适用于 Python 客户端用法。本插件刻意走 bridge CLI +
客人端 ssh 探测，与它「Never SSH and run SKILL manually」的约定有一处口径差异，
属于**有意为之**：插件必须能独立于本机 Python 环境工作（本机 `@deepseek-ai/*` 版本不匹配，
插件零依赖）。
