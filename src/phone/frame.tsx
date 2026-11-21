import * as React from "react";
import { Laptop, Send, Settings as SettingsIcon } from "lucide-react";
import { en } from "../shared/locales/en";
import { cn } from "../shared/lib/utils";
import { Button } from "../shared/ui/button";
import { Toaster } from "../shared/ui/toast";

export type PhoneTab = "send" | "devices" | "settings";

const TAB_ORDER: PhoneTab[] = ["send", "devices", "settings"];
const SWIPE_MIN_PX = 60;

/**
 * Header (first child of each screen) and the tab bar stay put; each screen scrolls its own body.
 * A horizontal swipe moves to the neighbouring tab, like flipping pages.
 */
export function PhoneFrame({
  activeTab,
  onSelectTab,
  children,
}: {
  activeTab: PhoneTab;
  onSelectTab: (tab: PhoneTab) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const startRef = React.useRef<{ x: number; y: number } | null>(null);

  return (
    <section className="panel phone flex h-dvh w-full max-w-[440px] flex-col gap-3 overflow-hidden bg-background px-4 text-foreground">
      <div
        className="flex min-h-0 flex-1 flex-col gap-3"
        onTouchStart={(event) => {
          const target = event.target as HTMLElement;
          const touch = event.touches[0];
          // fields, sliders and anything marked data-no-swipe keep their own horizontal gestures
          startRef.current =
            event.touches.length === 1 && !target.closest("input,textarea,[data-no-swipe]")
              ? { x: touch.clientX, y: touch.clientY }
              : null;
        }}
        onTouchEnd={(event) => {
          const start = startRef.current;
          startRef.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) {
            return;
          }
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) {
            return;
          }
          const next = TAB_ORDER[TAB_ORDER.indexOf(activeTab) + (dx < 0 ? 1 : -1)];
          if (next) {
            onSelectTab(next);
          }
        }}
      >
        {children}
      </div>

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
      <Toaster />
    </section>
  );
}
