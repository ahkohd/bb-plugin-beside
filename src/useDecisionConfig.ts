import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { SETTINGS_CHANNEL } from "./layoutSets";
import type { DecisionLimits, DecisionProvider } from "./decisionRules";

export interface DecisionConfig {
  provider: DecisionProvider;
  address: string;
  customEndpoint: string;
  customModel: string;
  endpoint: string;
  model: string;
  keySet: boolean;
  limits: { d1: DecisionLimits; jev: DecisionLimits; custom: DecisionLimits };
}

export function useDecisionConfig() {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [config, setConfig] = useState<DecisionConfig | null>(null);

  const refresh = useCallback(async () => {
    setConfig(await rpc.call("getDecisionConfig", {}));
  }, [rpc]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useRealtime(SETTINGS_CHANNEL, () => {
    void refresh().catch(() => undefined);
  });

  return { config, setConfig, refresh };
}

export function isDecisionModeOn(config: DecisionConfig | null): boolean {
  return config !== null && config.provider !== "off" && config.endpoint !== "";
}
