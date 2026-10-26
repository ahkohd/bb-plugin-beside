import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./components/Icon";
import { cn } from "./lib/utils";
import { RowContextMenu } from "./RowContextMenu";
import { threadDisplayTitle } from "./inbox";

export interface RowAction {
  label: string;
  icon: IconName;
  onActivate: () => void;
}

const ROW_CLASS =
  "bb-sidebar-hover-actions-row group/thread-row relative flex w-full cursor-pointer items-center gap-2 rounded-md pl-2 text-sm transition-none h-[var(--bb-sidebar-row-height)] max-md:pointer-coarse:h-[var(--bb-sidebar-row-height-coarse)]";

const ROW_INTERACTIVE_CLASS =
  "bb-sidebar-accent-row hover:bg-sidebar-accent hover:text-sidebar-accent-foreground has-[[data-state=open]]:bg-sidebar-accent";

const ROW_SELECTED_CLASS = "bb-sidebar-selected-row bg-state-active";

const TRAILING_SLOT_CLASS =
  "relative h-7 w-7 shrink-0 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9";

const CONTROL_BUTTON_CLASS =
  "relative m-0 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md p-0 text-subtle-foreground outline-none hover:bg-state-hover hover:text-muted-foreground active:bg-state-active focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9";

function hoverActionsInsetStyle(actionCount: number): CSSProperties {
  const extraActions = Math.max(0, actionCount - 1);
  return {
    "--bb-sidebar-hover-actions-inset": `calc(var(--spacing) * ${7.5 * extraActions})`,
  } as CSSProperties;
}

export function SidebarRow({
  thread,
  isActive,
  muted = false,
  trailing,
  actions,
  onNavigate,
}: {
  thread: PluginSidebarThread;
  isActive: boolean;
  muted?: boolean;
  trailing: ReactNode;
  actions: readonly RowAction[];
  onNavigate: () => void;
}) {
  const threadActions = useSidebarThreadActions();
  const { splitProps, layout } = useSidebarThreadSplit(thread.id);
  const title = threadDisplayTitle(thread);
  const hasActions = actions.length > 0;

  return (
    <RowContextMenu thread={thread}>
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
        >
          <span
            className={cn(
              "relative flex min-w-0 flex-1 items-center self-stretch",
              hasActions && "bb-sidebar-hover-actions-inset",
            )}
            style={hasActions ? hoverActionsInsetStyle(actions.length) : undefined}
          >
            <a
              data-sidebar-thread-shortcut-target=""
              data-sidebar-thread-id={thread.id}
              href="#"
              aria-label={title}
              {...splitProps}
              onClick={(event) => {
                event.preventDefault();
                threadActions.open(thread.id, {
                  split: event.metaKey || event.ctrlKey,
                });
                onNavigate();
              }}
              className="absolute inset-0 rounded-md outline-none"
            />
            <span className="pointer-events-none relative min-w-0 truncate">
              {title}
            </span>
          </span>
          <span data-sidebar-thread-trailing="" className="flex shrink-0 items-center">
            <span className={TRAILING_SLOT_CLASS}>
              <span
                className={cn(
                  "pointer-events-none absolute inset-0 flex items-center justify-center",
                  hasActions && "bb-sidebar-hover-actions-fade",
                )}
              >
                {trailing}
              </span>
              {hasActions ? (
                <div className="bb-sidebar-hover-actions absolute inset-y-0 right-0 z-10 flex items-center justify-end gap-0.5 [@media(hover:none)]:hidden">
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      aria-label={action.label}
                      title={action.label}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.detail > 0) event.currentTarget.blur();
                        action.onActivate();
                      }}
                      className={CONTROL_BUTTON_CLASS}
                    >
                      <Icon
                        name={action.icon}
                        className="size-4 max-md:pointer-coarse:size-5"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
          </span>
        </div>
      </li>
    </RowContextMenu>
  );
}
