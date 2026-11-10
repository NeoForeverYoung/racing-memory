# Racing Memory Windows 用户指南

Racing Memory 是一款本地运行的 iRacing 赛后整理与复盘工具。它可以读取
iRacing 的 `.ibt` 遥测文件，生成成绩单、离线报告和训练建议；提供比赛录像时，
还可以生成 Racing Memory Reel、最快完整圈和 OPT 合成圈。

遥测、录像和分析都留在你的电脑上，不会上传到服务器。

## 1. 运行条件

- Windows 11 x64；Windows 11 ARM 也可通过系统自带的 x64 兼容层运行。
- 建议至少预留 10 GB 可用空间。长时间录像及生成的视频可能占用更多空间。
- Microsoft Edge WebView2。Windows 11 通常已经自带，无需单独安装。

便携包已经包含 Racing Memory、本地分析引擎、FFmpeg、ffprobe、赛道数据和
LapWing 分析页面。普通用户**不需要**安装 Bun、Node.js、Rust、Python 或 FFmpeg。

以下软件按使用方式选择安装：

| 使用方式 | iRacing | OBS Studio |
| --- | --- | --- |
| 导入已有 `.ibt`，生成成绩单和报告 | 不需要正在运行 | 不需要 |
| 导入 `.ibt` 和已有录像，生成完整视频 | 不需要正在运行 | 不需要 |
| 自动录制下一场比赛 | 需要 | 需要单独安装 |

## 2. 下载与启动

1. 下载 `RacingMemory-win11-x64.zip`。
2. 在文件资源管理器中右键 ZIP，选择“全部解压”。不要直接在 ZIP 压缩包内运行。
3. 保留解压目录中的所有文件，不要只复制 `RacingMemory.exe`。
4. 双击 `RacingMemory.exe`。

首次运行如果 Windows SmartScreen 显示“Windows 已保护你的电脑”，请先确认文件
来自项目的正式发布页，然后选择“更多信息”→“仍要运行”。

可选：在 PowerShell 中校验下载文件。计算结果应与发布页提供的 `.sha256` 文件一致：

```powershell
Get-FileHash .\RacingMemory-win11-x64.zip -Algorithm SHA256
```

## 3. 首次设置

打开左侧“设置”，填写：

1. **Racing Memory 数据目录**

   用于保存 Session、归档后的 IBT、成绩单、报告和生成的视频。建议选择空间充足、
   不受 OneDrive 同步影响的本机目录，例如 `D:\RacingMemoryData`。
2. **iRacing IBT 目录**

   默认通常是 `%USERPROFILE%\Documents\iRacing\telemetry`。
3. **OBS WebSocket 地址**

   只在自动录制时需要，通常填写 `ws://127.0.0.1:4455`。

点击“保存本地设置”。首页的状态卡会显示本地引擎、OBS、iRacing telemetry 和数据目录
是否就绪。

## 4. 最简单的用法：导入已有 IBT

1. 在首页找到“从 IBT 和录像重新生成”。
2. 点击“IBT 文件路径”右侧的“浏览…”，选择一个 `.ibt` 文件。
3. 录像留空。
4. 选择“成绩单与报告”。
5. 点击“创建 Session 并生成”。
6. 等待进度页完成，应用会自动进入 Session Result。

结果通常包括：

- 一张 PNG 赛后成绩单；
- 一份可离线打开的 HTML 赛后报告；
- 圈速、赛道与驾驶建议数据；
- “在 LapWing 中深度分析”入口。

## 5. 导入 IBT 和录像

录像必须来自同一场 iRacing Session。

1. 选择 `.ibt` 文件。
2. 选择对应的录像文件。
3. 选择“完整视频交付”。
4. 如果应用无法从文件时间可靠判断同步关系，会显示确认项。只有确认两份文件确实属于
   同一场比赛，并准备在 LapWing 中复核时间轴时，才勾选继续生成。
5. 点击“创建 Session 并生成”，保持应用打开直到完成。

除成绩单和报告外，完整模式还会生成：

- Racing Memory Reel；
- 最快完整圈视频；
- OPT 最佳区间合成圈。

视频编码可能需要数分钟。时长取决于录像长度、分辨率、硬盘速度和 CPU；处理大型录像时
进度暂时停留在某个阶段并不一定代表程序卡死。

原始录像不会复制到 Racing Memory 数据目录。Session 只保存它的路径，因此如果之后
移动、重命名或删除原始录像，LapWing 回放和重新生成视频可能无法使用该录像。

## 6. 自动录制下一场比赛

### 6.1 安装和设置 OBS

1. 从 [OBS 官网](https://obsproject.com/)安装 OBS Studio。
2. 在 OBS 中设置要录制的游戏画面和录制保存目录。
3. 打开“工具”→“WebSocket 服务器设置”。
4. 启用 WebSocket 服务器，端口建议保留 `4455`。
5. 如果设置了密码，每次在 Racing Memory 首页“准备录制”前输入；密码不会保存。

### 6.2 启用 iRacing 遥测

临时启用：进入赛车后按 `Alt + L`，看到 iRacing 画面出现 `Telemetry` 提示即表示
正在写入 IBT。每次进入新的 Session 都需要重新启用。

建议永久启用：

1. 完全退出 iRacing。
2. 用记事本打开 `%USERPROFILE%\Documents\iRacing\app.ini`。
3. 查找并设置：

```ini
irsdkEnableDisk=1
irsdkAutoLogDisk=1
irsdkLimitFileSize=0
```

4. 保存文件后重新启动 iRacing。

### 6.3 开始录制

1. 先启动 OBS，并确认 Racing Memory 首页显示 OBS 已连接。
2. 在 Racing Memory 首页点击“准备录制”。
3. 启动或加入 iRacing Session。
4. Racing Memory 会等待 iRacing 状态，在比赛开始后控制 OBS 录制，并在结束后等待
   IBT 与录像写入完成。
5. 完成后自动创建新的本地 Session 并生成产出物。

## 7. 查看和管理结果

- “历史 Session”列出所有已保存的比赛。
- Session Result 可打开成绩单、完整报告、生成视频和交付目录。
- “在 LapWing 中深度分析”会用默认浏览器打开本机 `127.0.0.1` 临时页面，展示地图、
  圈速、遥测曲线和同步录像；这不是互联网服务器，不会上传文件。
- “重新扫描目录”可以在 Registry 损坏或手动恢复 Session 文件夹后重建列表。

## 8. 常见问题

### 本地引擎显示“需修复”

不要只复制主程序。重新下载并完整解压 ZIP，确保 `RacingMemory.exe`、
`lapwing-x86_64-pc-windows-msvc.exe`、`ffmpeg.exe`、`ffprobe.exe` 和
`web-analysis` 文件夹仍在同一目录。检查杀毒软件是否隔离了其中的文件。

### OBS 无法连接

- 确认 OBS 已启动；
- 确认 OBS WebSocket 已启用；
- 地址和端口通常为 `ws://127.0.0.1:4455`；
- 确认密码正确；
- 不要把 `ws://` 写成 `http://`。

### 找不到 IBT

- 确认 iRacing 内已经启用 telemetry logging；
- 检查 `%USERPROFILE%\Documents\iRacing\telemetry`；
- 等待退出赛车或记录结束，确保 iRacing 已完成文件写入；
- 不要导入仍在增长的 `.ibt` 文件。

### “完整视频交付”不可选

必须先选择录像文件。没有录像时只能生成成绩单和报告。

### 同步置信度较低

这通常表示 IBT 和录像的文件时间不足以证明它们属于同一时间轴。不要随意勾选继续；
先确认它们来自同一场比赛，生成后再进入 LapWing 复核录像与遥测是否对齐。

### 点击 LapWing 后浏览器打不开

允许 Racing Memory 和默认浏览器访问本机回环地址 `127.0.0.1`。不要把临时链接复制到
另一台电脑；链接只在当前电脑和当前应用运行期间有效。

## 9. 更新与卸载

更新时：

1. 关闭 Racing Memory。
2. 下载并解压新版本到一个新目录。
3. 启动新版本；原来的数据目录可以继续使用。

卸载时删除解压后的程序目录即可。若还要删除设置，可删除
`%APPDATA%\RacingMemory`。比赛历史和产出物位于你在设置中选择的 Racing Memory
数据目录，只有确认不再需要时才手动删除。

## 10. 隐私说明

Racing Memory 的核心流程离线运行。IBT、录像、Session、成绩单和报告保存在本机。
打开 LapWing 深度分析时使用的也是本机临时服务。请像管理普通比赛录像一样备份重要的
Session 数据目录。
