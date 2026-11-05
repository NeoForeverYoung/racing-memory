# Game adapter template

新游戏必须从可审计 fixture 开始，不能根据游戏名称猜协议。

## 必需文件

```text
packages/game-adapter-<id>/
  package.json
  src/index.ts
  src/parser.ts
  src/parser.test.ts
  fixtures/README.md
  fixtures/<sanitized-golden-file>
```

`fixtures/README.md` 必须记录：

- 游戏及精确版本；
- 协议来源和链接；
- 采集方法；
- fixture 的脱敏方式和许可证；
- 已知缺失字段。

## 实施顺序

1. 填 capability matrix；
2. 保存最小 golden fixture；
3. 实现 `detectFile` / `parseFile` 或 `watchLifecycle`；
4. 使用 `validateAdapterFixture()` 验证 canonical session；
5. 增加缺 GPS、缺圈速、缺车辆/赛道字段的降级测试；
6. 增加 `SessionBundle` 和 CLI smoke test；
7. 最后才接 UI。

Adapter 只能输出它真实提供的 capability。无 GPS 时使用 `world`、
`track-progress` 或无空间数据，禁止伪造经纬度。
