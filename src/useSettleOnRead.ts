import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { SETTINGS_CHANNEL } from "./layoutSets";

export function useSettleOnRead() {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [since, setSince] = useState<number | null>(null);
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    const { settleOnReadSince } = await rpc.call("getSettings", {});
    if (seq === requestSeq.current) setSince(settleOnReadSince);
  }, [rpc]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useRealtime(SETTINGS_CHANNEL, () => {
    void refresh().catch(() => undefined);
  });

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      const seq = ++requestSeq.current;
      const { settleOnReadSince } = await rpc.call("setSettleOnRead", {
        enabled,
      });
      if (seq === requestSeq.current) setSince(settleOnReadSince);
    },
    [rpc],
  );

  return { since, setEnabled };
}
