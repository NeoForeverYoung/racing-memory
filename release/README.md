# Racing Memory Windows 便携版

1. 下载 `RacingMemory-win11-x64-2026-11-09.zip`。
2. 校验 `SHA256SUMS.txt`（可选），然后完整解压。
3. 双击解压目录中的 `RacingMemory.exe`。

压缩包已包含 Racing Memory UI、本地 CLI、FFmpeg、ffprobe、赛道和绘图资源，无需另行安装上述组件。适用于 Windows 11 x64；Windows 11 ARM 可通过系统自带的 x64 兼容层运行。

**不含 OBS Studio。** 录制比赛前请单独安装 [OBS Studio](https://obsproject.com/)，在 OBS 里启用 WebSocket 服务器（常见端口 `4455`），并在 Racing Memory「设置」中填写对应地址。应用首页会显示 OBS 是否已安装、WebSocket 是否在线。

首次运行若出现 Windows SmartScreen 提示，请确认文件来自本仓库后选择“更多信息”→“仍要运行”。不要直接在 ZIP 内运行程序。
