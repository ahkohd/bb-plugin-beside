import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { SETTINGS_CHANNEL } from "./layoutSets";

export function useSettleOnRead() {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [since, setSince] = useState<number | null>(null);
  const [autoArchiveDays, setAutoArchiveDaysState] = useState<number | null>(
    null,
  );
  const autoArchiveDaysRef = useRef(autoArchiveDays);
  autoArchiveDaysRef.current = autoArchiveDays;
  const requestSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    const { settleOnReadSince, autoArchiveSettledDays } = await rpc.call(
      "getSettings",
      {},
    );
    if (seq !== requestSeq.current) return;
    setSince(settleOnReadSince);
    setAutoArchiveDaysState(autoArchiveSettledDays);
  }, [rpc]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useRealtime(SETTINGS_CHANNEL, () => {
    void refresh().catch(() => undefined);
  });

  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(connection === "connected");
  useEffect(() => {
    const connected = connection === "connected";
    if (connected && !wasConnected.current) {
      void refresh().catch(() => undefined);
    }
    wasConnected.current = connected;
  }, [connection, refresh]);

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

  const setAutoArchiveDays = useCallback(
    async (days: number | null) => {
      const seq = ++requestSeq.current;
      const previous = autoArchiveDaysRef.current;
      setAutoArchiveDaysState(days);
      let autoArchiveSettledDays: number | null;
      try {
        ({ autoArchiveSettledDays } = await rpc.call(
          "setAutoArchiveSettledDays",
          { days },
        ));
      } catch (error) {
        if (seq === requestSeq.current) setAutoArchiveDaysState(previous);
        throw error;
      }
      if (seq === requestSeq.current) {
        setAutoArchiveDaysState(autoArchiveSettledDays);
      }
    },
    [rpc],
  );

  return { since, setEnabled, autoArchiveDays, setAutoArchiveDays };
}
