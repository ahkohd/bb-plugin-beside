import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";

export function useMutedThreadIds() {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [mutedIds, setMutedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const requestSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    const { rows } = await rpc.call("listLifecycle", {});
    if (seq !== requestSeq.current) return;
    setMutedIds(
      new Set(
        rows.filter((row) => row.mutedAt !== null).map((row) => row.threadId),
      ),
    );
  }, [rpc]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useRealtime("lifecycle", () => {
    void refresh().catch(() => undefined);
  });

  return { mutedIds, rpc };
}
