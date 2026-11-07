import * as React from "react";
import { Laptop, Send, Settings as SettingsIcon } from "lucide-react";
import { en } from "../shared/locales/en";
import { cn } from "../shared/lib/utils";
import { Button } from "../shared/ui/button";

export type PhoneTab = "send" | "devices" | "settings";

export function PhoneFrame({
  activeTab,
  onSelectTab,
  children,
}: {
  activeTab: PhoneTab;
  onSelectTab: (tab: PhoneTab) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="panel phone flex min-h-screen w-full max-w-[440px] flex-col gap-3 bg-background px-4 text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-3">{children}</div>

      <footer className="mt-auto flex items-center justify-around pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSelectTab("send")}
          className={cn(
            "flex h-auto flex-col items-center gap-1 rounded-xl px-4 py-1.5 text-xs",
            activeTab === "send"
              ? "font-semibold text-primary"
              : "text-muted-foreground",
          )}
        >
          <Send className="h-5 w-5" />
          <span>{en.sendTab}</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSelectTab("devices")}
          className={cn(
            "flex h-auto flex-col items-center gap-1 rounded-xl px-4 py-1.5 text-xs",
            activeTab === "devices"
              ? "font-semibold text-primary"
              : "text-muted-foreground",
          )}
        >
          <Laptop className="h-5 w-5" />
          <span>{en.devicesTitle}</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSelectTab("settings")}
          className={cn(
            "flex h-auto flex-col items-center gap-1 rounded-xl px-4 py-1.5 text-xs",
            activeTab === "settings"
              ? "font-semibold text-primary"
              : "text-muted-foreground",
          )}
        >
          <SettingsIcon className="h-5 w-5" />
          <span>{en.settings}</span>
        </Button>
      </footer>
    </section>
  );
}
