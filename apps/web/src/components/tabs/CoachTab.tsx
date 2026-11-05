import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { useSessionContext } from "@/contexts/SessionContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";

export const CoachTab = memo(function CoachTab() {
  const { data, laps, selectedLapNumber, course, activeSnapshot, sessionSetup } = useSessionContext();
  const { useKph } = useSettingsContext();

  return (
    <PluginPanelHost
      slot={PanelSlot.Coach}
      data={data}
      laps={laps}
      selectedLapNumber={selectedLapNumber}
      course={course}
      useKph={useKph}
      sessionSetup={sessionSetup}
      activeSnapshot={activeSnapshot}
      fallback={<CoachEmpty />}
    />
  );
});

function CoachEmpty() {
  const { t } = useTranslation("session");
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <Gauge className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">{t("pluginMissing.coachTitle")}</p>
        <p className="text-xs text-muted-foreground">
          {t("pluginMissing.coachBody")}
        </p>
      </div>
    </div>
  );
}
