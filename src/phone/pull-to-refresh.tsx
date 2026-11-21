import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "../shared/lib/utils";

const TRIGGER_PX = 56;

/** A scrolling body that refreshes when pulled down from the very top. */
export function PullToRefresh({
  onRefresh,
  className,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const startYRef = React.useRef<number | null>(null);
  const [pull, setPull] = React.useState<number>(0);
  const [busy, setBusy] = React.useState<boolean>(false);
  const dragging = startYRef.current !== null;

  return (
    <div
      ref={scrollRef}
      className={className}
      onTouchStart={(event) => {
        // only a pull that starts with the list already at the top
        startYRef.current =
          !busy && (scrollRef.current?.scrollTop ?? 0) <= 0 ? event.touches[0].clientY : null;
      }}
      onTouchMove={(event) => {
        if (startYRef.current === null) {
          return;
        }
        const distance = event.touches[0].clientY - startYRef.current;
        setPull(distance > 0 ? Math.min(distance * 0.5, TRIGGER_PX * 1.4) : 0);
      }}
      onTouchEnd={() => {
        if (startYRef.current === null) {
          return;
        }
        startYRef.current = null;
        if (pull < TRIGGER_PX) {
          setPull(0);
          return;
        }
        setBusy(true);
        setPull(TRIGGER_PX);
        void onRefresh().finally(() => {
          setBusy(false);
          setPull(0);
        });
      }}
    >
      <div
        aria-hidden="true"
        style={{ height: pull }}
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden",
          !dragging && "transition-[height] duration-200",
        )}
      >
        <RefreshCw
          style={{ transform: `rotate(${pull * 5}deg)`, opacity: Math.min(1, pull / TRIGGER_PX) }}
          className={cn("h-5 w-5 text-primary", busy && "animate-spin")}
        />
      </div>
      {children}
    </div>
  );
}
