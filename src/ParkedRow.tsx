import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { SidebarRow, type ChildToggle } from "./SidebarRow";
import { ThreadStatus } from "./StatusSlot";
import { snoozeWakeLabel } from "./lifecycle";

export function ParkedRow({
  thread,
  isActive,
  shelf,
  wakeAt,
  now,
  onNavigate,
  childToggle,
  onRestore,
}: {
  thread: PluginSidebarThread;
  isActive: boolean;
  shelf: "snoozed" | "settled";
  wakeAt: number | null;
  now: number;
  onNavigate: () => void;
  childToggle?: ChildToggle;
  onRestore: () => void;
}) {
  const isSnoozed = shelf === "snoozed";
  return (
    <SidebarRow
      thread={thread}
      isActive={isActive}
      muted
      trailing={
        isSnoozed && wakeAt !== null ? (
          <span className="tabular-nums text-2xs text-muted-foreground">
            {snoozeWakeLabel(wakeAt, now)}
          </span>
        ) : (
          <ThreadStatus thread={thread} />
        )
      }
      actions={[
        {
          label: isSnoozed ? "Wake thread now" : "Un-settle thread",
          icon: isSnoozed ? "Clock" : "ArrowTurnBackward",
          onActivate: onRestore,
        },
      ]}
      onNavigate={onNavigate}
      childToggle={childToggle}
    />
  );
}
