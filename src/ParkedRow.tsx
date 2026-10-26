import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { SidebarRow, type ChildToggle } from "./SidebarRow";
import { ThreadStatus } from "./StatusSlot";
import { snoozeWakeLabel } from "./lifecycle";

const RESTORE_LABELS = {
  snoozed: "Wake thread now",
  settled: "Un-settle thread",
  muted: "Unmute thread",
} as const;

const RESTORE_ICONS = {
  snoozed: "Clock",
  settled: "ArrowTurnBackward",
  muted: "Notification",
} as const;

export function ParkedRow({
  thread,
  isActive,
  shelf,
  wakeAt,
  now,
  onNavigate,
  childToggle,
  statusThread = thread,
  onRestore,
}: {
  thread: PluginSidebarThread;
  isActive: boolean;
  shelf: "snoozed" | "settled" | "muted";
  wakeAt: number | null;
  now: number;
  onNavigate: () => void;
  childToggle?: ChildToggle;
  statusThread?: PluginSidebarThread;
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
          <ThreadStatus thread={statusThread} />
        )
      }
      actions={[
        {
          label: RESTORE_LABELS[shelf],
          icon: RESTORE_ICONS[shelf],
          onActivate: onRestore,
        },
      ]}
      onNavigate={onNavigate}
      childToggle={childToggle}
    />
  );
}
