import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
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
import { mostUrgentIndicator } from "./statusRollup";
import { useLifecycle } from "./useLifecycle";
import { useSyncedLayout } from "./useSyncedLayout";
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
  descendantsOf,
  filterByProject,
  hideChildrenOfVisibleParents,
  sortPinned,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  visibleInboxThreads,
} from "./inbox";

const ALL_PROJECTS = "__all__";

const ARCHIVE_QUICK_ACTION_KEYS = ["bb--core/archive"] as const;

type ShelfId = "pinned" | "inbox" | "snoozed" | "settled";

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
  const lifecycle = useLifecycle(threads);
  const [scope, setScope] = useState<string>(ALL_PROJECTS);
  const { collapsedShelves, expandedParents, toggleShelf, toggleParent } =
    useSyncedLayout(DEFAULT_LAYOUT);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const { pinned, inbox, snoozed, settled, childrenById, hasBusyDescendant } =
    useMemo(() => {
      const scoped = filterByProject(
        visibleInboxThreads(threads),
        scope === ALL_PROJECTS ? null : scope,
      );
      const searched = searchThreadsByTitle(scoped, searchQuery);
      const childrenById = childrenByParentId(
        searched.filter((thread) => !thread.isPinned),
      );
      const hasBusyDescendant = (thread: PluginSidebarThread) =>
        descendantsOf(childrenById, thread.id).some(
          (descendant) => !lifecycle.canPark(descendant),
        );
      const matched = hideChildrenOfVisibleParents(searched).filter(
        (thread) => !thread.isPinned,
      );
      const active: typeof matched = [];
      const onSnoozeShelf: typeof matched = [];
      const onSettledShelf: typeof matched = [];
      for (const thread of matched) {
        const ownShelf = lifecycle.shelfFor(thread);
        const shelf =
          ownShelf !== "active" && hasBusyDescendant(thread)
            ? "active"
            : ownShelf;
        if (shelf === "snoozed") onSnoozeShelf.push(thread);
        else if (shelf === "settled") onSettledShelf.push(thread);
        else active.push(thread);
      }
      return {
        pinned: sortPinned(searched.filter((thread) => thread.isPinned)),
        inbox: sortByCreatedAtDescending(active),
        // Soonest wake first: "what comes back next" is the shelf's question.
        snoozed: [...onSnoozeShelf].sort(
          (left, right) =>
            (lifecycle.wakeAtFor(left) ?? 0) -
            (lifecycle.wakeAtFor(right) ?? 0),
        ),
        settled: sortByCreatedAtDescending(onSettledShelf),
        childrenById,
        hasBusyDescendant,
      };
    }, [lifecycle, scope, searchQuery, threads]);

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
      : (mostUrgentIndicator([
          thread,
          ...descendantsOf(childrenById, thread.id),
        ]) ?? thread);

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

  const sdk = useSdk();
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
          !hasBusyDescendant(thread)
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
          {status === "loading" ? null : status === "error" ? (
            <p
              role="status"
              className="px-2 py-6 text-center text-xs text-muted-foreground"
            >
              Could not load threads.
            </p>
          ) : pinned.length + inbox.length + snoozed.length + settled.length ===
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
                  collapsed={collapsedShelves.has("pinned")}
                  onToggle={() => toggleShelf("pinned")}
                >
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
                </Shelf>
              ) : null}
              {inbox.length > 0 ? (
                <Shelf
                  label="Inbox"
                  collapsed={collapsedShelves.has("inbox")}
                  onToggle={() => toggleShelf("inbox")}
                >
                  {inbox.map((thread) => renderInboxTree(thread))}
                </Shelf>
              ) : null}
              {(["snoozed", "settled"] as const).map((shelf) => {
                const parked = shelf === "snoozed" ? snoozed : settled;
                if (parked.length === 0) return null;
                return (
                  <Shelf
                    key={shelf}
                    label={shelf === "snoozed" ? "Snoozed" : "Settled"}
                    collapsed={collapsedShelves.has(shelf)}
                    onToggle={() => toggleShelf(shelf)}
                  >
                    {parked.map((thread) => (
                      <Fragment key={thread.id}>
                        <ParkedRow
                          thread={thread}
                          isActive={thread.id === activeThreadId}
                          shelf={shelf}
                          wakeAt={lifecycle.wakeAtFor(thread)}
                          now={Date.now()}
                          onNavigate={onNavigate}
                          onRestore={() =>
                            shelf === "snoozed"
                              ? lifecycle.unsnooze(thread.id)
                              : lifecycle.unsettle(thread.id)
                          }
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
  "bb-sidebar-hover-actions-row flex h-6 shrink-0 items-center rounded-md pl-2 pr-0 text-xs font-normal leading-5 text-muted-foreground";

const SHELF_TOGGLE_CLASS =
  "relative z-20 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring transition-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 active:bg-state-active";

function Shelf({
  label,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
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
      </h2>
      {collapsed ? null : (
        <ul className="mt-1 flex flex-col gap-px">{children}</ul>
      )}
    </section>
  );
}
