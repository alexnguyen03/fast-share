import * as React from "react";
import { ChevronLeft, Moon, Sun } from "lucide-react";
import { api } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { cn } from "../../shared/lib/utils";
import {
  applyTheme,
  THEME_PRESETS,
  type AppTheme,
  type Settings,
} from "../../shared/settings";
import { Button } from "../../shared/ui/button";
import { Card } from "../../shared/ui/card";
import { getOrCreateRoot } from "../../shared/ui/render";
import { showToast } from "../../shared/ui/toast";
import { PhoneFrame, type PhoneTab } from "../frame";

export function PhoneSettingsScreen({
  initialSettings,
  onSelectTab,
}: {
  initialSettings: Settings;
  onSelectTab: (tab: PhoneTab) => void;
}): React.JSX.Element {
  const [theme, setTheme] = React.useState<AppTheme>(
    initialSettings.theme ?? "emerald-light",
  );

  function selectTheme(nextTheme: AppTheme): void {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    void api.updateSettings({ theme: nextTheme }).then(() => {
      showToast(en.settingsSaved);
    });
  }

  const currentPreset =
    THEME_PRESETS.find((item) => item.id === theme) ?? THEME_PRESETS[0];
  const isDark = currentPreset.mode === "dark";
  const lightPresets = THEME_PRESETS.filter((item) => item.mode === "light");
  const darkPresets = THEME_PRESETS.filter((item) => item.mode === "dark");

  return (
    <PhoneFrame activeTab="settings" onSelectTab={onSelectTab}>
      <header className="grid min-h-9 grid-cols-[36px_1fr_36px] items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.back}
          onClick={() => onSelectTab("send")}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="m-0 text-center text-[1.12rem] font-semibold text-foreground">
          {en.settings}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.appearance}
          title={isDark ? en.lightThemes : en.darkThemes}
          onClick={() => {
            const target = isDark ? lightPresets[0].id : darkPresets[0].id;
            selectTheme(target);
          }}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-1">
        <Card className="flex flex-col gap-2.5 border-0 bg-muted p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {en.appearance}
          </span>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {en.lightThemes}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {lightPresets.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => selectTheme(preset.id)}
                  className={cn(
                    "flex h-auto flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs",
                    theme === preset.id
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "bg-secondary/60 text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1">
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: preset.bg }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: preset.primary }}
                    />
                  </span>
                  <span className="truncate">{en.themeNames[preset.id]}</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {en.darkThemes}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {darkPresets.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => selectTheme(preset.id)}
                  className={cn(
                    "flex h-auto flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs",
                    theme === preset.id
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "bg-secondary/60 text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1">
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: preset.bg }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: preset.primary }}
                    />
                  </span>
                  <span className="truncate">{en.themeNames[preset.id]}</span>
                </Button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="mt-auto flex flex-col gap-1.5 border-0 bg-muted p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {en.appInfo}
          </span>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{en.appVersionLabel}</span>
            <span className="font-medium text-foreground">
              {en.appVersionValue}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{en.appAuthorLabel}</span>
            <span className="font-medium text-foreground">
              {en.appAuthorValue}
            </span>
          </div>
        </Card>
      </div>
    </PhoneFrame>
  );
}

export async function mountPhoneSettings(
  root: HTMLElement,
  onSelectTab: (tab: PhoneTab) => void,
): Promise<void> {
  const settings = await api.getSettings();
  applyTheme(settings.theme);
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <PhoneSettingsScreen
      initialSettings={settings}
      onSelectTab={onSelectTab}
    />,
  );
}
