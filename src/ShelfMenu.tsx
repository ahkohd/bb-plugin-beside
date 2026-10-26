import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { experimental_Icon as BbIcon } from "@get-bb/plugin-sdk/app";
import { cn } from "./lib/utils";
import { usePortalScopeProps } from "./lib/portal-scope";
import { BUTTON_ICON_CLASS, CONTROL_BUTTON_CLASS } from "./SidebarRow";
import {
  MENU_CHECKBOX_ITEM_CLASS,
  MENU_CONTENT_CLASS,
  MENU_ITEM_CLASS,
  MENU_SUB_TRIGGER_CLASS,
} from "./menuStyles";
import { Icon } from "./components/Icon";

export interface ShelfMenuItem {
  label: string;
  icon: string;
  onSelect: () => void;
}

export interface ShelfMenuChoice {
  label: string;
  icon: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function ShelfMenu({
  label,
  items,
  choice,
  onOpenChange,
}: {
  label: string;
  items: readonly ShelfMenuItem[];
  choice?: ShelfMenuChoice;
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
          {choice ? (
            <>
              <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-muted" />
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className={MENU_SUB_TRIGGER_CLASS}>
                  <BbIcon name={choice.icon} className="size-4 shrink-0" />
                  {choice.label}
                  <Icon
                    name="ChevronRight"
                    className="ml-auto size-4 shrink-0"
                  />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    {...scopeProps}
                    sideOffset={4}
                    className={MENU_CONTENT_CLASS}
                  >
                    <DropdownMenu.RadioGroup
                      value={choice.value}
                      onValueChange={choice.onChange}
                    >
                      {choice.options.map((option) => (
                        <DropdownMenu.RadioItem
                          key={option.value}
                          value={option.value}
                          className={MENU_CHECKBOX_ITEM_CLASS}
                        >
                          <span className="absolute right-2 flex size-3.5 items-center justify-center">
                            <DropdownMenu.ItemIndicator>
                              <Icon name="Check" className="size-3.5" />
                            </DropdownMenu.ItemIndicator>
                          </span>
                          {option.label}
                        </DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
