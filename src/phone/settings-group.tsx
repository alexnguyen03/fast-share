import * as React from "react";
import { cn } from "../shared/lib/utils";
import { Card } from "../shared/ui/card";

/** The label sits above the group, the rows on a tinted card: one look for Settings and Devices. */
export const groupLabelClass = "m-0 px-1 text-sm font-medium text-muted-foreground";

export function SettingsGroup({
  label,
  className,
  children,
}: {
  label: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={cn("flex flex-col gap-1.5", className)}>
      <h2 className={groupLabelClass}>{label}</h2>
      <Card className="flex flex-col gap-2.5 rounded-2xl border-0 bg-muted p-3 shadow-none">
        {children}
      </Card>
    </section>
  );
}
