import * as React from "react";
import type { LanInfo } from "./commands";
import { en } from "./locales/en";
import { Card } from "./ui/card";

export function LanStatusCard({ info }: { info: LanInfo }): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-1 border-0 bg-muted px-3 py-2.5 shadow-none">
      <p className="text-sm font-medium text-foreground">
        {`${en.lanThisDevice}: ${info.ip}`}
      </p>
      <p className="text-sm text-muted-foreground">
        {`${en.lanSubnet}: ${info.subnet}`}
      </p>
      {info.addresses.length > 0 ? (
        <ul className="m-0 list-none p-0 text-xs text-muted-foreground">
          {info.addresses.map((item) => (
            <li key={`${item.name}-${item.ip}`}>{`${item.name}  ${item.ip}`}</li>
          ))}
        </ul>
      ) : null}
      <p className="pt-1 text-xs text-muted-foreground">{en.lanCompareHint}</p>
    </Card>
  );
}

export function lanSummary(info: LanInfo): string {
  return `${en.lanThisDevice} ${info.ip} (${info.subnet})`;
}
