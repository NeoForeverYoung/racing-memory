# 赛车模拟与 iRacing 开源生态调研

> 调研日期：2026-11-04
> 主题：iRacing SDK、`.ibt`、遥测分析、自动精彩视频、Replay 控制、Overlay、比赛工程师与跨游戏数据平台
> 目标：为 Racing Memory 的技术路线、产品定位和后续实现提供可追溯参考
> 说明：Stars、版本和维护状态会变化；许可证以各仓库当前 `LICENSE` 为准。标为“未核实”的项目不得直接复制代码。
> Mac 本地联调可行性另见：[Mac + CrossOver 赛车游戏测试兼容性](crossover-racing-compatibility.md)。

## 1. 结论

赛车模拟开源生态并不缺少遥测解析器、实时 Overlay 或专业圈速分析工具，但“以普通玩家为中心，自动把一场比赛整理成成绩卡、图片和几分钟回忆视频”的完整开源方案仍然较少。

目前与 Racing Memory 最接近的三个方向是：

1. **Dove’s DataViewer**：`.ibt`、视频同步、遥测 Overlay 和 MP4 导出都已覆盖，但产品重心是专业数据分析。
2. **iRacingReplayDirector / ReplayOverlay.NET**：会分析事故和缠斗并生成集锦，但项目较老，偏联赛转播和 Replay 二次录制。
3. **Sim Steward**：有比较现代的事故索引、回放跳转和审查流程，但自动 OBS 采集仍是缺口。

协议与基础设施层已经有多种实现：

- Go：`mpapenbr/goirsdk`
- Rust：`racedirector/iracing.rs`
- C#：`SVappsLAB/iRacingTelemetrySDK`
- Python：`kutu/pyirsdk`
- TypeScript/Bun：`hotlap-ai/telemetry`

因此 Racing Memory 不应把“重新实现 IRSDK”作为长期核心竞争力。协议代码的目标应是正确、可验证、可替换；真正应该投入的是：

- 精彩时刻识别；
- 录像与遥测自动对齐；
- 个人化成绩卡、封面和视频叙事；
- 本地隐私与一键使用体验；
- 从一场比赛到可分享回忆的自动化闭环。

## 2. 调研方法与信息可信度

本次资料来自：

- GitHub 仓库 README、许可证和仓库元数据；
- 项目网站和公开文档；
- npm/crates.io 包信息；
- iRacing 官方第三方开发说明、SDK 入口与条款；
- 项目公开的 issue、PR 和功能清单。

采用以下可信度标记：

- **已核实**：仓库或官方文档直接声明。
- **项目自述**：README 声称具备，但本次未运行验证。
- **推断**：根据目录、技术栈或公开说明作出的判断。
- **未核实**：未找到明确许可证、更新日期或实际实现证据。

不要仅凭 README 的功能列表复制架构或代码。采用任何项目代码前至少检查：

1. `LICENSE` 是否允许当前用途；
2. 是否要求衍生项目开源；
3. 依赖的 SDK、游戏数据和媒体是否有单独条款；
4. 最近一次真实代码更新，而不是仅自动依赖更新；
5. 是否有测试、fixture 和版本兼容策略；
6. 是否存在真实游戏验收证据。

## 3. 项目分类地图

### 3.1 与 Racing Memory 直接相似

- [Dove’s DataViewer](https://github.com/TheAngryRaven/DovesDataViewer)
- [iRacingReplayOverlay.net](https://github.com/vipoo/iRacingReplayOverlay.net)
- [iRacingReplayDirector](https://github.com/MerlinCooper/iRacingReplayDirector)
- [Sim Steward](https://github.com/simsteward/simhub-plugin)
- [iRacing Replay Video](https://github.com/matteocrippa/iracing-replay-video)
- [SimRace Publisher Studio](https://simracepublisher.com/en/)（商业参考，不是开源实现）

### 3.2 iRacing SDK 与 `.ibt`

- [mpapenbr/goirsdk](https://github.com/mpapenbr/goirsdk)
- [racedirector/iracing.rs](https://github.com/racedirector/iracing.rs)
- [SVappsLAB/iRacingTelemetrySDK](https://github.com/SVappsLAB/iRacingTelemetrySDK)
- [kutu/pyirsdk](https://github.com/kutu/pyirsdk)
- [hotlap-ai/telemetry](https://github.com/hotlap-ai/telemetry)
- [quimcalpe/iracing-sdk](https://github.com/quimcalpe/iracing-sdk)
- [ESilva15/goirsdk](https://github.com/ESilva15/goirsdk)
- [LeoAdamek/iracing.rs](https://github.com/LeoAdamek/iracing.rs)
- [riccardotornesello/irsdk-go](https://github.com/riccardotornesello/irsdk-go)

### 3.3 Overlay、Dashboard 与比赛工程师

- [OpenOverlay](https://ccarrascoalv.github.io/OpenOverlayWeb/)
- [iRacing Race Engineer Dashboard](https://github.com/dntAtMe/iracing-dashboard)
- [CrewChief](https://github.com/mrbelowski/CrewChiefV4)
- [RaceIQ](https://github.com/SpeedHQ/RaceIQ)
- [Atlas Racing](https://github.com/DhruvGoswami10/AtlasRacing-Product)
- [TinyPedal](https://github.com/TinyPedal/TinyPedal)
- [Lovely Dashboard](https://github.com/Lovely-Sim-Racing/lovely-dashboard)
- [RacePulse](https://github.com/gAlexander77/racepulse-release)

### 3.4 遥测分析与跨格式工具

- [Dove’s DataViewer](https://github.com/TheAngryRaven/DovesDataViewer)
- [i3rs](https://github.com/Friss/i3rs)
- [ld-cli](https://github.com/snipem/ld-cli)
- [ldparser](https://github.com/gotzl/ldparser)
- [TrackDataAnalysis](https://github.com/racer-coder/TrackDataAnalysis)
- [B4mad Racing](https://github.com/b4mad/racing)

## 4. 最接近 Racing Memory 的项目

## 4.1 Dove’s DataViewer

仓库：[TheAngryRaven/DovesDataViewer](https://github.com/TheAngryRaven/DovesDataViewer)

调研时状态：

- 21 stars、4 forks；
- GPL-3.0-or-later；
- 2025-12 创建；
- 2026 年仍有较大规模版本更新；
- React 18、TypeScript、Vite、Tailwind、Vitest；
- 浏览器本地处理为主，可选云同步。

主要能力：

- 解析 iRacing `.ibt`；
- 支持 NMEA、UBX、VBO、MoTeC、AiM、Alfano 等多种格式；
- 自动赛道与行驶方向识别；
- 自动圈和分段识别；
- 赛车线、速度热力图、刹车区；
- 最佳圈、参考圈和 pace delta；
- GoPro 分段视频与遥测同步；
- 多种遥测 Overlay；
- 使用 WebCodecs 与 MP4 muxer 导出 H.264 MP4；
- 本地优先，不要求后端。

对 Racing Memory 的价值：

1. **视频时间轴**：研究其如何关联 GoPro 分段视频、遥测时间和圈边界。
2. **跨格式架构**：研究不同输入格式如何归一化到统一 session/lap/channel 模型。
3. **Overlay 渲染**：参考 Overlay 数据模型，而不是直接复制 UI。
4. **浏览器本地处理**：证明“隐私优先、不上传原始遥测”具有产品可行性。
5. **赛道检测**：未来扩展真实赛道日数据、GPS 视频时有价值。

限制与注意：

- GPL-3.0-or-later 对分发衍生作品有强 copyleft 要求；
- Racing Memory 当前 Go 后端与 FFmpeg 管线不同，直接复用成本高；
- 项目重心是数据分析，不是自动故事化集锦；
- 采用其思路可以，复制实现前必须评估 GPL 影响。

建议阅读顺序：

1. `src/lib/iracingParser.ts`
2. 视频同步相关模块
3. 视频导出与 MP4 muxing
4. lap/sector/pace delta 算法
5. 多格式归一化类型定义

## 4.2 iRacingReplayOverlay.net

仓库：[vipoo/iRacingReplayOverlay.net](https://github.com/vipoo/iRacingReplayOverlay.net)

调研时状态：

- 39 stars、22 forks；
- GPL-3.0；
- 已归档；
- 最后公开更新时间约 2023-01；
- .NET 项目。

主要能力：

- 采集 iRacing Replay；
- 转码录像并叠加排行榜和比赛状态；
- 输出完整比赛视频；
- 输出约 10 分钟精彩集锦；
- 尝试保留缠斗和事故、移除无聊片段。

对 Racing Memory 的价值：

- 是“遥测驱动自动集锦”最直接的早期实现之一；
- 可研究精彩片段的评分、合并和时长预算；
- 可研究 Overlay 在转码阶段叠加，而不是录制时叠加的方式；
- 可研究完整视频与 highlights 两种产物如何共享流程。

限制：

- 已归档，不宜作为新项目直接依赖；
- GPL-3.0；
- 基于旧 iRacing、旧 Windows 与旧媒体栈；
- 真实兼容性需要重新验证。

## 4.3 iRacingReplayDirector

仓库：[MerlinCooper/iRacingReplayDirector](https://github.com/MerlinCooper/iRacingReplayDirector)

调研时状态：

- 62 stars、15 forks；
- GPL-3.0；
- 是 ReplayOverlay.NET 的后继 fork；
- 创建于 2019 年。

主要能力：

- 分析 Replay 中的 spins、crashes 等事件；
- 采集赛道 scenic views；
- 生成排位介绍；
- 录制整场比赛；
- 生成完整视频和固定时长 highlight video；
- 自动叠加排行榜；
- 支持 OBS/NVIDIA 等外部录像软件。

可借鉴的算法问题：

- 如何给事故、缠斗、起步、冲线分配权重；
- 如何避免多个相邻事件生成重复片段；
- 如何在固定视频时长内选择事件；
- 如何插入开场、赛道镜头和结果画面；
- 如何根据 Replay 控制镜头，而不是只剪玩家视角。

对当前项目的启发：

Racing Memory 已有 `Highlight{At, WindowStart, WindowEnd, Score}`。下一步可以增加：

- `Subjects`：相关车辆或车手；
- `Severity`：事故严重度；
- `CameraHint`：推荐镜头；
- `NarrativeRole`：开场、转折、高潮、收尾；
- `DedupGroup`：合并同一连续事件；
- `Confidence`：遥测推断可信度。

## 4.4 Sim Steward

仓库：[simsteward/simhub-plugin](https://github.com/simsteward/simhub-plugin)

调研时状态：

- 2026-02 创建；
- C#、HTML、JavaScript、PowerShell；
- 调研时无 stars；
- 未找到明确许可证，按“不可直接复制”处理；
- 有大量提交，但仍属于较新的项目。

主要能力：

- iRacing Replay incident queue；
- 按 1x/2x/4x 严重度筛选；
- 点击事件直接跳转 Replay 帧；
- 按车手查看事故；
- 自动扫描整场或单车事故；
- 支持镜头组选择；
- 记录 60 Hz NDJSON replay incident index；
- 16× 快进扫描；
- Grafana Loki、OTLP、Prometheus 可观测性。

对 Racing Memory 的价值：

- 将“事件发现”和“事件媒体采集”拆成两个阶段；
- 先建立可重放、可人工确认的 incident index；
- 每个事件都可追踪状态、来源和采集结果；
- 适合借鉴未来的“精彩片段审核台”。

值得关注的缺口：

- 项目自己也把 OBS 集成列为未完成；
- 许可证不明确；
- 依赖 SimHub 插件环境，与我们的独立 Go companion 不同。

## 4.5 SimRace Publisher Studio

网站：[simracepublisher.com](https://simracepublisher.com/en/)

该项目不是开源参考，但产品形态与目标高度相似：

- 支持 iRacing、ACC、AC EVO、LMU；
- 支持 OBS、NVIDIA、AMD 或已有视频；
- 遥测驱动精彩识别；
- 自动生成视频、Shorts、缩略图和发布素材；
- 内置录像器与外部录像器都进入同一处理管线。

值得借鉴的产品决策：

- 不强制用户更换现有录像工具；
- 将“录像来源”与“后续分析”解耦；
- 同一会话同时输出长视频、短视频和封面；
- 支持纯视频导入，在没有遥测时降级工作。

这说明 Racing Memory 的产品方向具有真实需求，但也意味着应尽快明确差异：

- 更开源、更本地；
- 更专注个人回忆；
- 更轻量；
- 成绩卡、图片、视频一次生成；
- 不绑定发布平台。

## 5. iRacing SDK 与 `.ibt` 实现

## 5.1 mpapenbr/goirsdk

仓库：[mpapenbr/goirsdk](https://github.com/mpapenbr/goirsdk)

调研时状态：

- Go；
- MIT；
- 3 stars、1 fork；
- 2023-06 创建；
- 2026-03 仍有 push；
- 已发布约 20 个版本；
- 最新检索到的 release 为 `v0.10.0`；
- Go 1.22。

能力：

- Windows 实时 iRacing Telemetry API；
- Go module；
- telemetry variables；
- sample program；
- 持续发布和依赖更新。

对当前工程的价值：

- 与 Racing Memory 使用同一种语言和 Go 版本；
- 可对照 Windows mapping/event、重连和变量读取；
- 可以评估是否用成熟库替代自维护的底层 live reader。

建议做一次专门的 build-vs-buy 评估：

- 当前 `internal/racing/collector/iracing/wire` 的严格边界校验是否更强；
- `goirsdk` 是否支持 `.ibt`；
- 是否暴露动态 VarHeader、数组和 `countAsTime`；
- Windows reader 是否无 CGO；
- 重连、torn read 和 SessionInfo 更新如何处理；
- 引入依赖后许可证与维护收益是否值得。

在完成真实 Windows 验收前，不建议立即替换当前实现。

## 5.2 racedirector/iracing.rs

仓库：[racedirector/iracing.rs](https://github.com/racedirector/iracing.rs)

调研时状态：

- Rust workspace；
- 4 stars、2 forks；
- 2026-02 创建；
- 许可证未从本次结果中核实；
- issue 数量较多，仍在活跃建设。

主要模块：

- `iracing-irsdk`：底层 wire contract；
- `iracing-sdk`：`.ibt`、Session YAML、动态/类型化 adapter、Windows live；
- fixture tooling：确定性 `.ibt` 生成与 drift check；
- broadcast SDK；
- Simulation status probe；
- CLI 与 schema discovery。

这是当前最值得参考的协议测试架构：

- 解析器与业务投影分层；
- `.ibt` 和 live 共用 layout/frame；
- adapter 在 session 开始时预解析字段 ID；
- 测试 fixture 可确定性重建；
- fixture manifest 与 Git diff 做 drift gate；
- Windows 能力使用平台 gate。

对 Racing Memory 的直接映射：

- `wire` 对应我们的 `internal/racing/collector/iracing/wire`；
- `IbtFile` 对应 `internal/racing/collector/iracing/ibt`；
- adapter 对应 `Projector`；
- test-fixtures 对应当前合成 `.ibt`，但我们还缺 manifest 和 drift check；
- simulation probe 可用于未来 `racing-doctor`。

重要提醒：许可证未核实，不复制源码。

## 5.3 SVappsLAB/iRacingTelemetrySDK

仓库：[SVappsLAB/iRacingTelemetrySDK](https://github.com/SVappsLAB/iRacingTelemetrySDK)

技术栈：C#/.NET。

项目自述能力：

- live telemetry；
- `.ibt` playback；
- 同一 API 支持实时和离线；
- 200+ telemetry variables；
- 类型安全和代码生成；
- 动态变量访问；
- 异步流；
- 有界 buffer；
- metrics；
- pause/resume；
- 高吞吐。

最值得借鉴的不是语言，而是运行时设计：

- 采集线程不能被慢消费者阻塞；
- 有界缓冲区必须定义 drop/backpressure 策略；
- 每帧避免字符串 map 查找；
- 暴露 metrics 而不是静默丢包；
- live 和 replay 使用相同 consumer API。

当前 Racing Memory 的风险：

- Engine 做磁盘 fsync、OBS 和媒体操作时可能阻塞采集；
- iRacing 60 Hz 数据虽然降采样，但 collector 与 Engine 仍通过单 channel 串行；
- 还没有 telemetry packet rate、decode error、drop count 和 lag 指标。

## 5.4 kutu/pyirsdk

仓库：[kutu/pyirsdk](https://github.com/kutu/pyirsdk)

调研时状态：

- Python；
- MIT；
- 约 398 stars、64 forks；
- 创建于 2014；
- 社区使用时间较长。

主要能力：

- SessionInfo；
- live telemetry；
- camera/replay/chat/pit/telemetry broadcast commands；
- 简单的动态字段访问。

适合作为：

- 字段名称和单位的交叉验证来源；
- SessionInfo YAML 路径行为参考；
- broadcast 命令语义参考；
- 快速编写外部验证脚本的工具。

不建议用它作为主运行时依赖，因为当前工程是 Go，且实时采集仍需要 Windows Python 环境。

## 5.5 hotlap-ai/telemetry

仓库：[hotlap-ai/telemetry](https://github.com/hotlap-ai/telemetry)

调研时状态：

- TypeScript/Bun；
- MIT；
- 1 star；
- 2026-01 创建；
- npm 最新检索版本 `1.4.0`，发布于 2026-07；
- 支持 `.ibt` 和 Windows shared memory；
- 自带 WebSocket server。

价值：

- 现代 TypeScript API；
- live 和 `.ibt` 的统一模型；
- 可参考浏览器或 WebSocket 消费接口；
- canonical normalize 的演进值得关注。

风险：

- 项目较新、用户规模小；
- Bun/FFI 路径与 Go 实现不同；
- 需要检查性能测试和真实版本兼容证据。

## 5.6 quimcalpe/iracing-sdk

仓库：[quimcalpe/iracing-sdk](https://github.com/quimcalpe/iracing-sdk)

特点：

- Go；
- 支持 live 与 `.ibt`；
- 支持 Session YAML、导出、broadcast；
- 使用 CGO/MinGW 访问 Windows shared memory 与 event；
- 有 Dashboard 和 timing console 示例。

可参考：

- 早期 Go IRSDK API 设计；
- `WaitForData`；
- live/offline reader 抽象；
- broadcast message。

不建议直接采用：

- CGO 增加 Windows 构建和分发复杂度；
- 代码中存在 `log.Fatal` 等库层退出行为；
- 旧实现可能未覆盖现代数组和 360 Hz 字段。

## 5.7 ESilva15/goirsdk

仓库：[ESilva15/goirsdk](https://github.com/ESilva15/goirsdk)

能力：

- live telemetry；
- `.ibt`；
- YAML 导出；
- Mac/Linux 离线文件读取；
- Windows live。

README 中仍列出的缺口：

- count > 1 的变量未完整确认；
- bitField 支持未完成；
- broadcast 未完成；
- API 仍在演进。

这正好说明当前 Racing Memory 对数组、bitfield、边界检查和 fixture 的测试不能省略。

## 5.8 LeoAdamek/iracing.rs

仓库：[LeoAdamek/iracing.rs](https://github.com/LeoAdamek/iracing.rs)

调研时状态：

- Rust；
- MIT；
- 27 stars；
- crates.io 版本 `0.4.1`；
- 最后 crate 更新约 2020-12；
- 累计下载量超过 2 万。

适合参考旧版 Rust live telemetry、Session Data 和 setup file 接口，但维护时间较早，应谨慎对照现代 Header/变量。

## 5.9 其他实现

- [riccardotornesello/irsdk-go](https://github.com/riccardotornesello/irsdk-go)：Go 原型，README 明确称尚未 production-ready。
- [racedirector/iracing-data-api](https://github.com/racedirector/iracing-data-api)：MIT，TypeScript、OAuth、Zod schemas 与 OpenAPI，适合未来接历史比赛结果，不属于本地 telemetry。
- [racedirector/iracing-telemetry-services](https://github.com/racedirector)：gRPC telemetry server，可关注跨进程数据分发。

## 6. Dashboard、Overlay 与比赛工程师

## 6.1 OpenOverlay

网站：[OpenOverlay](https://ccarrascoalv.github.io/OpenOverlayWeb/)

项目声明：

- 免费开源；
- MIT；
- 本地运行；
- 无账号；
- 不上传 telemetry；
- 只读官方 telemetry；
- 不修改游戏文件或进程内存。

功能：

- relative、standings、delta、track map；
- fuel、tyres、flags、weather；
- incidents；
- cockpit；
- 自动隐藏；
- 回放/观战时跟随当前镜头车辆。

对 Racing Memory 的启发：

- “本地、只读、不上传、不碰游戏内存”是用户容易理解的安全承诺；
- UI 应明确显示当前采集状态；
- replay/spectating 与 driving 模式需要区分；
- units 应遵循 iRacing VarHeader 或允许用户覆盖。

## 6.2 iRacing Race Engineer Dashboard

仓库：[dntAtMe/iracing-dashboard](https://github.com/dntAtMe/iracing-dashboard)

调研结果：

- MIT；
- 浏览器 Dashboard；
- 手机或远程 race engineer 可访问；
- 60 Hz session recording；
- 赛后 replay、seek、lap jump、16× playback；
- fuel strategy、relative、standings、track map、tyres；
- 圈速对比与轨迹图。

值得参考：

- 高采样 telemetry 与圈级摘要同时保存；
- 同一份 session 数据支持 live 和 replay UI；
- 自动从第一条有效圈生成 track map；
- 赛后比较最多三圈；
- NAS/网络目录存储。

与 Racing Memory 的差异：

- 它偏实时工程师和分析；
- 我们偏自动成片与回忆；
- 可以把它的 session replay 思路用于未来“精彩片段确认”。

## 6.3 CrewChief

仓库：[mrbelowski/CrewChiefV4](https://github.com/mrbelowski/CrewChiefV4)

新主仓：项目已迁移至 GitLab。

调研时 GitHub 信息：

- MIT；
- 约 124 stars；
- 长期维护的多游戏比赛工程师。

能力：

- 燃油、轮胎、温度、损伤、差距；
- 最快圈、位置、剩余圈；
- 进攻/防守提示；
- 语音问答；
- 车手名语音；
- MQTT telemetry 输出；
- 支持多个模拟器。

对 Racing Memory 的价值：

- 多游戏规范化字段；
- 成熟的事件优先级与语音节流；
- “不要频繁打扰玩家”的事件合并策略；
- corner names 和 pace comparison；
- MQTT 可以作为未来兼容更多游戏的输入桥。

可选路线：

如果未来不想维护每个游戏 SDK，可以把 CrewChief MQTT 作为一种通用输入源。但这会引入外部程序依赖，并失去部分原始字段和精确时间控制。

## 6.4 RaceIQ

仓库：[SpeedHQ/RaceIQ](https://github.com/SpeedHQ/RaceIQ)

能力声明：

- 多游戏 live dashboard；
- lap recording；
- 3D car visualization；
- corner detection；
- lap comparison；
- AI coaching；
- setup/tune experiments；
- OBS/Streamlabs browser widgets；
- 本地数据库。

重要状态：

- 支持表把 iRacing 标记为 `High - Blocked`；
- README 其他位置又出现“自动检测 iRacing”的描述；
- 两处信息存在冲突，因此在真实 release 验证前，不应视为已经稳定支持 iRacing。

对 Racing Memory 的启发：

- AI 教练应建立在稳定 telemetry 和圈级分析之后；
- Streaming widget 与最终成片 Overlay 可共用模型；
- 调参实验和长期趋势属于另一条产品线，不宜过早扩张。

## 6.5 Atlas Racing

仓库：[DhruvGoswami10/AtlasRacing-Product](https://github.com/DhruvGoswami10/AtlasRacing-Product)

能力：

- F1、AC、ACC、ATS；
- 多种 Dashboard；
- AI Race Engineer；
- Whisper STT；
- TTS；
- LAN bridge；
- safety car、天气、轮胎等事件检测。

iRacing 状态：计划中，尚非已支持。

适合借鉴：

- bridge 与 UI 分离；
- LAN discovery；
- 事件广播引擎；
- AI 工程师作为可选层，不阻塞基础产品。

## 6.6 TinyPedal

仓库：[TinyPedal/TinyPedal](https://github.com/TinyPedal/TinyPedal)

特点：

- GPL-3.0-or-later；
- Windows/Linux；
- ACC、LMU、rFactor 2；
- 轻量可配置 Overlay；
- 燃油计算；
- 数据分析。

它不直接解决 iRacing，但对跨游戏 Overlay、小部件化 UI 和燃油算法有参考价值。

## 6.7 Lovely Dashboard

仓库：[Lovely-Sim-Racing/lovely-dashboard](https://github.com/Lovely-Sim-Racing/lovely-dashboard)

定位：

- SimHub Dashboard 与 Stream Overlay；
- 支持 iRacing、ACC、AC、AMS2、rFactor 2、LMU、F1、Forza、WRC 等；
- 统一视觉语言。

适合参考视觉信息层级和多游戏字段降级，但它依赖 SimHub，不是独立采集引擎。

## 6.8 RacePulse

仓库：[gAlexander77/racepulse-release](https://github.com/gAlexander77/racepulse-release)

公开能力：

- iRacing、ACC、AC、LMU、F1；
- 14 个实时 Overlay；
- VR Overlay；
- 自动检测游戏；
- 单 exe。

注意：仓库名称包含 `release`，本次未确认完整源代码和许可证。当前只能作为产品参考，不能按开源依赖处理。

## 7. 遥测分析与跨格式项目

## 7.1 i3rs

仓库：[Friss/i3rs](https://github.com/Friss/i3rs)

定位：

- Rust；
- 跨平台 MoTeC `.ld/.ldx`；
- 100MB+ 文件 mmap；
- 按需解码；
- min-max decimation；
- 多图同步；
- lap navigation；
- workspace/project；
- macOS、Windows、Linux。

对 Racing Memory 的价值：

- 大文件不应一次全部展开；
- 图表降采样必须保留峰值；
- 时间轴、缩放和 cursor 应在多个图之间同步；
- session/project 是比单文件更高层的组织方式。

## 7.2 ld-cli

仓库：[snipem/ld-cli](https://github.com/snipem/ld-cli)

技术栈：Go。

能力：

- 解析 MoTeC `.ld/.ldx`；
- laps、info、inspect、summarize；
- braking/throttle/tyre 分析；
- gear shift、刹车区、弯道、全油门区、锁死事件；
- lap diff 和 sector trend；
- HTML/ASCII report；
- LTTB downsampling；
- 面向 LLM 的 JSON 输出。

这是未来做“驾驶复盘”和“AI 总结”最值得研究的 Go 项目之一。

可借鉴：

- 将 raw channel、圈级摘要和分析事件分层；
- 为 LLM 提供压缩后的结构化事实，而不是整段高频 telemetry；
- 先做确定性指标，再让 LLM 解释；
- 让命令行输出可组合。

## 7.3 gotzl/ldparser

仓库：[gotzl/ldparser](https://github.com/gotzl/ldparser)

特点：

- Python；
- 逆向解析 MoTeC `.ld`；
- 最初面向 ACC；
- 可绘图；
- 不处理 `.ldx`。

适合用于交叉验证格式，不宜作为新架构基础。

## 7.4 TrackDataAnalysis

仓库：[racer-coder/TrackDataAnalysis](https://github.com/racer-coder/TrackDataAnalysis)

支持：

- AiM XRK；
- MoTeC LD；
- ECUMaster；
- VBOX；
- Race Technology；
- iRacing IBT；
- 多圈 Overlay；
- time slip；
- GPS map。

说明专业赛道数据分析的核心抽象通常是：

- session；
- lap；
- channel；
- sample rate；
- time/distance domain；
- aligned comparison；
- metadata。

Racing Memory 当前 model 偏“成绩单”，如果未来做深度分析，应单独建立 telemetry analytics model，不要继续往 `model.Session` 塞所有高频字段。

## 7.5 B4mad Racing

仓库：[b4mad/racing](https://github.com/b4mad/racing)

调研时状态：

- GPL-3.0；
- 约 30 stars；
- CrewChief MQTT 作为入口；
- InfluxDB 与 Pitwall 分析。

价值：

- 通过 CrewChief 获得多游戏覆盖；
- telemetry pipeline 与可视化解耦；
- 时序数据库适合长期趋势。

风险：

- 依赖云/数据库栈较重；
- 与当前本地单用户产品不一致；
- 隐私模型需要额外关注。

## 8. 可复用架构模式

## 8.1 Live 与 Offline 共用 Frame

成熟 SDK 往往把数据源分成：

```text
WindowsSharedMemory ─┐
                     ├─ Layout + Frame ─ Adapter ─ DomainEvent
IBTReader ───────────┘
```

这是 Racing Memory 当前采用的正确方向：

- `wire`：Header、VarHeader、类型和边界；
- `ibt`：离线 source；
- `reader_windows`：实时 source；
- `Projector`：字段投影和事件差分；
- `session.Event`：跨游戏领域事件。

后续不要让 live 与 `.ibt` 各自维护一套变量语义。

## 8.2 先建事件索引，再做媒体

ReplayDirector 与 Sim Steward 都表明，媒体生成前应有稳定事件索引：

```text
Telemetry
  -> Candidate Events
  -> Deduplicate / Merge
  -> Score
  -> Human Review optional
  -> Capture / Clip
  -> Compose Story
```

当前 Racing Memory 的 `Highlight` 只有基础窗口和分数。建议逐步增加：

- 事件来源；
- 相关车辆；
- 可信度；
- 严重度；
- 事件组；
- 镜头建议；
- 是否已人工确认；
- 捕获状态；
- 成片使用状态。

## 8.3 高频数据与圈级摘要分离

高频 telemetry 适合：

- 压缩块；
- mmap；
- Parquet/Arrow；
- 独立二进制；
- 时序数据库。

成绩单和 API 适合：

- session metadata；
- lap summaries；
- highlights；
- classification；
- artifact manifest。

不要把 60 Hz/360 Hz 每个字段都写进主 `session.json`。

## 8.4 确定性分析优先于 AI

建议顺序：

1. 确定性事件检测；
2. 圈/分段统计；
3. 时间线和证据；
4. 结构化摘要；
5. LLM 解释、标题和旁白。

AI 不应直接读取未经压缩的整场 telemetry，也不应决定基础圈速或排名事实。

## 8.5 本地隐私是明确卖点

OpenOverlay、Dove’s DataViewer 等项目都把 local-first 作为核心价值。

Racing Memory 可以明确承诺：

- 默认不上传；
- 不注入游戏进程；
- 不控制车辆；
- 不公开其他会员身份；
- 本地可删除；
- 导出前展示包含内容；
- 云功能必须显式 opt-in。

## 9. 与当前项目的能力对照

| 领域 | 当前 Racing Memory | 可参考项目 | 下一步 |
| --- | --- | --- | --- |
| IRSDK wire | 已实现 Header/VarHeader/Frame | iracing.rs、goirsdk、pyirsdk | 用真实 `.ibt` 和 Windows 抓包做兼容验证 |
| `.ibt` | 已支持合成 fixture 和导入 | Doves、iracing.rs、hotlap-ai | 增加真实脱敏 fixture manifest |
| 多游戏 | iRacing/F1/ACC | CrewChief、RaceIQ、Atlas | 保持 adapter 边界，不急于增加游戏 |
| 精彩识别 | 最佳圈、超车、事故、冲线 | ReplayDirector、Sim Steward | 增加事件合并、严重度和故事结构 |
| 视频 | OBS Replay Buffer + FFmpeg | Doves、ReplayDirector | 时间轴校准、镜头控制、横竖版模板 |
| 图片 | 成绩卡和视频帧 | SimRace Publisher | 封面模板、赛道地图和事件卡 |
| 深度分析 | 基础圈级信息 | ld-cli、i3rs、Doves | 独立 analytics model |
| Overlay | 仅成片叠层 | OpenOverlay、Lovely | 先服务成片，不与实时 Overlay 正面竞争 |
| AI | 尚未接入 | RaceIQ、Atlas、ld-cli | 先生成确定性摘要，再加可选 AI |
| 隐私 | 本地、API 脱敏 | OpenOverlay、Doves | 增加 retention、删除和诊断导出 |

## 10. 产品空白与差异化机会

## 10.1 “一场比赛，一份回忆”

现有工具多数要求用户主动分析图表、配置 Overlay 或手工处理 Replay。

Racing Memory 可以做到：

1. 自动识别本场比赛；
2. 自动保存数据和录像；
3. 自动选择最佳圈、超车、事故和冲线；
4. 自动生成成绩卡；
5. 自动生成几张精彩图片；
6. 自动生成 2～4 分钟视频；
7. 用户只负责查看、删除或导出。

## 10.2 玩家视角，而不是直播转播视角

ReplayDirector 偏全场转播。Racing Memory 可以强调：

- 我的最佳圈；
- 我的关键超车；
- 我的事故与恢复；
- 我的名次变化；
- 我的组别成绩；
- 我的赛季回忆。

## 10.3 轻量、开源、本地

避免早期引入：

- 账号体系；
- 云数据库；
- 社区排行榜；
- 复杂 AI；
- 全套实时 Overlay；
- 自动发布平台。

先把本地闭环做可靠。

## 10.4 结构化故事

精彩视频不应只是按分数拼接片段，可以使用简单叙事结构：

```text
开场：赛道、车辆、发车位
发展：第一圈、追赶、进站
高潮：最佳超车、事故、最佳圈
结尾：冲线、最终名次、成绩卡
```

这会比单纯“Top N 事件”更接近回忆产品。

## 11. 推荐深入阅读顺序

### 第一组：校验 iRacing 协议

1. [mpapenbr/goirsdk](https://github.com/mpapenbr/goirsdk)
2. [racedirector/iracing.rs](https://github.com/racedirector/iracing.rs)
3. [kutu/pyirsdk](https://github.com/kutu/pyirsdk)
4. [SVappsLAB/iRacingTelemetrySDK](https://github.com/SVappsLAB/iRacingTelemetrySDK)
5. [hotlap-ai/telemetry](https://github.com/hotlap-ai/telemetry)

目标：

- 对照 Header/VarHeader；
- 对照 buffer 选择与 torn read；
- 对照 SessionInfo 更新；
- 对照数组和 360 Hz；
- 对照 `.ibt` 截断；
- 收集合法 fixture 策略。

### 第二组：研究精彩算法

1. [iRacingReplayDirector](https://github.com/MerlinCooper/iRacingReplayDirector)
2. [iRacingReplayOverlay.net](https://github.com/vipoo/iRacingReplayOverlay.net)
3. [Sim Steward](https://github.com/simsteward/simhub-plugin)

目标：

- 事故检测；
- 缠斗检测；
- 事件合并；
- 固定时长预算；
- Replay 跳转和镜头；
- 人工确认工作流。

### 第三组：研究视频与分析体验

1. [Dove’s DataViewer](https://github.com/TheAngryRaven/DovesDataViewer)
2. [iRacing Race Engineer Dashboard](https://github.com/dntAtMe/iracing-dashboard)
3. [ld-cli](https://github.com/snipem/ld-cli)
4. [i3rs](https://github.com/Friss/i3rs)

目标：

- 视频/遥测对齐；
- 圈速和线路比较；
- 数据降采样；
- 生成报告；
- 高采样文件处理。

### 第四组：研究产品与视觉

1. [OpenOverlay](https://ccarrascoalv.github.io/OpenOverlayWeb/)
2. [Lovely Dashboard](https://github.com/Lovely-Sim-Racing/lovely-dashboard)
3. [RaceIQ](https://github.com/SpeedHQ/RaceIQ)
4. [Atlas Racing](https://github.com/DhruvGoswami10/AtlasRacing-Product)
5. [SimRace Publisher Studio](https://simracepublisher.com/en/)

目标：

- 信息层级；
- 多游戏字段降级；
- 用户首次运行；
- 录像来源兼容；
- AI 功能边界；
- 商业产品差异化。

## 12. 许可证注意事项

| 项目 | 调研到的许可证 | 处理建议 |
| --- | --- | --- |
| DovesDataViewer | GPL-3.0-or-later | 可研究设计；复制代码会影响衍生项目分发许可 |
| iRacingReplayOverlay.net | GPL-3.0 | 已归档；不建议直接依赖 |
| iRacingReplayDirector | GPL-3.0 | 算法可重新设计；复制代码需遵守 GPL |
| mpapenbr/goirsdk | MIT | 可评估依赖或引用，保留版权声明 |
| pyirsdk | MIT | 可用于交叉验证与脚本 |
| hotlap-ai/telemetry | MIT | 可参考现代 API，保留声明 |
| LeoAdamek/iracing.rs | MIT | 版本较老，注意兼容性 |
| CrewChief | MIT | 主仓已迁移，核对新仓许可证 |
| B4mad Racing | GPL-3.0 | 架构参考，复制需遵守 GPL |
| TinyPedal | GPL-3.0-or-later | Overlay 设计参考 |
| racedirector/iracing.rs | 未核实 | 不复制源码，先确认 LICENSE |
| Sim Steward | 未核实 | 不复制源码，先确认 LICENSE |
| RacePulse release | 未核实是否完整开源 | 只作为产品参考 |
| SimRace Publisher | 非开源产品参考 | 不使用其实现 |

即使代码许可证允许，也不代表 iRacing telemetry 数据可以任意上传、出售或公开。必须分开检查：

- SDK 源码许可证；
- iRacing EULA；
- 第三方开发说明；
- 会员身份与 `custid`；
- `.ibt` 再分发；
- 商业使用；
- 云端处理。

## 13. 对 Racing Memory 的具体建议

### 13.1 短期

1. 用真实脱敏 `.ibt` 对照 `goirsdk`、`iracing.rs`、`pyirsdk` 的输出。
2. 为 fixture 增加 manifest、来源、SDK 版本和预期摘要。
3. 增加录像时间校准文件，记录 telemetry time 与 video PTS 的锚点。
4. 扩展 Highlight 模型，支持事件合并和可信度。
5. 增加“最佳圈、事故、超车、冲线”人工审核 JSON。
6. 建立 Windows 实机 smoke checklist。

### 13.2 中期

1. 研究 Replay broadcast 控制和镜头选择。
2. 增加 track map、位置变化和比赛时间线。
3. 增加多模板：横版集锦、竖版短视频、静态长图。
4. 增加确定性圈速/驾驶摘要。
5. 支持保留成绩单、删除原视频的隐私策略。

### 13.3 延后

1. AI 语音旁白；
2. 自动发布 YouTube/视频号；
3. 云端排行榜；
4. 实时 Overlay 大而全；
5. 更多游戏适配器；
6. 复杂社交体系。

## 14. 关键来源

### iRacing 与 SDK

- [iRacing 官方 SDK 论坛入口](https://forums.iracing.com/discussion/62/iracing-sdk/p1)
- [iRacing 第三方开发说明](https://support.iracing.com/support/solutions/articles/31000179757-third-party-development-please-review-the-iracing-terms)
- [iRacing Terms / EULA](https://ir-core-sites.iracing.com/members/pdfs/20261022-iRacing_Terms_of_Use_and_EULA_dated_Oct_22_2026.pdf)
- [ATLAS Telemetry Quickstart](https://ir-core-sites.iracing.com/members/atlas/atlas_quickstart.pdf)

### 与本项目最相似

- [Dove’s DataViewer](https://github.com/TheAngryRaven/DovesDataViewer)
- [iRacingReplayOverlay.net](https://github.com/vipoo/iRacingReplayOverlay.net)
- [iRacingReplayDirector](https://github.com/MerlinCooper/iRacingReplayDirector)
- [Sim Steward](https://github.com/simsteward/simhub-plugin)
- [SimRace Publisher Studio](https://simracepublisher.com/en/)

### SDK 与解析

- [mpapenbr/goirsdk](https://github.com/mpapenbr/goirsdk)
- [racedirector/iracing.rs](https://github.com/racedirector/iracing.rs)
- [SVappsLAB/iRacingTelemetrySDK](https://github.com/SVappsLAB/iRacingTelemetrySDK)
- [kutu/pyirsdk](https://github.com/kutu/pyirsdk)
- [hotlap-ai/telemetry](https://github.com/hotlap-ai/telemetry)
- [quimcalpe/iracing-sdk](https://github.com/quimcalpe/iracing-sdk)
- [ESilva15/goirsdk](https://github.com/ESilva15/goirsdk)
- [LeoAdamek/iracing.rs](https://github.com/LeoAdamek/iracing.rs)

### Dashboard 与比赛工程师

- [OpenOverlay](https://ccarrascoalv.github.io/OpenOverlayWeb/)
- [iRacing Race Engineer Dashboard](https://github.com/dntAtMe/iracing-dashboard)
- [CrewChief](https://github.com/mrbelowski/CrewChiefV4)
- [RaceIQ](https://github.com/SpeedHQ/RaceIQ)
- [Atlas Racing](https://github.com/DhruvGoswami10/AtlasRacing-Product)
- [TinyPedal](https://github.com/TinyPedal/TinyPedal)
- [Lovely Dashboard](https://github.com/Lovely-Sim-Racing/lovely-dashboard)

### 数据分析

- [i3rs](https://github.com/Friss/i3rs)
- [ld-cli](https://github.com/snipem/ld-cli)
- [ldparser](https://github.com/gotzl/ldparser)
- [TrackDataAnalysis](https://github.com/racer-coder/TrackDataAnalysis)
- [B4mad Racing](https://github.com/b4mad/racing)

## 15. 维护方式

建议每两个月更新一次本文件：

1. 检查重点仓库是否归档；
2. 检查许可证是否变化；
3. 记录最新 release；
4. 检查 iRacing SDK/Header 变化；
5. 检查项目是否真正支持 iRacing，而不是仍在 roadmap；
6. 更新 Racing Memory 的能力对照；
7. 新增已验证的设计结论；
8. 删除无法复现或已经失效的结论。

所有从外部项目吸收的实现都应在代码评审中记录：

- 来源链接；
- 许可证；
- 是否复制代码或只借鉴思想；
- 兼容版本；
- 本地测试证据；
- 与 iRacing 条款的关系。
