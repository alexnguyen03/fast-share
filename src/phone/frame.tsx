import * as React from "react";
import { Laptop, Send, Settings as SettingsIcon } from "lucide-react";
import { en } from "../shared/locales/en";
import { cn } from "../shared/lib/utils";
import { Button } from "../shared/ui/button";
import { Toaster } from "../shared/ui/toast";

export type PhoneTab = "send" | "devices" | "settings";

const TAB_ORDER: PhoneTab[] = ["send", "devices", "settings"];
const SLIDE_MS = 220;
// Each tab is a fresh render, so the outgoing screen tells the incoming one where to slide in from.
let enterFrom: -1 | 0 | 1 = 0;

/**
 * Header (first child of each screen) and the tab bar stay put; each screen scrolls its own body.
 * A sideways drag pulls the screen along with the finger like a sliding door: let go past a
 * third of the width (or flick) and it slides on to the next tab, otherwise it settles back.
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
  const dragRef = React.useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const [offset, setOffset] = React.useState<number>(0);
  const [settling, setSettling] = React.useState<boolean>(false);
  const [entering] = React.useState<-1 | 0 | 1>(() => {
    const from = enterFrom;
    enterFrom = 0;
    return from;
  });
  const neighbour = (dx: number): PhoneTab | undefined =>
    TAB_ORDER[TAB_ORDER.indexOf(activeTab) + (dx < 0 ? 1 : -1)];

  return (
    <section className="panel phone flex h-dvh w-full max-w-[440px] flex-col gap-3 overflow-hidden bg-background px-4 text-foreground">
      <div
        className={cn(
          "flex min-h-0 flex-1 touch-pan-y flex-col gap-3",
          entering === 1 && "animate-[fs-enter-right_220ms_ease-out]",
          entering === -1 && "animate-[fs-enter-left_220ms_ease-out]",
        )}
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          transition: settling ? `transform ${SLIDE_MS}ms ease-out` : undefined,
        }}
        onTouchStart={(event) => {
          const target = event.target as HTMLElement;
          const touch = event.touches[0];
          // fields, sliders and anything marked data-no-swipe keep their own horizontal gestures
          dragRef.current =
            event.touches.length === 1 && !settling && !target.closest("input,textarea,[data-no-swipe]")
              ? { x: touch.clientX, y: touch.clientY, t: Date.now(), axis: null }
              : null;
        }}
        onTouchMove={(event) => {
          const drag = dragRef.current;
          const touch = event.touches[0];
          if (!drag || !touch) {
            return;
          }
          const dx = touch.clientX - drag.x;
          const dy = touch.clientY - drag.y;
          if (drag.axis === null && Math.hypot(dx, dy) > 8) {
            drag.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
          }
          if (drag.axis === "x") {
            // no tab that way: the door gives a little, then resists
            setOffset(neighbour(dx) ? dx : dx * 0.25);
          }
        }}
        onTouchEnd={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          const touch = event.changedTouches[0];
          if (!drag || drag.axis !== "x" || !touch) {
            return;
          }
          const dx = touch.clientX - drag.x;
          const width = event.currentTarget.clientWidth || window.innerWidth;
          const flick = Math.abs(dx) > 50 && Date.now() - drag.t < 250;
          const next = neighbour(dx);
          setSettling(true);
          if (next && (Math.abs(dx) > width / 3 || flick)) {
            setOffset(dx < 0 ? -width : width);
            window.setTimeout(() => {
              enterFrom = dx < 0 ? 1 : -1;
              onSelectTab(next);
            }, SLIDE_MS);
            return;
          }
          setOffset(0);
          window.setTimeout(() => setSettling(false), SLIDE_MS);
        }}
        onTouchCancel={() => {
          // the system took the gesture (e.g. a back swipe): put the screen back
          if (dragRef.current?.axis === "x") {
            setSettling(true);
            setOffset(0);
            window.setTimeout(() => setSettling(false), SLIDE_MS);
          }
          dragRef.current = null;
        }}
      >
        {children}
      </div>

      <footer className="mt-auto flex items-center justify-around">
        {(
          [
            ["send", Send, en.sendTab],
            ["devices", Laptop, en.devicesTitle],
            ["settings", SettingsIcon, en.settings],
          ] as const
        ).map(([tab, Icon, label]) => {
          const active = activeTab === tab;
          return (
            <Button
              key={tab}
              type="button"
              variant="ghost"
              size="sm"
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onClick={() => onSelectTab(tab)}
              className={cn(
                "flex h-11 items-center gap-1.5 rounded-full px-4 text-sm",
                active ? "bg-accent font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              {/* only the current tab names itself; the others are icons */}
              {active ? <span>{label}</span> : null}
            </Button>
          );
        })}
      </footer>
      <Toaster />
    </section>
  );
}
