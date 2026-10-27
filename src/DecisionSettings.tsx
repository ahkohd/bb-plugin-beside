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
import { SegmentedControl } from "./settingsUi";
import { isDecisionModeOn, useDecisionConfig } from "./useDecisionConfig";

type DecisionTab = "setup" | "activity" | "try";

const TABS: { value: DecisionTab; label: string }[] = [
  { value: "setup", label: "Setup" },
  { value: "activity", label: "Activity" },
  { value: "try", label: "Try it" },
];

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

  const [tab, setTab] = useState<DecisionTab>("setup");

  if (config === null || status === null) return null;

  const on = isDecisionModeOn(config);
  const activeLimits =
    config.provider === "off" ? DEFAULT_LIMITS.d1 : config.limits[config.provider];

  return (
    <div className="space-y-5">
      <SegmentedControl
        role="tablist"
        label="Decision mode"
        value={tab}
        options={TABS}
        onChange={setTab}
      />
      <div role="tabpanel" aria-label={TABS.find((option) => option.value === tab)?.label}>
        {tab === "setup" ? (
          <DecisionSetup
            config={config}
            recent={status.recent}
            titleFor={titleFor}
            onSaved={setConfig}
          />
        ) : null}
        {tab === "activity" ? (
          <div className="space-y-6">
            <Summary status={status} />
            <DecisionLog status={status} limits={config.limits} titleFor={titleFor} />
          </div>
        ) : null}
        {tab === "try" ? <TryAMessage enabled={on} limits={activeLimits} /> : null}
      </div>
    </div>
  );
}
