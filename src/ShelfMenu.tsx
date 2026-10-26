import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as BbIcon } from "@get-bb/plugin-sdk/app";
import { cn } from "./lib/utils";
import { usePortalScopeProps } from "./lib/portal-scope";
import { BUTTON_ICON_CLASS, CONTROL_BUTTON_CLASS } from "./SidebarRow";
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS } from "./menuStyles";

export interface ShelfMenuItem {
  label: string;
  icon: string;
  onSelect: () => void;
}

export function ShelfMenu({
  label,
  items,
  onOpenChange,
}: {
  label: string;
  items: readonly ShelfMenuItem[];
  onOpenChange: (open: boolean) => void;
}) {
  const scopeProps = usePortalScopeProps();
  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${label} actions`}
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
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              className={MENU_ITEM_CLASS}
              onSelect={item.onSelect}
            >
              <BbIcon name={item.icon} className="size-4 shrink-0" />
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
