import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { LIFECYCLE_CHANNEL } from "./lifecycleStore";
import { SETTINGS_CHANNEL } from "./layoutSets";
import { DEFAULT_LIMITS } from "./decisionRules";
import {
  DecisionLog,
  Summary,
  TryAMessage,
  type Decision,
  type Status,
} from "./DecisionLog";
import { DecisionSetup } from "./DecisionSetup";
import { isDecisionModeOn, useDecisionConfig } from "./useDecisionConfig";

export function DecisionSettings() {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const { config, setConfig } = useDecisionConfig();
  const [status, setStatus] = useState<Status | null>(null);
  const { threads } = useSidebarThreads();
  const liveTitles = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread.displayTitle])),
    [threads],
  );
  const titleFor = useCallback(
    (decision: Decision) =>
      liveTitles.get(decision.threadId) || decision.title || "Untitled thread",
    [liveTitles],
  );

  const refreshStatus = useCallback(async () => {
    setStatus(await rpc.call("getDecisionStatus", {}));
  }, [rpc]);

  useEffect(() => {
    void refreshStatus().catch(() => undefined);
  }, [refreshStatus, config?.provider, config?.endpoint]);

  useRealtime(LIFECYCLE_CHANNEL, () => {
    void refreshStatus().catch(() => undefined);
  });
  useRealtime(SETTINGS_CHANNEL, () => {
    void refreshStatus().catch(() => undefined);
  });

  if (config === null || status === null) return null;

  const on = isDecisionModeOn(config);
  const activeLimits =
    config.provider === "off" ? DEFAULT_LIMITS.d1 : config.limits[config.provider];

  return (
    <div className="flex flex-col gap-6">
      <DecisionSetup
        config={config}
        recent={status.recent}
        titleFor={titleFor}
        onSaved={setConfig}
      />
      {status.recent.length > 0 || on ? <Summary status={status} /> : null}
      <DecisionLog status={status} limits={config.limits} titleFor={titleFor} />
      {on ? <TryAMessage enabled={on} limits={activeLimits} /> : null}
    </div>
  );
}
