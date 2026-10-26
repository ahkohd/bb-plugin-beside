import {
  experimental_Icon as BbIcon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  experimental_useThreadActions as useThreadActions,
  useBbNavigate,
  type PluginSidebarThread,
  type PluginThreadActionsTriggerProps,
} from "@get-bb/plugin-sdk/app";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./components/Icon";
import { cn } from "./lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/Tooltip";
import { threadDisplayTitle } from "./inbox";
import { toThreadActionTarget } from "./threadActionTarget";

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

const CONTROL_BUTTON_CLASS =
  "relative m-0 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md p-0 text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground active:bg-state-active focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9";

const BUTTON_ICON_CLASS = "size-4 max-md:pointer-coarse:size-5";

function hoverActionsInsetStyle(buttonCount: number): CSSProperties {
  const buttonsBeyondSlot = Math.max(0, buttonCount - 1);
  return {
    "--bb-sidebar-hover-actions-inset": `calc(var(--spacing) * ${7.5 * buttonsBeyondSlot})`,
  } as CSSProperties;
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

export function SidebarRow({
  thread,
  isActive,
  muted = false,
  depth = 0,
  childToggle,
  trailing,
  actions,
  quickActionKeys = NO_QUICK_ACTIONS,
  onNavigate,
}: {
  thread: PluginSidebarThread;
  isActive: boolean;
  muted?: boolean;
  depth?: number;
  childToggle?: ChildToggle;
  trailing: ReactNode;
  actions: readonly RowAction[];
  quickActionKeys?: readonly string[];
  onNavigate: () => void;
}) {
  const navigate = useBbNavigate();
  const { splitProps, layout } = useSidebarThreadSplit(thread.id);
  const actionTarget = toThreadActionTarget(thread);
  const quickActions = useThreadActions(actionTarget, {
    keys: quickActionKeys,
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const title = threadDisplayTitle(thread);
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
    <ThreadActionsContextMenu thread={actionTarget}>
      <li className="list-none">
        <div
          className={cn(
            ROW_CLASS,
            isActive ? ROW_SELECTED_CLASS : ROW_INTERACTIVE_CLASS,
            !isActive && layout !== null && "bb-sidebar-open-in-split-row",
            muted && !isActive
              ? "text-muted-foreground"
              : "text-sidebar-foreground",
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
            style={hoverActionsInsetStyle(hoverButtons.length + 1)}
          >
            <a
              data-sidebar-thread-shortcut-target=""
              data-sidebar-thread-id={thread.id}
              href={thread.href}
              aria-label={title}
              {...splitProps}
              onClick={(event) => {
                event.preventDefault();
                navigate.toThread(thread.id, {
                  split: event.metaKey || event.ctrlKey,
                });
                onNavigate();
              }}
              className="absolute inset-0 rounded-md outline-none"
            />
            <span className="pointer-events-none relative min-w-0 truncate">
              {title}
            </span>
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
            className="flex shrink-0 items-center"
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
                {hoverButtons.map((button) => (
                  <HoverActionButton key={button.key} button={button} />
                ))}
                <ThreadActionsMenu
                  thread={actionTarget}
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
