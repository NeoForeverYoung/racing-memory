# Racing Memory

本地赛车回忆生成工具。优先支持 iRacing，同时采集 F1 与 Assetto Corsa Competizione 的官方遥测，自动生成成绩单、精彩视频和图片，并提供只读 HTTP API。

## 功能

- iRacing Windows IRSDK 实时共享内存
- macOS/Windows/Linux 离线导入 iRacing `.ibt`
- F1 2025/2026 UDP 遥测
- ACC Windows Shared Memory
- 圈速、排名、最佳圈、超车和冲线识别
- OBS Replay Buffer 自动保存
- FFmpeg 视频裁剪、叠层、拼接和截图
- JSON、HTML、PNG 成绩单
- 本地会话查询与产物下载 API

详细架构和 Windows 配置见 [docs/racing-memories.md](docs/racing-memories.md)。

相关开源项目、许可证、技术路线和产品差异调研见 [docs/open-source-landscape.md](docs/open-source-landscape.md)。

## 依赖

- Go 1.22+
- FFmpeg / ffprobe
- Windows 10/11（iRacing/ACC 实时采集）
- OBS 30+，启用 WebSocket 与 Replay Buffer

## 快速验证

```bash
make test
make demo
```

`make demo` 会生成无版权测试视频和合成遥测，并在 `racing-demo-data/` 下产出成绩单、精彩视频和图片。

Mac 上没有游戏也可以运行全部解析测试，并导入 `.ibt`：

```bash
make import-ibt FILE=/path/to/session.ibt
```

`.ibt` 默认只在本地处理，不上传；同一 iRacing 外部会话不会重复导入。

## 运行

复制并修改配置：

```bash
cp configs/racing.example.json configs/racing.local.json
export RACING_OBS_PASSWORD='你的 OBS WebSocket 密码'
go run ./cmd/racing-companion -config configs/racing.local.json
```

默认 API 地址：`http://127.0.0.1:8090`。

```bash
curl http://127.0.0.1:8090/v1/racing/sessions
```

## Windows 构建

```bash
make build-windows
```

输出：`build/racing-companion.exe`。

实时 iRacing 使用官方 SDK 共享内存，不注入游戏进程、不控制车辆。公开分发会员遥测、云端上传或商业化前，应重新审查 iRacing 条款并取得必要许可。
