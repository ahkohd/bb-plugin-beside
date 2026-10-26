import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk";

const ROLLUP_PRIORITY: readonly PluginSidebarThreadIndicator[] = [
  "waiting-for-input",
  "unread-error",
  "runtime",
  "workflow",
  "background-agent",
  "background-command",
  "plan-mode",
  "goal",
  "working-draft",
  "unread-success",
  "draft",
];

export function mostUrgentIndicator<
  T extends { indicator: PluginSidebarThreadIndicator },
>(threads: readonly T[]): T | null {
  let best: T | null = null;
  let bestRank = ROLLUP_PRIORITY.length;
  for (const thread of threads) {
    const rank = ROLLUP_PRIORITY.indexOf(thread.indicator);
    if (rank !== -1 && rank < bestRank) {
      best = thread;
      bestRank = rank;
    }
  }
  return best;
}
