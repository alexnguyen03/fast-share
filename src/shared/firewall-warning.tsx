import * as React from "react";
import { en } from "./locales/en";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export function FirewallWarning({
  onAllow,
}: {
  onAllow: () => void;
}): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-2 border-0 bg-accent p-2.5 shadow-none">
      <p className="text-xs text-foreground">{en.firewallPublicWarning}</p>
      <Button variant="default" size="sm" onClick={onAllow}>
        {en.allowFirewallButton}
      </Button>
    </Card>
  );
}
