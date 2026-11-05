# 游戏 Adapter 接入指南

LapWing 的游戏支持通过 `@lapwing/game-adapter-kit` 接入。Adapter 只负责把官方
文件或 live 协议转换为 canonical telemetry；UI、成绩单、媒体和教练逻辑不得识别
游戏专有字段。

## Fixture-first 门禁

开始实现前必须提交：

1. 协议名称、版本和官方来源链接；
2. 可再分发或脱敏的最小 golden fixture；
3. capability matrix；
4. 文件检测和解析测试；有 live 协议时还需生命周期测试；
5. 缺字段降级测试；
6. CLI SessionBundle smoke test。

模板：

```ts
import type { GameAdapter } from "@lapwing/game-adapter-kit";
import { validateAdapterFixture } from "@lapwing/game-adapter-kit";

export const adapter: GameAdapter = {
  id: "game-id",
  displayName: "Game name",
  capabilities: ["telemetry.file", "telemetry.track-progress"],
  async detectFile(input) {
    // 只使用稳定 magic/version；不能只相信扩展名。
    return input.extension === ".example";
  },
  async parseFile(input) {
    // 将 fixture 转为 CanonicalSession。
    throw new Error(`Not implemented: ${input.name}`);
  },
};

// 每个 fixture 都执行该共享契约。
validateAdapterFixture(session, {
  spatial: "track",
  gameLaps: true,
  racePosition: false,
  incidents: false,
});
```

## Capability matrix

每个 adapter 的 README 必须填写：

- file / live；
- session clock；
- geo / world / track progress；
- game-provided laps；
- race / class position；
- incidents；
- pit state；
- driver / vehicle / track metadata。

没有 GPS 时不得制造经纬度，地图、天气和几何赛道检测应隐藏。没有 incidents 或
position 时，Racing Memory 只生成有证据的片段。

## 路线图

后续按独立编号计划推进：

1. F1：优先官方、版本化 UDP；
2. Forza：Data Out；
3. Dirt Rally 2.0：先核验可合法依赖的稳定协议和 fixture；
4. WRC Generations：先核验可合法依赖的稳定协议和 fixture；
5. 原生协议不足时，新增独立 SimHub/JSONL bridge adapter。

iRacing 是 reference adapter。F1 25 的 versioned raw `.f1udp` capture 可由 Windows companion 本地写入并离线重放；官方文档覆盖的 Motion、Session、Lap、Event、Participants、Car Telemetry packet 已有 decoder 与 canonical mapping。真实游戏 capture 仍是 lifecycle/OBS 与发布验收门禁。以上游戏在协议与 fixture 就绪前不进入 core，也不通过猜测字段实现。
# 模拟赛车游戏 Adapter

LapWing 通过 `@lapwing/game-adapter-kit` 隔离游戏协议，通过
`@lapwing/telemetry-core` 输出统一会话。当前生产级 adapter 是 iRacing。

## Capability matrix

| 游戏 | 文件 | 实时 | 空间模型 | 圈时 | 比赛事件 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| iRacing | IBT | IRSDK shared memory | GPS + track progress | 游戏/几何 | 名次、incident、pit | 已实现 |
| F1 | 待定 | 官方版本化 UDP | 待 fixture 核验 | 待核验 | 待核验 | 下一优先级 |
| Forza | 待定 | Data Out | world/待核验 | 待核验 | 待核验 | 后续 |
| Dirt Rally 2.0 | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 | 研究阶段 |
| WRC Generations | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 | 研究阶段 |

“待核验”表示仓库没有可信 fixture 或协议证据，不代表游戏一定不支持。

## 后续路线

1. F1：按游戏年份/协议版本分别保存 UDP golden fixture；
2. Forza：验证 Data Out 字段、更新频率和赛道位置表达；
3. Dirt Rally 2.0 / WRC Generations：先确认官方或稳定社区协议；
4. 无稳定原生接口时，另建 SimHub/JSONL bridge，不把第三方字段混入 core。

每款游戏都应建立独立编号计划，并按
`packages/game-adapter-kit/template/README.md` 的 fixture-first 门禁接入。
