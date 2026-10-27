import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { SidebarRow, type ChildToggle } from "./SidebarRow";
import { ThreadStatus } from "./StatusSlot";
import { snoozeWakeLabel } from "./lifecycle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/Tooltip";

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
  quietNewsNote,
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
  quietNewsNote?: string;
}) {
  const isSnoozed = shelf === "snoozed";
  const status = <ThreadStatus thread={statusThread} />;
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
        ) : quietNewsNote ? (
          <Tooltip delayDuration={350} disableHoverableContent>
            <TooltipTrigger asChild>
              <span className="inline-flex" aria-label={quietNewsNote}>
                {status}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{quietNewsNote}</TooltipContent>
          </Tooltip>
        ) : (
          status
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
