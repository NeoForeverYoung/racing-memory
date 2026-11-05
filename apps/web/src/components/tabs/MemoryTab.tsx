import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Film } from "lucide-react";
import { useSessionContext } from "@/contexts/SessionContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";

export const MemoryTab = memo(function MemoryTab() {
  const { data, laps, selectedLapNumber, course, activeSnapshot, sessionSetup } = useSessionContext();
  const { useKph } = useSettingsContext();

  return (
    <PluginPanelHost
      slot={PanelSlot.Memory}
      data={data}
      laps={laps}
      selectedLapNumber={selectedLapNumber}
      course={course}
      useKph={useKph}
      sessionSetup={sessionSetup}
      activeSnapshot={activeSnapshot}
      fallback={<MemoryEmpty />}
    />
  );
});

function MemoryEmpty() {
  const { t } = useTranslation("session");
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm space-y-3 px-4 text-center">
        <Film className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">{t("pluginMissing.memoryTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("pluginMissing.memoryBody")}</p>
      </div>
    </div>
  );
}
