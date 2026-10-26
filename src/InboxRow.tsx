import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { SidebarRow, type RowAction } from "./SidebarRow";
import { StatusOrTime } from "./StatusSlot";
import { resolveSnoozePresets } from "./lifecycle";

function snoozeUntilTomorrow(): number {
  const tomorrow = resolveSnoozePresets(new Date()).find(
    (preset) => preset.id === "tomorrow",
  );
  return tomorrow!.snoozedUntil;
}

export function InboxRow({
  thread,
  isActive,
  canPark,
  onNavigate,
  onSettle,
  onSnooze,
  now,
}: {
  thread: PluginSidebarThread;
  isActive: boolean;
  canPark: boolean;
  onNavigate: () => void;
  onSettle: () => void;
  onSnooze: (snoozedUntil: number) => void;
  now: number;
}) {
  const parkActions: RowAction[] = canPark
    ? [
        {
          label: "Snooze until tomorrow",
          icon: "Clock",
          onActivate: () => onSnooze(snoozeUntilTomorrow()),
        },
        { label: "Settle thread", icon: "Check", onActivate: onSettle },
      ]
    : [];

  return (
    <SidebarRow
      thread={thread}
      isActive={isActive}
      trailing={<StatusOrTime thread={thread} now={now} />}
      actions={parkActions}
      onNavigate={onNavigate}
    />
  );
}
