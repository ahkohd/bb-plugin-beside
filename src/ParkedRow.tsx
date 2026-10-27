import {
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
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

const INDICATORS_THAT_OUTRANK_QUIET_NEWS: ReadonlySet<string> = new Set([
  "runtime",
  "workflow",
  "background-agent",
  "plan-mode",
  "goal",
  "working-draft",
  "waiting-for-input",
  "queued-waiting",
  "queued-failed",
  "unread-error",
]);

function statusOutranksQuietNews(indicator: string): boolean {
  return INDICATORS_THAT_OUTRANK_QUIET_NEWS.has(indicator);
}

function QuietNewsMark({
  note,
  children,
}: {
  note: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center" aria-label={note}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{note}</TooltipContent>
    </Tooltip>
  );
}

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
  const quietDot = <ThreadStatusGlyph indicator="unread-success" />;
  const showsStatusInstead = statusOutranksQuietNews(statusThread.indicator);
  const wakeLabel =
    isSnoozed && wakeAt !== null ? (
      <span className="tabular-nums text-2xs text-muted-foreground">
        {snoozeWakeLabel(wakeAt, now)}
      </span>
    ) : null;
  return (
    <SidebarRow
      thread={thread}
      isActive={isActive}
      muted
      trailing={
        quietNewsNote ? (
          <QuietNewsMark
            note={
              isSnoozed && wakeAt !== null
                ? `${quietNewsNote}. Wakes in ${snoozeWakeLabel(wakeAt, now)}.`
                : quietNewsNote
            }
          >
            {showsStatusInstead ? (
              <span className="relative inline-flex items-center">
                <span
                  data-quiet-news-dot=""
                  className="absolute right-full top-1/2 mr-px size-1.5 -translate-y-1/2 rounded-full bg-muted-foreground"
                />
                {status}
              </span>
            ) : (
              quietDot
            )}
          </QuietNewsMark>
        ) : (
          (wakeLabel ?? status)
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
