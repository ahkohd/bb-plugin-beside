import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import { usePortalScopeProps } from "./lib/portal-scope";

export interface ProjectOption {
  id: string;
  name: string;
}

function matchesQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

export function ProjectPicker({
  value,
  allValue,
  allLabel,
  projects,
  onChange,
}: {
  value: string;
  allValue: string;
  allLabel: string;
  projects: readonly ProjectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const options = useMemo(() => {
    const all = { id: allValue, name: allLabel };
    if (query.trim() === "") return [all, ...projects];
    return projects.filter((project) => matchesQuery(project.name, query));
  }, [allLabel, allValue, projects, query]);

  const selectedLabel =
    value === allValue
      ? allLabel
      : (projects.find((project) => project.id === value)?.name ?? allLabel);

  const openPicker = (next: boolean) => {
    if (next) {
      setQuery("");
      const ids = [allValue, ...projects.map((project) => project.id)];
      setHighlighted(Math.max(0, ids.indexOf(value)));
    }
    setOpen(next);
  };

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted, options]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => Math.max(0, index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlighted(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlighted(Math.max(0, options.length - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[highlighted];
      if (option) choose(option.id);
    }
  };

  const activeOption = options[highlighted];

  return (
    <Popover.Root open={open} onOpenChange={openPicker}>
      <Popover.Trigger
        aria-label={`Project scope: ${selectedLabel}`}
        aria-haspopup="listbox"
        className="group/scope flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-between whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:duration-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <Icon
          name="ChevronDown"
          aria-hidden="true"
          className="size-4 opacity-0 transition-opacity duration-150 group-hover/scope:opacity-50 group-focus-visible/scope:opacity-50 group-data-[state=open]/scope:opacity-50 [@media(hover:none)]:opacity-50"
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...usePortalScopeProps()}
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)
              ?.querySelector<HTMLInputElement>("input")
              ?.focus();
          }}
          className="z-50 flex max-h-96 w-[var(--radix-popover-trigger-width)] min-w-[12rem] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
        >
          <div className="flex items-center gap-2 border-b border-border px-2.5">
            <Icon name="Search" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              role="combobox"
              aria-label="Search projects"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                activeOption ? `${listId}-${highlighted}` : undefined
              }
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlighted(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search projects"
              className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Projects"
            className="min-h-0 flex-1 overflow-y-auto p-1"
          >
            {options.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No projects match.
              </p>
            ) : (
              options.map((option, index) => {
                const selected = option.id === value;
                return (
                  <div
                    key={option.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    data-index={index}
                    data-highlighted={index === highlighted ? "" : undefined}
                    onPointerMove={() => setHighlighted(index)}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(option.id)}
                    className={cn(
                      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-xs outline-none",
                      index === highlighted && "bg-state-hover text-foreground",
                    )}
                  >
                    <span className="min-w-0 truncate">{option.name}</span>
                    {selected ? (
                      <span className="absolute right-2 flex size-3.5 items-center justify-center">
                        <Icon name="Check" className="size-4" />
                      </span>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
