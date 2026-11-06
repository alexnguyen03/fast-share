import * as React from "react";
import { api } from "../shared/commands";
import { en } from "../shared/locales/en";
import { cn } from "../shared/lib/utils";
import { Card } from "../shared/ui/card";

export function DesktopFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-start py-1.5 pr-1.5 pl-0">
      <div
        data-tauri-drag-region=""
        onMouseDown={(event) => {
          if (event.button === 0) {
            void api.startWindowDrag();
          }
        }}
        className="mt-6 flex min-h-[138px] w-[34px] shrink-0 cursor-grab select-none items-center justify-center rounded-l-[10px] bg-[#0f8a4b] px-1 py-3.5 text-white shadow-[-2px_3px_10px_rgba(0,0,0,0.16)] active:cursor-grabbing"
      >
        <span
          data-tauri-drag-region=""
          className="pointer-events-none whitespace-nowrap text-[0.98rem] font-bold tracking-[0.04em] [writing-mode:vertical-rl] rotate-180"
        >
          {en.appName}
        </span>
      </div>
      <Card
        className={cn(
          "flex h-full min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-[16px] bg-[#fbfdf8] px-[18px] pt-4 pb-3.5 text-[#161a1d] shadow-[0_8px_24px_rgba(0,0,0,0.18)]",
          className,
        )}
      >
        {children}
      </Card>
    </div>
  );
}
