import {
  experimental_Icon as BbIcon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  experimental_useThreadActions as useThreadActions,
  useBbNavigate,
  type PluginSidebarPullRequest,
  type PluginSidebarThread,
  type PluginThreadActionsTriggerProps,
} from "@get-bb/plugin-sdk/app";
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./components/Icon";
import { cn } from "./lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/Tooltip";
import { threadDisplayTitle } from "./inbox";
import { RenameEditor, useInlineRename } from "./inlineRename";
import { toThreadActionTarget } from "./threadActionTarget";
import type { PinnedDragBindings } from "./PinnedSortable";
import { useRowWindowing } from "./rowWindowing";

export interface ChildToggle {
  collapsed: boolean;
  onToggle: () => void;
}

export interface RowAction {
  label: string;
  icon: IconName;
  onActivate: () => void;
}

interface HoverButton {
  key: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onActivate: () => void;
}

const NO_QUICK_ACTIONS: readonly string[] = [];

const ROW_CLASS =
  "bb-sidebar-hover-actions-row group/thread-row relative flex w-full cursor-pointer items-center gap-2 rounded-md text-sm transition-none h-[var(--bb-sidebar-row-height)] max-md:pointer-coarse:h-[var(--bb-sidebar-row-height-coarse)]";

const ROW_INTERACTIVE_CLASS =
  "bb-sidebar-accent-row hover:bg-sidebar-accent hover:text-sidebar-accent-foreground has-[[data-state=open]]:bg-sidebar-accent";

const ROW_SELECTED_CLASS = "bb-sidebar-selected-row bg-state-active";

const TRAILING_SLOT_CLASS =
  "relative h-7 w-7 shrink-0 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9";

const CHILD_TOGGLE_CLASS =
  "relative z-10 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring transition-none hover:bg-state-hover hover:text-muted-foreground focus-visible:ring-2 active:bg-state-active";

const ROW_BASE_PADDING_PX = 8;
const ROW_DEPTH_STEP_PX = 24;
const GUIDE_LINE_OFFSET_PX = 8;

function rowPaddingLeft(depth: number): number {
  return ROW_BASE_PADDING_PX + depth * ROW_DEPTH_STEP_PX;
}

export const CONTROL_BUTTON_CLASS =
  "relative m-0 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md p-0 text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground active:bg-state-active focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9";

export const BUTTON_ICON_CLASS = "size-4 max-md:pointer-coarse:size-5";

const BUTTON_WIDTH_SPACING = 7.5;
const PULL_REQUEST_WIDTH_SPACING = 12.5;

function hoverActionsInsetStyle(
  buttonCount: number,
  hasPullRequest: boolean,
): CSSProperties {
  const buttonsBeyondSlot = Math.max(0, buttonCount - 1);
  const inset =
    BUTTON_WIDTH_SPACING * buttonsBeyondSlot +
    (hasPullRequest ? PULL_REQUEST_WIDTH_SPACING : 0);
  return {
    "--bb-sidebar-hover-actions-inset": `calc(var(--spacing) * ${inset})`,
  } as CSSProperties;
}

function pullRequestToneClass(pullRequest: PluginSidebarPullRequest): string {
  if (pullRequest.state === "merged") return "text-[color:var(--pr-merged)]";
  if (
    pullRequest.attention === "checks_failed" ||
    pullRequest.attention === "conflicts"
  ) {
    return "text-destructive-text";
  }
  if (pullRequest.attention === "ready_to_merge") {
    return "text-success-foreground";
  }
  return "text-muted-foreground";
}

function PullRequestLink({
  pullRequest,
}: {
  pullRequest: PluginSidebarPullRequest;
}) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Pull request #${pullRequest.number}: ${pullRequest.title}`}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex h-7 w-12 shrink-0 items-center justify-center rounded-md font-mono text-xs outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:pointer-coarse:h-9",
            pullRequestToneClass(pullRequest),
          )}
        >
          #{pullRequest.number}
        </a>
      </TooltipTrigger>
      <TooltipContent side="bottom">{pullRequest.title}</TooltipContent>
    </Tooltip>
  );
}

function HoverActionButton({ button }: { button: HoverButton }) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={button.label}
          disabled={button.disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.detail > 0) event.currentTarget.blur();
            button.onActivate();
          }}
          className={CONTROL_BUTTON_CLASS}
        >
          {button.icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{button.label}</TooltipContent>
    </Tooltip>
  );
}

function renderMenuTrigger(props: PluginThreadActionsTriggerProps) {
  return (
    <button
      {...props}
      type="button"
      aria-label="Thread actions"
      className={cn(
        props.className,
        CONTROL_BUTTON_CLASS,
        "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
      )}
      onClick={(event) => {
        props.onClick?.(event);
        event.stopPropagation();
      }}
    >
      <BbIcon name="MoreHorizontal" className={BUTTON_ICON_CLASS} />
    </button>
  );
}

function dragHandleAttributes(reorder: PinnedDragBindings | undefined) {
  if (!reorder) return {};
  const {
    role: _role,
    tabIndex: _tabIndex,
    ...attributes
  } = reorder.attributes;
  return attributes;
}

interface SidebarRowProps {
  thread: PluginSidebarThread;
  isActive: boolean;
  muted?: boolean;
  depth?: number;
  childToggle?: ChildToggle;
  trailing: ReactNode;
  actions: readonly RowAction[];
  quickActionKeys?: readonly string[];
  reorder?: PinnedDragBindings;
  onNavigate: () => void;
}

export function SidebarRow(props: SidebarRowProps) {
  const windowing = useRowWindowing();
  const register = windowing?.register(props.thread.id);
  const staysMounted = props.isActive || props.reorder !== undefined;
  if (windowing && !staysMounted && !windowing.isRealized(props.thread.id)) {
    return (
      <RowPlaceholder
        thread={props.thread}
        depth={props.depth ?? 0}
        muted={props.muted ?? false}
        listItemRef={register}
        onNavigate={props.onNavigate}
      />
    );
  }
  return <RealizedSidebarRow {...props} listItemRef={register} />;
}

function RowPlaceholder({
  thread,
  depth,
  muted,
  listItemRef,
  onNavigate,
}: {
  thread: PluginSidebarThread;
  depth: number;
  muted: boolean;
  listItemRef?: (element: HTMLElement | null) => void;
  onNavigate: () => void;
}) {
  const navigate = useBbNavigate();
  const title = threadDisplayTitle(thread);
  return (
    <li ref={listItemRef} className="list-none" data-row-placeholder="">
      <a
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={thread.id}
        href={thread.href}
        aria-label={title}
        onClick={(event) => {
          event.preventDefault();
          navigate.toThread(thread.id, {
            split: event.metaKey || event.ctrlKey,
          });
          onNavigate();
        }}
        className={cn(
          ROW_CLASS,
          ROW_INTERACTIVE_CLASS,
          muted ? "text-muted-foreground" : "text-sidebar-foreground",
        )}
        style={{ paddingLeft: rowPaddingLeft(depth) }}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </a>
    </li>
  );
}

function RealizedSidebarRow({
  thread,
  isActive,
  muted = false,
  depth = 0,
  childToggle,
  trailing,
  actions,
  quickActionKeys = NO_QUICK_ACTIONS,
  reorder,
  onNavigate,
  listItemRef,
}: SidebarRowProps & {
  listItemRef?: (element: HTMLElement | null) => void;
}) {
  const navigate = useBbNavigate();
  const { splitProps, layout } = useSidebarThreadSplit(thread.id);
  const { pullRequest } = useSidebarThreadPullRequest(thread.id);
  const actionTarget = toThreadActionTarget(thread);
  const title = threadDisplayTitle(thread);
  const rename = useInlineRename(thread.id, title);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const setDragActivator = reorder?.setActivatorNodeRef;
  const setAnchor = useCallback(
    (element: HTMLAnchorElement | null) => {
      anchorRef.current = element;
      setDragActivator?.(element);
    },
    [setDragActivator],
  );
  const quickActions = useThreadActions(actionTarget, {
    keys: quickActionKeys,
    requestRename: rename.start,
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const hoverButtons: HoverButton[] = [
    ...actions.map((action) => ({
      key: action.label,
      label: action.label,
      icon: <Icon name={action.icon} className={BUTTON_ICON_CLASS} />,
      onActivate: action.onActivate,
    })),
    ...quickActions.map((entry) => ({
      key: entry.key,
      label: entry.action.label,
      icon: <BbIcon name={entry.action.icon} className={BUTTON_ICON_CLASS} />,
      disabled: entry.action.disabled,
      onActivate: () => void entry.action.run(),
    })),
  ];
  const hoverActionsOpen = isMenuOpen ? "true" : undefined;

  return (
    <ThreadActionsContextMenu
      thread={actionTarget}
      requestRename={rename.menuRequestRename}
      onCloseAutoFocus={rename.onMenuCloseAutoFocus}
      disabled={rename.isEditing}
    >
      <li ref={listItemRef} className="list-none" data-sidebar-rename-row="">
        <div
          className={cn(
            ROW_CLASS,
            isActive ? ROW_SELECTED_CLASS : ROW_INTERACTIVE_CLASS,
            !isActive && layout !== null && "bb-sidebar-open-in-split-row",
            muted && !isActive
              ? "text-muted-foreground"
              : "text-sidebar-foreground",
            reorder && "select-none",
          )}
          style={{ paddingLeft: rowPaddingLeft(depth) }}
        >
          {depth > 0 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-0.5 top-0 z-[1] w-px bg-border-hairline opacity-70"
              style={{ left: rowPaddingLeft(depth - 1) + GUIDE_LINE_OFFSET_PX }}
            />
          ) : null}
          <span
            className="bb-sidebar-hover-actions-inset relative flex min-w-0 flex-1 items-center self-stretch"
            style={hoverActionsInsetStyle(
              hoverButtons.length + 1,
              pullRequest !== null,
            )}
          >
            <a
              data-sidebar-thread-shortcut-target=""
              data-sidebar-thread-id={thread.id}
              data-sidebar-rename-anchor=""
              href={thread.href}
              aria-label={title}
              {...splitProps}
              draggable={false}
              ref={setAnchor}
              {...dragHandleAttributes(reorder)}
              {...reorder?.listeners}
              onClick={(event) => {
                event.preventDefault();
                if (rename.isEditing) {
                  event.stopPropagation();
                  return;
                }
                navigate.toThread(thread.id, {
                  split: event.metaKey || event.ctrlKey,
                });
                onNavigate();
              }}
              onDoubleClick={(event) => {
                if (rename.isEditing) return;
                event.preventDefault();
                event.stopPropagation();
                rename.startFromDoubleClick();
              }}
              className="absolute inset-0 rounded-md outline-none"
            />
            {rename.isEditing ? (
              <RenameEditor
                rename={rename}
                label="Thread name"
                anchor={() => anchorRef.current}
              />
            ) : (
              <span className="pointer-events-none relative min-w-0 truncate">
                {title}
              </span>
            )}
            {childToggle ? (
              <button
                type="button"
                aria-expanded={!childToggle.collapsed}
                aria-label={
                  childToggle.collapsed
                    ? `Expand ${title} threads`
                    : `Collapse ${title} threads`
                }
                data-sidebar-hover-actions-mobile={
                  childToggle.collapsed ? undefined : "always"
                }
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  childToggle.onToggle();
                }}
                className={cn(
                  "ml-1",
                  childToggle.collapsed
                    ? "pointer-events-auto"
                    : "bb-sidebar-hover-actions",
                  CHILD_TOGGLE_CLASS,
                )}
              >
                <Icon
                  name="ChevronRight"
                  aria-hidden="true"
                  className={cn(
                    "size-3 transition-transform duration-150",
                    !childToggle.collapsed && "rotate-90",
                  )}
                />
              </button>
            ) : null}
          </span>
          <span
            data-sidebar-thread-trailing=""
            className={cn(
              "flex shrink-0 items-center",
              rename.isEditing && "hidden",
            )}
          >
            <span className={TRAILING_SLOT_CLASS}>
              <span
                data-sidebar-hover-actions-open={hoverActionsOpen}
                className="bb-sidebar-hover-actions-fade pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                {trailing}
              </span>
              <div
                data-sidebar-hover-actions-open={hoverActionsOpen}
                className="bb-sidebar-hover-actions absolute inset-y-0 right-0 z-10 flex items-center justify-end gap-0.5 [@media(hover:none)]:hidden"
              >
                {pullRequest ? (
                  <PullRequestLink pullRequest={pullRequest} />
                ) : null}
                {hoverButtons.map((button) => (
                  <HoverActionButton key={button.key} button={button} />
                ))}
                <ThreadActionsMenu
                  thread={actionTarget}
                  requestRename={rename.menuRequestRename}
                  onCloseAutoFocus={rename.onMenuCloseAutoFocus}
                  trigger={renderMenuTrigger}
                  side="right"
                  align="start"
                  sideOffset={8}
                  onOpenChange={setIsMenuOpen}
                />
              </div>
            </span>
          </span>
        </div>
      </li>
    </ThreadActionsContextMenu>
  );
}
