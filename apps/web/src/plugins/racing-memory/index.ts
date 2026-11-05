import { lazy } from "react";
import { Film } from "lucide-react";
import type { DataViewerPlugin } from "@/plugins/types";
import { PANELS_POINT, PanelSlot, type PluginPanel } from "@/plugins/panels";

const MemoryPanel = lazy(() =>
  import("./MemoryPanel").then((module) => ({ default: module.MemoryPanel })),
);

const plugin: DataViewerPlugin = {
  id: "racing-memory",
  name: "Racing Memory",
  version: "0.1.0",
  setup(ctx) {
    ctx.registry.contribute(PANELS_POINT, {
      id: "racing-memory-highlights",
      title: "panels.racingMemory",
      slot: PanelSlot.Memory,
      order: 0,
      icon: Film,
      component: MemoryPanel,
    } satisfies PluginPanel);
  },
};

export default plugin;
