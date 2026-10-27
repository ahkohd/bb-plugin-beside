import { useMemo } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { useLifecycleRows } from "./lifecycleStore";

export function useMutedThreadIds() {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const rows = useLifecycleRows(rpc);
  const mutedIds = useMemo<ReadonlySet<string> | null>(
    () =>
      rows === null
        ? null
        : new Set(
            [...rows.values()]
              .filter((row) => row.mutedAt != null)
              .map((row) => row.threadId),
          ),
    [rows],
  );
  return { mutedIds, rpc };
}
