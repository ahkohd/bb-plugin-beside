import type { ReactNode } from "react";
import { cn } from "./lib/utils";

export const SETTINGS_BUTTON_CLASS =
  "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export const SETTINGS_PRIMARY_BUTTON_CLASS =
  "inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

export const SETTINGS_INPUT_CLASS =
  "flex h-7 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 @min-[36rem]/settings:w-64";

export const SETTINGS_SELECT_TRIGGER_CLASS =
  "h-7 w-full justify-between rounded-md border border-border/60 bg-card px-2 py-0 text-xs hover:bg-state-hover @min-[36rem]/settings:w-44";

export const SETTINGS_BADGE_CLASS =
  "shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground";

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-surface-recessed/70 px-3 py-3",
        className,
      )}
    >
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function SettingsGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SettingsRow({
  label,
  labelId,
  badge,
  description,
  children,
}: {
  label: ReactNode;
  labelId?: string;
  badge?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="@container/settings w-full min-w-0">
      <div className="flex flex-col gap-2.5 @min-[36rem]/settings:flex-row @min-[36rem]/settings:items-start @min-[36rem]/settings:justify-between @min-[36rem]/settings:gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p id={labelId} className="min-w-0 text-sm font-normal text-foreground">
              {label}
            </p>
            {badge}
          </div>
          {description ? (
            <div className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
              {description}
            </div>
          ) : null}
        </div>
        {children ? (
          <div className="flex shrink-0 items-center gap-2 @min-[36rem]/settings:justify-end">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
  role = "radiogroup",
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
  role?: "radiogroup" | "tablist";
}) {
  const itemRole = role === "tablist" ? "tab" : "radio";
  return (
    <div
      role={role}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-lg border border-border p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={itemRole}
            aria-checked={itemRole === "radio" ? selected : undefined}
            aria-selected={itemRole === "tab" ? selected : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              selected
                ? "bg-state-active text-foreground hover:bg-state-active"
                : "text-muted-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
