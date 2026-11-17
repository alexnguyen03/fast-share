import * as React from "react";
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
        "relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border/80 shadow-sm ring-1 ring-border/60 transition-opacity hover:opacity-90",
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
        className="h-full w-full rounded-full"
        style={{ backgroundColor: value }}
      />
    </label>
  );
}
