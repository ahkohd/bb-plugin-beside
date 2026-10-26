import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as BbIcon } from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import { usePortalScopeProps } from "./lib/portal-scope";
import { BUTTON_ICON_CLASS, CONTROL_BUTTON_CLASS } from "./SidebarRow";
import { resolveSnoozePresets } from "./lifecycle";
import {
  MENU_CHECKBOX_ITEM_CLASS,
  MENU_CONTENT_CLASS,
  MENU_ITEM_CLASS,
  MENU_SUB_TRIGGER_CLASS,
} from "./menuStyles";

export function InboxMenu({
  parkableCount,
  settleOnRead,
  onSettleAll,
  onSnoozeAll,
  onSettleOnReadChange,
  onOpenChange,
}: {
  parkableCount: number;
  settleOnRead: boolean;
  onSettleAll: () => void;
  onSnoozeAll: (snoozedUntil: number) => void;
  onSettleOnReadChange: (enabled: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const scopeProps = usePortalScopeProps();
  const [presets, setPresets] = useState(() =>
    resolveSnoozePresets(new Date()),
  );
  const nothingToPark = parkableCount === 0;

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) setPresets(resolveSnoozePresets(new Date()));
        onOpenChange(open);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Inbox actions"
          className={cn(
            CONTROL_BUTTON_CLASS,
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
          )}
        >
          <BbIcon name="MoreHorizontal" className={BUTTON_ICON_CLASS} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          {...scopeProps}
          side="right"
          align="start"
          sideOffset={8}
          className={MENU_CONTENT_CLASS}
        >
          <DropdownMenu.Item
            className={MENU_ITEM_CLASS}
            disabled={nothingToPark}
            onSelect={onSettleAll}
          >
            <Icon name="Check" />
            Settle all
          </DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger
              className={MENU_SUB_TRIGGER_CLASS}
              disabled={nothingToPark}
            >
              <Icon name="Clock" />
              Snooze all
              <Icon name="ChevronRight" className="ml-auto" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                {...scopeProps}
                sideOffset={4}
                className={MENU_CONTENT_CLASS}
              >
                {presets.map((preset) => (
                  <DropdownMenu.Item
                    key={preset.id}
                    className={MENU_ITEM_CLASS}
                    onSelect={() => onSnoozeAll(preset.snoozedUntil)}
                  >
                    {preset.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-muted" />
          <DropdownMenu.CheckboxItem
            className={MENU_CHECKBOX_ITEM_CLASS}
            checked={settleOnRead}
            onCheckedChange={(checked) =>
              onSettleOnReadChange(checked === true)
            }
          >
            <span className="absolute right-2 flex size-3.5 items-center justify-center">
              <DropdownMenu.ItemIndicator>
                <Icon name="Check" className="size-3.5" />
              </DropdownMenu.ItemIndicator>
            </span>
            <Icon name="MailOpen" className="size-4 shrink-0" />
            Settle after reading
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
