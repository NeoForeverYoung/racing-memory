import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Wrench } from "lucide-react";
import { useSessionContext } from "@/contexts/SessionContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";

export const ToolsTab = memo(function ToolsTab() {
  const { data, laps, selectedLapNumber, course, activeSnapshot, sessionSetup } = useSessionContext();
  const { useKph } = useSettingsContext();

  return (
    <PluginPanelHost
      slot={PanelSlot.Tools}
      data={data}
      laps={laps}
      selectedLapNumber={selectedLapNumber}
      course={course}
      useKph={useKph}
      sessionSetup={sessionSetup}
      activeSnapshot={activeSnapshot}
      fallback={<ToolsEmpty />}
    />
  );
});

function ToolsEmpty() {
  const { t } = useTranslation("session");
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <Wrench className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">{t("tabs.tools")}</p>
        <p className="text-xs text-muted-foreground">
          {t("pluginMissing.toolsBody")}
        </p>
      </div>
    </div>
  );
}
