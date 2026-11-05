# Mac + CrossOver 赛车游戏测试兼容性

> 调研日期：2026-11-05  
> 适用环境：Apple Silicon Mac、CrossOver 26 系列、Windows 10 64-bit bottle  
> 目标：判断哪些 Windows 赛车游戏适合在 Mac 上进行 LapWing 遥测、录像同步和精彩时刻识别开发  
> 注意：CrossOver 兼容性会随游戏更新、反作弊和 CrossOver 版本变化；正式发布前仍需在真实 Windows 上验收。

## 1. 结论

优先测试：

1. **DiRT Rally 2.0**：CrossOver 运行证据明确，Codemasters UDP 协议成熟，适合作为首个拉力游戏。
2. **F1 23**：CrossOver 运行良好，官方 UDP 协议完整，适合作为首个方程式游戏。
3. **Automobilista 2**：CrossOver 运行良好，直接输出 Project CARS UDP 协议，适合作为通用场地赛样本。

第二批可考虑 BeamNG.drive、Project CARS 2、F1 22。WRC Generations 和 Forza Horizon 5
值得探索，但目前没有足够证据把它们当作稳定的日常开发环境。

iRacing 和 EA SPORTS WRC 受 Windows 反作弊限制，不能通过 CrossOver 完成 live 集成测试。
iRacing 的 `.ibt` 解析、精彩时刻检测、视频同步和 FFmpeg 导出仍可在 Mac 上离线开发。

## 2. 判定口径

- **推荐**：有较新的运行证据，并且能通过 UDP 直接向 macOS 原生 companion 输出遥测。
- **实验性**：游戏可能运行，但兼容性证据不足、来源互相冲突，或遥测依赖 Windows shared memory。
- **不可用**：已确认不能安装/运行，或被内核级反作弊硬性阻断。
- “能运行”不表示方向盘、踏板和力反馈完全正常。LapWing 首轮开发只要求游戏能进入赛道、
  键盘或手柄可驾驶、遥测可输出、OBS 可录制。

CodeWeavers 数据库中的部分游戏只有一两份报告，因此 `Runs Well` 不是大规模兼容性保证，
而是值得在当前机器上复测的起点。

## 3. 游戏兼容性

| 游戏 | CrossOver 状态 | 遥测接口 | 结论 | 对 LapWing 的意义 |
| --- | --- | --- | --- | --- |
| DiRT Rally 2.0 | `Runs Well`，CrossOver 26.2 | Codemasters UDP，默认 20777 | 推荐 | 拉力适配首选；运行与 UDP 均有明确证据 |
| F1 2020 | `Runs Well`，CrossOver 25.1.1 | UDP，默认 20777 | 推荐 | 版本较老但稳定，适合验证 F1 协议 |
| F1 22 | `Runs Well`，CrossOver 26.0 | UDP，默认 20777 | 推荐 | 可直接向 macOS companion 发包 |
| F1 23 | `Runs Well`，CrossOver 25.0.1 | 官方 UDP 协议，默认 20777 | 推荐 | CrossOver 和协议证据都较明确 |
| F1 25 | CrossOver 26 有社区离线运行报告；CodeWeavers 旧评级为不能运行 | UDP，默认 20777 | 实验性 | 仅建议离线测试；来源与版本之间存在冲突 |
| F1 24 | `Will Not Install`，CrossOver 25.1.1 | 游戏支持 UDP，但无法可靠启动 | 不可用 | 不建议投入适配时间 |
| WRC Generations | 未找到足够可靠的游戏级 CrossOver 实测 | Codemasters 风格 UDP，默认 20777 | 实验性 | 数据接口合适，但必须先完成本机启动和完整赛段实测 |
| EA SPORTS WRC | 安装后不能运行 | 支持 UDP，但被 EA anticheat 阻断 | 不可用 | 1.9.0 起使用 Windows 内核级反作弊 |
| Forza Horizon 5 | `Limited Functionality`，CrossOver 26.3 | Forza Data Out UDP，自选端口 | 实验性 | 遥测质量高，但运行稳定性不足 |
| Forza Horizon 4 | `Installs, Will Not Run`，CrossOver 26.0 | 支持 Data Out UDP | 不可用 | 不适合本机联调 |
| Automobilista 2 | `Runs Well`，CrossOver 26.0 | Project CARS UDP，固定 5606 | 推荐 | 协议成熟，最高约 60 包/秒 |
| Project CARS 2 | 有 Apple Silicon 社区运行报告 | UDP，固定 5606 | 推荐 | 协议成熟；已从 Steam 下架，账号需已拥有 |
| BeamNG.drive | 有 Apple Silicon 社区运行报告 | OutGauge UDP，自选端口 | 推荐 | 适合碰撞、翻滚和车辆动态事件检测 |
| Assetto Corsa Competizione | `Runs Great` | Windows shared memory | 实验性 | 游戏可运行，但需在 bottle 内增加 UDP 桥接器 |
| Assetto Corsa | 社区广泛确认可运行 | Windows shared memory | 实验性 | 需要 bottle 内桥接，不宜作为首个适配目标 |
| rFactor 2 | `Runs Great`，CrossOver 25.1.1 | shared-memory 插件 | 实验性 | 可玩，但数据接入比 UDP 更复杂 |
| RaceRoom | CodeWeavers 为 `Limited Functionality`；社区有较好报告 | Windows shared memory | 实验性 | 运行证据有分歧，同时需要数据桥接 |
| iRacing | 不能运行 | Live shared memory；赛后 `.ibt` | 不可用 | 反作弊阻断 live 测试；Mac 仅适合离线流水线 |
| Le Mans Ultimate | 当前不能可靠运行 | — | 不可用 | 需要真实 Windows 环境 |

## 4. 推荐适配顺序

### 第一批：直接 UDP

1. DiRT Rally 2.0；
2. F1 23；
3. Automobilista 2。

这一批分别覆盖拉力、方程式和通用场地赛。三者都能绕开 Windows shared memory：

```text
CrossOver 中的游戏
  → UDP
  → macOS 原生 LapWing companion
  → 遥测文件 + OBS 录像 + 同步锚点
  → LapWing CLI 分析和 FFmpeg 裁剪
```

### 第二批：扩展事件类型

- BeamNG.drive：碰撞、翻滚和车辆物理事件；
- Project CARS 2：复用 Automobilista 2 的协议适配；
- F1 22 / F1 2020：验证同系列协议版本兼容。

### 第三批：兼容性探索

- WRC Generations：先验证能否稳定进入赛段，再验证 UDP；
- Forza Horizon 5：先确认 CrossOver 26.x 下的可玩范围和 Data Out；
- Assetto Corsa / ACC：实现 bottle 内 shared-memory-to-UDP 桥接后再接入。

## 5. Mac 本地测试基线

建议使用独立的 Windows 10 64-bit Steam bottle，并优先尝试：

- D3DMetal；
- MSync；
- 游戏内关闭光线追踪；
- 中等画质和窗口化/无边框模式；
- 键盘或手柄完成首轮遥测验证。

对 UDP 游戏，先将目标设为 `127.0.0.1` 和对应端口，让 macOS 原生 companion 监听。
如果收不到包，再改为 Mac 的局域网 IP，并检查 macOS 防火墙。一个 UDP 端口通常只能由
一个进程直接绑定；SimHub、仪表盘软件和 LapWing 同时使用时，需要端口转发或配置不同端口。

方向盘与力反馈是独立兼容性问题。它们不应阻塞协议解析、事件检测和视频同步开发，
但正式宣称支持某款游戏前，仍需在真实 Windows 与常见方向盘上完成端到端验收。

## 6. 关键来源

CrossOver 运行状态：

- [CodeWeavers CrossOver Compatibility Database](https://www.codeweavers.com/compatibility/)
- [DiRT Rally 2.0](https://www.codeweavers.com/compatibility/crossover/dirt-rally-20)
- [F1 2020](https://www.codeweavers.com/compatibility/crossover/f1-2020)
- [F1 22](https://www.codeweavers.com/compatibility/crossover/f1-22)
- [F1 23](https://www.codeweavers.com/compatibility/crossover/f1-23)
- [F1 24](https://www.codeweavers.com/compatibility/crossover/f1-24)
- [F1 25](https://www.codeweavers.com/compatibility/crossover/f1-25)
- [Forza Horizon 4](https://www.codeweavers.com/compatibility/crossover/forza-horizon-4)
- [Forza Horizon 5](https://www.codeweavers.com/compatibility/crossover/forza-horizon-5)
- [EA SPORTS WRC](https://www.codeweavers.com/compatibility/crossover/ea-sports-wrc)
- [Automobilista 2](https://www.codeweavers.com/compatibility/crossover/automobilista-2)
- [rFactor 2](https://www.codeweavers.com/compatibility/crossover/rfactor2)
- [RaceRoom](https://www.codeweavers.com/compatibility/crossover/raceroom-racing-experience)
- [Assetto Corsa Competizione](https://www.codeweavers.com/compatibility/crossover/assetto-corsa-competizione)

协议与阻断条件：

- [CodeWeavers：Game Anti-Cheat Systems with CrossOver](https://support.codeweavers.com/en_US/anti-cheat)
- [EA：EA anticheat is coming to EA SPORTS WRC](https://www.ea.com/technology/news/ea-anticheat)
- [F1 23 UDP Specification](https://forums.ea.com/discussions/f1-23-en/f1-23-udp-specification/8390745)
- [Forza Motorsport Data Out Documentation](https://support.forzamotorsport.net/hc/en-us/articles/21742934024211-Forza-Motorsport-Data-Out-Documentation)
- [Automobilista 2 telemetry](https://www.simracingtelemetry.com/games/AMS2/)
- [Torqer：Apple Silicon sim racing guide](https://torqer.app/sim-racing-on-apple-silicon-mac-the-complete-guide-2026/)

## 7. 维护要求

重新核验以下情况：

- CrossOver 大版本升级；
- 游戏加入或更换反作弊；
- 游戏更新后无法启动或停止输出遥测；
- 正式新增某款游戏适配器；
- 将“实验性”游戏声明为正式支持。

更新时记录 CrossOver 版本、macOS 版本、Mac 芯片、游戏商店版本、图形后端、
是否能完成整场/整赛段以及遥测是否完整，避免只凭“菜单能够打开”判断兼容。
