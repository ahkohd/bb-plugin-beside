import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  useRpc,
  useSdk,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";
import { TooltipProvider } from "./components/Tooltip";
import { cn } from "./lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/Select";
import { InboxRow } from "./InboxRow";
import { ParkedRow } from "./ParkedRow";
import { SidebarRow, type ChildToggle } from "./SidebarRow";
import { ThreadStatus } from "./StatusSlot";
import { isIdle, useLifecycle } from "./useLifecycle";
import { useSettleOnRead } from "./useSettleOnRead";
import { InboxMenu } from "./InboxMenu";
import { useSyncedLayout } from "./useSyncedLayout";
import { muteThread, PushLevelError, unmuteThread } from "./muting";
import { forEachLimited } from "./forEachLimited";
import { ShelfMenu, type ShelfMenuItem } from "./ShelfMenu";
import type { bbSidebarRpcContract } from "./server";
import {
  usePinnedReorder,
  type PinnedReorderRequest,
} from "./usePinnedReorder";
import {
  PinnedSortableList,
  SortablePinnedItem,
  type PinnedDragBindings,
} from "./PinnedSortable";
import {
  childrenByParentId,
  familyRootId,
  summarizeSubtrees,
  filterByProject,
  hideChildrenOfVisibleParents,
  sortPinned,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  visibleInboxThreads,
} from "./inbox";

const ALL_PROJECTS = "__all__";

const ARCHIVE_QUICK_ACTION_KEYS = ["bb--core/archive"] as const;

type ShelfId = "pinned" | "inbox" | "snoozed" | "settled" | "muted";

type ParkedShelfId = "snoozed" | "settled" | "muted";

const PARKED_SHELF_LABELS: Record<ParkedShelfId, string> = {
  snoozed: "Snoozed",
  settled: "Settled",
  muted: "Muted",
};

const MUTED_SHELF_OPEN_ITEM = "muted:open";

const AUTO_ARCHIVE_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "1", label: "After 1 day" },
  { value: "3", label: "After 3 days" },
  { value: "7", label: "After 7 days" },
  { value: "14", label: "After 14 days" },
  { value: "30", label: "After 30 days" },
] as const;

const DEFAULT_COLLAPSED_SHELVES: readonly ShelfId[] = ["snoozed", "settled"];

const DEFAULT_LAYOUT = {
  collapsedShelves: DEFAULT_COLLAPSED_SHELVES,
  expandedParents: [],
};

/**
 * The sidebar's scrolling list: one flat, statically ordered stack of cards.
 *
 * The host owns the New-thread button and the search field above it, so this
 * ships neither. It filters by the `searchQuery` prop and keeps only the one
 * control the host has no equivalent for: the project scope picker.
 */
export function ThreadInbox({
  activeThreadId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const lifecycle = useLifecycle();
  const [scope, setScope] = useState<string>(ALL_PROJECTS);
  const { collapsedShelves, expandedParents, toggleShelf, toggleParent } =
    useSyncedLayout(DEFAULT_LAYOUT);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const {
    pinned,
    inbox,
    snoozed,
    settled,
    muted,
    mutedThreadAsks,
    childrenById,
    summaries,
    hasDescendantWaitingForYou,
  } = useMemo(() => {
    const visible = visibleInboxThreads(threads);
    const scoped = filterByProject(
      visible,
      scope === ALL_PROJECTS ? null : scope,
    );
    const searched = searchThreadsByTitle(scoped, searchQuery);
    const childrenById = childrenByParentId(
      searched.filter((thread) => !thread.isPinned),
    );
    const summaries = summarizeSubtrees(
      visible.filter((thread) => !thread.isPinned),
      (thread) => lifecycle.shelfFor(thread) === "muted",
    );
    const hasDescendantWaitingForYou = (thread: PluginSidebarThread) =>
      summaries.get(thread.id)?.waitingForYou ?? false;
    const matched = hideChildrenOfVisibleParents(searched).filter(
      (thread) => !thread.isPinned,
    );
    const active: typeof matched = [];
    const onSnoozeShelf: typeof matched = [];
    const onSettledShelf: typeof matched = [];
    const onMutedShelf: typeof matched = [];
    for (const thread of matched) {
      const ownShelf = lifecycle.shelfFor(thread);
      const shelf =
        ownShelf !== "active" &&
        ownShelf !== "muted" &&
        hasDescendantWaitingForYou(thread)
          ? "active"
          : ownShelf;
      if (shelf === "snoozed") onSnoozeShelf.push(thread);
      else if (shelf === "settled") onSettledShelf.push(thread);
      else if (shelf === "muted") onMutedShelf.push(thread);
      else active.push(thread);
    }
    const mutedThreadAsks = onMutedShelf.some(
      (thread) =>
        thread.hasPendingInteraction || hasDescendantWaitingForYou(thread),
    );
    return {
      pinned: sortPinned(searched.filter((thread) => thread.isPinned)),
      inbox: sortByCreatedAtDescending(active),
      // Soonest wake first: "what comes back next" is the shelf's question.
      snoozed: [...onSnoozeShelf].sort(
        (left, right) =>
          (lifecycle.wakeAtFor(left) ?? 0) - (lifecycle.wakeAtFor(right) ?? 0),
      ),
      settled: sortByCreatedAtDescending(onSettledShelf),
      muted: sortByCreatedAtDescending(onMutedShelf),
      mutedThreadAsks,
      childrenById,
      summaries,
      hasDescendantWaitingForYou,
    };
  }, [lifecycle, scope, searchQuery, threads]);

  const isShelfCollapsed = (shelf: ShelfId) =>
    shelf === "muted"
      ? !collapsedShelves.has(MUTED_SHELF_OPEN_ITEM)
      : collapsedShelves.has(shelf);
  const toggleShelfCollapsed = (shelf: ShelfId) =>
    toggleShelf(shelf === "muted" ? MUTED_SHELF_OPEN_ITEM : shelf);

  const sdk = useSdk();
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const restoreParked = (shelf: ParkedShelfId, threadId: string) => {
    if (shelf === "snoozed") lifecycle.unsnooze(threadId);
    else if (shelf === "settled") lifecycle.unsettle(threadId);
    else {
      void unmuteThread(rpc, sdk, threadId).catch((error: unknown) => {
        toast.error(
          error instanceof PushLevelError
            ? error.message
            : "Could not unmute the thread",
        );
      });
    }
  };

  const [isInboxMenuOpen, setIsInboxMenuOpen] = useState(false);
  const settleOnRead = useSettleOnRead();
  const parkableInboxIds = inbox
    .filter(
      (thread) =>
        lifecycle.canPark(thread) && !hasDescendantWaitingForYou(thread),
    )
    .map((thread) => thread.id);

  const parkAll = (
    verb: string,
    park: (threadIds: readonly string[]) => Promise<unknown>,
  ) => {
    const threadIds = parkableInboxIds;
    if (threadIds.length === 0) return;
    const before = lifecycle.snapshot(threadIds);
    void park(threadIds)
      .then(() => {
        toast(
          `${verb} ${threadIds.length} ${threadIds.length === 1 ? "thread" : "threads"}`,
          {
            action: {
              label: "Undo",
              onClick: () =>
                void lifecycle.restore(before).catch(() => undefined),
            },
          },
        );
      })
      .catch(() => {
        toast.error(`Could not ${verb.toLowerCase()} threads`);
      });
  };
  const settleAll = () => parkAll("Settled", lifecycle.settleMany);

  const [openShelfMenu, setOpenShelfMenu] = useState<ParkedShelfId | null>(
    null,
  );

  const countLabel = (count: number) =>
    `${count} ${count === 1 ? "thread" : "threads"}`;

  const runBulk = async (
    describe: (count: number) => string,
    failure: string,
    run: () => Promise<{
      count: number;
      failed: number;
      undo: () => Promise<unknown>;
    }>,
  ) => {
    try {
      const { count, failed, undo } = await run();
      if (failed > 0) {
        toast.error(`${failure}: ${countLabel(failed)} failed`);
      }
      if (count === 0) return;
      toast(describe(count), {
        action: {
          label: "Undo",
          onClick: () => void undo().catch(() => toast.error("Could not undo")),
        },
      });
    } catch {
      toast.error(failure);
    }
  };

  const returnToInbox = (
    threadIds: readonly string[],
    describe: (count: number) => string,
    failure: string,
  ) =>
    void runBulk(describe, failure, async () => {
      const before = lifecycle.snapshot(threadIds);
      await lifecycle.restore(
        threadIds.map((threadId) => ({ threadId, row: null })),
      );
      return {
        count: threadIds.length,
        failed: 0,
        undo: () => lifecycle.restore(before),
      };
    });

  const unmuteAll = (threadIds: readonly string[]) =>
    void runBulk(
      (count) => `Unmuted ${countLabel(count)}`,
      "Could not unmute threads",
      async () => {
        const { succeeded, failed } = await forEachLimited(
          threadIds,
          (threadId) => unmuteThread(rpc, sdk, threadId),
        );
        return {
          count: succeeded.length,
          failed: failed.length,
          undo: () =>
            forEachLimited(succeeded, (threadId) =>
              muteThread(rpc, sdk, threadId),
            ),
        };
      },
    );

  const archiveAll = (threadIds: readonly string[]) =>
    void runBulk(
      (count) => `Archived ${countLabel(count)}`,
      "Could not archive threads",
      async () => {
        const recordsBefore = lifecycle.snapshotAll();
        const archivedIds = new Set<string>();
        const { failed } = await forEachLimited(threadIds, async (threadId) => {
          const result = await sdk.threads.archive({ threadId });
          for (const id of result.archivedThreadIds) archivedIds.add(id);
        });
        const archived = [...archivedIds];
        return {
          count: archived.length,
          failed: failed.length,
          undo: async () => {
            await forEachLimited(archived, (threadId) =>
              sdk.threads.unarchive({ threadId }),
            );
            const records = recordsBefore.filter((entry) =>
              archivedIds.has(entry.threadId),
            );
            if (records.length > 0) await lifecycle.restore(records);
          },
        };
      },
    );

  const shelfMenuItems = (
    shelf: ParkedShelfId,
    threadIds: readonly string[],
  ): ShelfMenuItem[] => {
    if (shelf === "snoozed") {
      return [
        {
          label: "Wake all",
          icon: "ClockArrowUp",
          onSelect: () =>
            returnToInbox(
              threadIds,
              (count) => `Woke ${countLabel(count)}`,
              "Could not wake threads",
            ),
        },
      ];
    }
    if (shelf === "settled") {
      return [
        {
          label: "Archive all",
          icon: "Archive",
          onSelect: () => archiveAll(threadIds),
        },
        {
          label: "Move all to Inbox",
          icon: "ArrowTurnBackward",
          onSelect: () =>
            returnToInbox(
              threadIds,
              (count) => `Moved ${countLabel(count)} to Inbox`,
              "Could not move threads to Inbox",
            ),
        },
      ];
    }
    return [
      {
        label: "Unmute all",
        icon: "beside.unmute",
        onSelect: () => unmuteAll(threadIds),
      },
      {
        label: "Archive all",
        icon: "Archive",
        onSelect: () => archiveAll(threadIds),
      },
    ];
  };
  const snoozeAll = (snoozedUntil: number) =>
    parkAll("Snoozed", (threadIds) =>
      lifecycle.snoozeMany(threadIds, snoozedUntil),
    );

  const inboxIdsRef = useRef<ReadonlySet<string>>(new Set());
  inboxIdsRef.current = new Set(inbox.map((thread) => thread.id));
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const previousActiveRef = useRef(activeThreadId);
  useEffect(() => {
    const left = previousActiveRef.current;
    previousActiveRef.current = activeThreadId;
    const since = settleOnRead.since;
    if (since === null || left === null || left === activeThreadId) return;
    const byId = new Map(
      threadsRef.current.map((thread) => [thread.id, thread]),
    );
    const leftFamily = familyRootId(byId, left);
    if (
      activeThreadId !== null &&
      familyRootId(byId, activeThreadId) === leftFamily
    ) {
      return;
    }
    if (!inboxIdsRef.current.has(leftFamily)) return;
    const root = byId.get(leftFamily);
    if (!root || root.isUnread || root.isPinned) return;
    if (root.lastReadAt === null || root.lastReadAt < since) return;
    if (!isIdle(root) || hasDescendantWaitingForYou(root)) return;
    lifecycle.settle(leftFamily);
  }, [activeThreadId]);

  const childToggleFor = (
    thread: PluginSidebarThread,
  ): ChildToggle | undefined =>
    (childrenById.get(thread.id)?.length ?? 0) > 0
      ? {
          collapsed: !expandedParents.has(thread.id),
          onToggle: () => toggleParent(thread.id),
        }
      : undefined;

  const statusThreadFor = (thread: PluginSidebarThread) =>
    expandedParents.has(thread.id)
      ? thread
      : (summaries.get(thread.id)?.mostUrgent ?? thread);

  const renderChildren = (
    parent: PluginSidebarThread,
    depth: number,
    ancestors: ReadonlySet<string>,
  ): ReactNode => {
    if (!expandedParents.has(parent.id)) return null;
    return (childrenById.get(parent.id) ?? [])
      .filter((child) => !ancestors.has(child.id))
      .map((child) => (
        <Fragment key={child.id}>
          <SidebarRow
            thread={child}
            isActive={child.id === activeThreadId}
            depth={depth}
            childToggle={childToggleFor(child)}
            trailing={<ThreadStatus thread={statusThreadFor(child)} />}
            actions={[]}
            quickActionKeys={ARCHIVE_QUICK_ACTION_KEYS}
            onNavigate={onNavigate}
          />
          {renderChildren(child, depth + 1, new Set([...ancestors, child.id]))}
        </Fragment>
      ));
  };

  const pinnedIds = useMemo(() => pinned.map((thread) => thread.id), [pinned]);
  const reorderPinned = useCallback(
    (request: PinnedReorderRequest) => sdk.threads.reorderPinned(request),
    [sdk],
  );
  const pinnedReorder = usePinnedReorder(pinnedIds, reorderPinned);
  const orderedPinned = useMemo(() => {
    const byId = new Map(pinned.map((thread) => [thread.id, thread]));
    return pinnedReorder.order.flatMap((id) => {
      const thread = byId.get(id);
      return thread ? [thread] : [];
    });
  }, [pinned, pinnedReorder.order]);

  const renderInboxTree = (
    thread: PluginSidebarThread,
    reorder?: PinnedDragBindings,
  ) => (
    <Fragment key={thread.id}>
      <InboxRow
        thread={thread}
        isActive={thread.id === activeThreadId}
        canPark={
          !thread.isPinned &&
          lifecycle.canPark(thread) &&
          !hasDescendantWaitingForYou(thread)
        }
        onNavigate={onNavigate}
        onSettle={() => lifecycle.settle(thread.id)}
        onSnooze={(until) => lifecycle.snooze(thread.id, until)}
        quickActionKeys={
          thread.isPinned ? ARCHIVE_QUICK_ACTION_KEYS : undefined
        }
        childToggle={childToggleFor(thread)}
        statusThread={statusThreadFor(thread)}
        reorder={reorder}
      />
      {renderChildren(thread, 1, new Set([thread.id]))}
    </Fragment>
  );

  const scopeLabel =
    scope === ALL_PROJECTS
      ? "All projects"
      : (projectNameById.get(scope) ?? "All projects");

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The one control the host has no equivalent for. Everything else in
          the chrome above — New thread, search — is bb's and stays bb's. */}
        <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
          <Select value={scope} onValueChange={setScope}>
            {/* Ghost trigger: no border, no filled track — it reads as a label
              until you hover it. */}
            <SelectTrigger
              className="h-7 min-w-0 flex-1 border-0 px-1.5 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-sidebar-accent focus:ring-0"
              aria-label={`Project scope: ${scopeLabel}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS} className="text-xs">
                All projects
              </SelectItem>
              {projects.map((project) => (
                <SelectItem
                  key={project.id}
                  value={project.id}
                  className="text-xs"
                >
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {status === "loading" || !lifecycle.isReady ? null : status ===
            "error" ? (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-muted-foreground"
            >
              Could not load threads.
            </p>
          ) : pinned.length +
              inbox.length +
              snoozed.length +
              settled.length +
              muted.length ===
            0 ? (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-muted-foreground"
            >
              {searchQuery.trim() ? "No threads found" : "No threads yet"}
            </p>
          ) : (
            <>
              {pinned.length > 0 ? (
                <Shelf
                  label="Pinned"
                  collapsed={isShelfCollapsed("pinned")}
                  onToggle={() => toggleShelfCollapsed("pinned")}
                >
                  {isShelfCollapsed("pinned") ? null : (
                    <PinnedSortableList
                      ids={pinnedReorder.order}
                      disabled={orderedPinned.length < 2}
                      onDragEnd={pinnedReorder.handleDragEnd}
                    >
                      {orderedPinned.map((thread) => (
                        <SortablePinnedItem key={thread.id} id={thread.id}>
                          {(dragBindings) =>
                            renderInboxTree(thread, dragBindings)
                          }
                        </SortablePinnedItem>
                      ))}
                    </PinnedSortableList>
                  )}
                </Shelf>
              ) : null}
              {inbox.length > 0 ? (
                <Shelf
                  label="Inbox"
                  collapsed={isShelfCollapsed("inbox")}
                  onToggle={() => toggleShelfCollapsed("inbox")}
                  actionsOpen={isInboxMenuOpen}
                  actions={
                    <InboxMenu
                      parkableCount={parkableInboxIds.length}
                      settleOnRead={settleOnRead.since !== null}
                      onSettleAll={settleAll}
                      onSnoozeAll={snoozeAll}
                      onSettleOnReadChange={(enabled) =>
                        void settleOnRead
                          .setEnabled(enabled)
                          .catch(() =>
                            toast.error(
                              "Could not change Settle after reading",
                            ),
                          )
                      }
                      onOpenChange={setIsInboxMenuOpen}
                    />
                  }
                >
                  {isShelfCollapsed("inbox")
                    ? null
                    : inbox.map((thread) => renderInboxTree(thread))}
                </Shelf>
              ) : null}
              {(["snoozed", "settled", "muted"] as const).map((shelf) => {
                const parked =
                  shelf === "snoozed"
                    ? snoozed
                    : shelf === "settled"
                      ? settled
                      : muted;
                if (parked.length === 0) return null;
                return (
                  <Shelf
                    key={shelf}
                    label={PARKED_SHELF_LABELS[shelf]}
                    collapsed={isShelfCollapsed(shelf)}
                    onToggle={() => toggleShelfCollapsed(shelf)}
                    actionsOpen={openShelfMenu === shelf}
                    actions={
                      <ShelfMenu
                        label={PARKED_SHELF_LABELS[shelf]}
                        items={shelfMenuItems(
                          shelf,
                          parked.map((thread) => thread.id),
                        )}
                        choice={
                          shelf === "settled"
                            ? {
                                label: "Auto-archive",
                                icon: "Archive",
                                value:
                                  settleOnRead.autoArchiveDays === null
                                    ? "never"
                                    : String(settleOnRead.autoArchiveDays),
                                options: AUTO_ARCHIVE_OPTIONS,
                                onChange: (value) =>
                                  void settleOnRead
                                    .setAutoArchiveDays(
                                      value === "never" ? null : Number(value),
                                    )
                                    .catch(() =>
                                      toast.error(
                                        "Could not change auto-archive",
                                      ),
                                    ),
                              }
                            : undefined
                        }
                        onOpenChange={(open) =>
                          setOpenShelfMenu(open ? shelf : null)
                        }
                      />
                    }
                    trailing={
                      shelf === "muted" && mutedThreadAsks ? (
                        <ThreadStatusGlyph indicator="waiting-for-input" />
                      ) : null
                    }
                  >
                    {isShelfCollapsed(shelf)
                      ? null
                      : parked.map((thread) => (
                          <Fragment key={thread.id}>
                            <ParkedRow
                              thread={thread}
                              isActive={thread.id === activeThreadId}
                              shelf={shelf}
                              wakeAt={lifecycle.wakeAtFor(thread)}
                              now={Date.now()}
                              onNavigate={onNavigate}
                              onRestore={() => restoreParked(shelf, thread.id)}
                              childToggle={childToggleFor(thread)}
                              statusThread={statusThreadFor(thread)}
                            />
                            {renderChildren(thread, 1, new Set([thread.id]))}
                          </Fragment>
                        ))}
                  </Shelf>
                );
              })}
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

const SHELF_LABEL_CLASS =
  "bb-sidebar-hover-actions-row flex h-6 shrink-0 items-center rounded-md pl-2 pr-0 text-xs font-normal leading-5 text-subtle-foreground";

const SHELF_TOGGLE_CLASS =
  "relative z-20 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring transition-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 active:bg-state-active";

function Shelf({
  label,
  collapsed,
  onToggle,
  trailing,
  actions,
  actionsOpen = false,
  children,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
  actions?: ReactNode;
  actionsOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="mt-3 first:mt-0">
      <h2 className={SHELF_LABEL_CLASS}>
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="min-w-0 truncate">{label}</span>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={
              collapsed
                ? `Expand ${label} section`
                : `Collapse ${label} section`
            }
            data-sidebar-hover-actions-mobile="always"
            onClick={onToggle}
            className={cn(
              !collapsed && "bb-sidebar-hover-actions",
              SHELF_TOGGLE_CLASS,
            )}
          >
            <Icon
              name="ChevronRight"
              aria-hidden="true"
              className={cn(
                "size-3 transition-transform duration-150",
                !collapsed && "rotate-90",
              )}
            />
          </button>
        </span>
        {actions ? (
          <span
            data-sidebar-hover-actions-open={actionsOpen ? "true" : undefined}
            className="bb-sidebar-hover-actions flex shrink-0 items-center [@media(hover:none)]:opacity-100"
          >
            {actions}
          </span>
        ) : null}
        {trailing ? (
          <span
            data-shelf-trailing=""
            className="flex h-7 w-7 shrink-0 items-center justify-center"
          >
            {trailing}
          </span>
        ) : null}
      </h2>
      {collapsed ? null : (
        <ul className="mt-1 flex flex-col gap-px">{children}</ul>
      )}
    </section>
  );
}
