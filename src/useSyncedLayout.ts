import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import {
  LAYOUT_CHANNEL,
  LAYOUT_SET_NAMES,
  type LayoutSetName,
} from "./layoutSets";

type LayoutSets = Record<LayoutSetName, ReadonlySet<string>>;

const LOCAL_CACHE_KEYS: Record<LayoutSetName, string> = {
  collapsedShelves: "bb-sidebar:collapsed-shelves",
  expandedParents: "bb-sidebar:expanded-parents",
};

function readLocalCache(set: LayoutSetName): string[] | null {
  try {
    const stored = globalThis.localStorage?.getItem(LOCAL_CACHE_KEYS[set]);
    if (stored == null) return null;
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : null;
  } catch {
    return null;
  }
}

function writeLocalCache(set: LayoutSetName, items: ReadonlySet<string>) {
  try {
    globalThis.localStorage?.setItem(
      LOCAL_CACHE_KEYS[set],
      JSON.stringify([...items]),
    );
  } catch {
    return;
  }
}

export function useSyncedLayout(
  defaults: Record<LayoutSetName, readonly string[]>,
) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const defaultsRef = useRef(defaults);
  const [sets, setSets] = useState<LayoutSets>(() => ({
    collapsedShelves: new Set(
      readLocalCache("collapsedShelves") ?? defaults.collapsedShelves,
    ),
    expandedParents: new Set(
      readLocalCache("expandedParents") ?? defaults.expandedParents,
    ),
  }));

  const requestSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    const stored = await rpc.call("getLayout", {});
    if (seq !== requestSeq.current) return;
    const next = {} as Record<LayoutSetName, ReadonlySet<string>>;
    for (const set of LAYOUT_SET_NAMES) {
      const serverItems = stored[set];
      if (serverItems === null) {
        const carriedOver = readLocalCache(set) ?? [
          ...defaultsRef.current[set],
        ];
        next[set] = new Set(carriedOver);
        void rpc.call("replaceLayoutSet", { set, items: carriedOver });
      } else {
        next[set] = new Set(serverItems);
      }
      writeLocalCache(set, next[set]);
    }
    setSets(next);
  }, [rpc]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useRealtime(LAYOUT_CHANNEL, () => {
    void refresh().catch(() => undefined);
  });

  const setsRef = useRef(sets);
  setsRef.current = sets;

  const toggle = useCallback(
    (set: LayoutSetName, item: string) => {
      requestSeq.current += 1;
      const items = new Set(setsRef.current[set]);
      const member = !items.has(item);
      if (member) items.add(item);
      else items.delete(item);
      writeLocalCache(set, items);
      setSets((current) => ({ ...current, [set]: items }));
      void rpc
        .call("setLayoutMember", { set, item, member })
        .catch(() => undefined);
    },
    [rpc],
  );

  return useMemo(
    () => ({
      collapsedShelves: sets.collapsedShelves,
      expandedParents: sets.expandedParents,
      toggleShelf: (shelf: string) => toggle("collapsedShelves", shelf),
      toggleParent: (threadId: string) => toggle("expandedParents", threadId),
    }),
    [sets, toggle],
  );
}
