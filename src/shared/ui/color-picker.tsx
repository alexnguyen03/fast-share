import * as React from "react";
import { Pipette } from "lucide-react";
import { cn } from "../lib/utils";

export type ColorPickerButtonProps = Omit<
  React.LabelHTMLAttributes<HTMLLabelElement>,
  "children" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
  label: string;
};

export function ColorPickerButton({
  value,
  onChange,
  label,
  className,
  ...props
}: ColorPickerButtonProps): React.JSX.Element {
  return (
    <label
      {...props}
      title={label}
      aria-label={label}
      className={cn(
        "relative inline-flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[conic-gradient(from_20deg,#f87171,#fbbf24,#34d399,#38bdf8,#a78bfa,#f472b6,#f87171)] ring-1 ring-border transition-opacity focus-within:ring-2 focus-within:ring-primary",
        className,
      )}
    >
      <input
        type="color"
        value={value}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
      <span
        aria-hidden="true"
        className="flex h-full w-full items-center justify-center bg-foreground/20 text-background backdrop-blur-[1px]"
      >
        <Pipette className="h-5 w-5 drop-shadow" />
      </span>
    </label>
  );
}
