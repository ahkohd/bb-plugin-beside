// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";

// Load through the harness so the plugin's `@get-bb/plugin-sdk/app` import binds
// to the test runtime; importing the component directly would bind it to an
// empty runtime first.
const app = await loadPluginApp(() => import("../app"));
const inbox = app.threadLists[0]!;

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  const base: PluginSidebarThread = {
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: null,
    displayTitle: "A thread",
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: "#",
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  };
  return {
    ...base,
    displayTitle: overrides.displayTitle ?? base.title ?? base.displayTitle,
    href: overrides.href ?? `/threads/${base.id}`,
  };
}

const listProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate: () => {},
  searchQuery: "",
};

function render(
  threads: PluginSidebarThread[],
  projects = [
    {
      id: "proj_1",
      name: "bb",
      isPersonal: false,
      href: "/p/proj_1",
      settingsHref: "/p/proj_1/settings",
    },
  ],
) {
  return renderSlot(inbox, listProps, {
    sidebarThreads: { status: "ready", threads, projects },
    // The lifecycle store is the plugin's own backend; an empty one means
    // every thread is active, which is what these list tests are about.
    rpc: { listLifecycle: () => ({ rows: [] }) },
  });
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bb-sidebar registration", () => {
  it("registers exactly one thread list", () => {
    expect(app.threadLists).toHaveLength(1);
    expect(inbox.id).toBe("inbox");
  });
});

describe("ThreadInbox", () => {
  it("lists threads newest first", () => {
    render([
      thread({ id: "a", title: "Older", createdAt: 1 }),
      thread({ id: "b", title: "Newer", createdAt: 2 }),
    ]);
    // The anchor is a full-bleed overlay, so read the row containers.
    const titles = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(titles[0]).toContain("Newer");
    expect(titles[1]).toContain("Older");
  });

  // The DOM contract behind numbered thread shortcuts and thread.next/previous.
  // A plugin that drops these attributes silently breaks nine host shortcuts.
  it("marks every row as a host shortcut target", () => {
    render([thread({ id: "thr_x" })]);
    const row = screen.getByRole("link");
    expect(row.hasAttribute("data-sidebar-thread-shortcut-target")).toBe(true);
    expect(row.getAttribute("data-sidebar-thread-id")).toBe("thr_x");
  });

  it("opens a thread on click and closes the mobile drawer", () => {
    let navigated = 0;
    const rendered = renderSlot(
      inbox,
      { ...listProps, onNavigate: () => (navigated += 1) },
      {
        sidebarThreads: {
          status: "ready",
          threads: [thread({ id: "thr_open" })],
          projects: [
            {
              id: "proj_1",
              name: "bb",
              isPersonal: false,
              href: "/p/proj_1",
              settingsHref: "/p/proj_1/settings",
            },
          ],
        },
        rpc: { listLifecycle: () => ({ rows: [] }) },
      },
    );
    fireEvent.click(screen.getByRole("link"));
    expect(rendered.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_open",
      options: { split: false },
    });
    expect(navigated).toBe(1);
  });

  it("opens in a split with the platform modifier held", () => {
    const rendered = render([thread({ id: "thr_split" })]);
    fireEvent.click(screen.getByRole("link"), { metaKey: true });
    expect(rendered.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_split",
      options: { split: true },
    });
  });

  it("separates pinned threads from the inbox", () => {
    render([
      thread({ id: "a", title: "Plain" }),
      thread({ id: "b", title: "Stuck", isPinned: true }),
    ]);
    const pinned = screen.getByRole("region", { name: /pinned/i });
    expect(within(pinned).getByText("Stuck")).toBeDefined();
  });

  // The host owns the search field; the plugin only filters by what it is
  // handed, so there is deliberately no second search box to type into.
  it("filters by the host's search query", () => {
    renderSlot(
      inbox,
      { ...listProps, searchQuery: "sidebar" },
      {
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({ id: "a", title: "Sidebar work" }),
            thread({ id: "b", title: "Something else" }),
          ],
          projects: [
            {
              id: "proj_1",
              name: "bb",
              isPersonal: false,
              href: "/p/proj_1",
              settingsHref: "/p/proj_1/settings",
            },
          ],
        },
        rpc: { listLifecycle: () => ({ rows: [] }) },
      },
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Sidebar work")).toBeDefined();
  });

  it("ships no search field of its own", () => {
    render([thread({ id: "a" })]);
    expect(screen.queryByLabelText("Search threads")).toBeNull();
  });

  it("ships no new-thread button of its own", () => {
    render([thread({ id: "a" })]);
    expect(screen.queryByLabelText("New thread")).toBeNull();
  });

  it("scopes to one project", () => {
    render(
      [
        thread({ id: "a", title: "In bb", projectId: "proj_1" }),
        thread({ id: "b", title: "In other", projectId: "proj_2" }),
      ],
      [
        {
          id: "proj_1",
          name: "bb",
          isPersonal: false,
          href: "/p/proj_1",
          settingsHref: "/p/proj_1/settings",
        },
        {
          id: "proj_2",
          name: "other",
          isPersonal: false,
          href: "/p/proj_2",
          settingsHref: "/p/proj_2/settings",
        },
      ],
    );
    // Radix opens on keyboard too, which jsdom can drive without pointer
    // capture. Enter opens the list; the option click picks the scope.
    fireEvent.keyDown(screen.getByLabelText(/Project scope/), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "other" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("In other")).toBeDefined();
  });

  it("hides archived threads", () => {
    render([thread({ id: "a", isArchived: true })]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("reports an empty inbox and a fruitless search differently", () => {
    render([]);
    expect(screen.getByText("No threads yet")).toBeDefined();
  });
});

describe("parking threads", () => {
  it("moves a settled thread to the Settled shelf", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_done", title: "Finished work" })],
        projects: [
          {
            id: "proj_1",
            name: "bb",
            isPersonal: false,
            href: "/p/proj_1",
            settingsHref: "/p/proj_1/settings",
          },
        ],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_done",
              settledAt: 200,
              snoozedUntil: null,
              snoozedAt: null,
            },
          ],
        }),
      },
    });
    // The shelf renders once the lifecycle read resolves.
    const shelf = await screen.findByRole("region", { name: "Settled" });
    expect(
      within(shelf).getByRole("button", { name: "Expand Settled section" }),
    ).toBeDefined();
    // Collapsed by default: parked work is out of the way, never gone.
    expect(screen.queryByText("Finished work")).toBeNull();
    fireEvent.click(within(shelf).getByRole("button"));
    expect(within(shelf).getByText("Finished work")).toBeDefined();
  });

  it("keeps a working thread out of the shelves and offers no park action", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "thr_busy",
            title: "Still running",
            indicator: "runtime",
            activity: {
              workflows: 0,
              backgroundAgents: 0,
              backgroundCommands: 0,
              planMode: 0,
              goals: 0,
            },
          }),
        ],
        projects: [
          {
            id: "proj_1",
            name: "bb",
            isPersonal: false,
            href: "/p/proj_1",
            settingsHref: "/p/proj_1/settings",
          },
        ],
      },
      // Settled in the store, but still working: it must stay visible.
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_busy",
              settledAt: 200,
              snoozedUntil: null,
              snoozedAt: null,
            },
          ],
        }),
      },
    });
    expect(await screen.findByText("Still running")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Settled" })).toBeNull();
    expect(screen.queryByLabelText("Settle thread")).toBeNull();
  });

  it("offers settle and snooze on a parkable thread", async () => {
    render([thread({ id: "thr_park", title: "Quiet" })]);
    // Rendered (not merely accepted as props): a card whose park controls
    // never mount leaves the whole feature unreachable.
    expect(await screen.findByLabelText("Settle thread")).toBeDefined();
    expect(screen.getByLabelText("Snooze until tomorrow")).toBeDefined();
  });

  it("settles a thread when the user clicks Settle", async () => {
    let settled: string | null = null;
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_park", title: "Quiet" })],
        projects: [
          {
            id: "proj_1",
            name: "bb",
            isPersonal: false,
            href: "/p/proj_1",
            settingsHref: "/p/proj_1/settings",
          },
        ],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        settle: (input) => {
          settled = (input as { threadId: string }).threadId;
          return { ok: true };
        },
      },
    });
    fireEvent.click(await screen.findByLabelText("Settle thread"));
    await waitFor(() => expect(settled).toBe("thr_park"));
  });

  it("shows the wake countdown on a snoozed row", async () => {
    const wakeAt = Date.now() + 2 * 60 * 60 * 1000;
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_snz", title: "Later" })],
        projects: [
          {
            id: "proj_1",
            name: "bb",
            isPersonal: false,
            href: "/p/proj_1",
            settingsHref: "/p/proj_1/settings",
          },
        ],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_snz",
              settledAt: null,
              snoozedUntil: wakeAt,
              snoozedAt: Date.now(),
            },
          ],
        }),
      },
    });
    const shelf = await screen.findByRole("region", { name: "Snoozed" });
    fireEvent.click(within(shelf).getByRole("button"));
    expect(within(shelf).getByText("2h")).toBeDefined();
    expect(within(shelf).getByLabelText("Wake thread now")).toBeDefined();
  });
});

describe("thread actions", () => {
  const archiveRuns: string[] = [];
  const threadActions = (target: PluginThreadActionTarget) => [
    {
      key: "bb--core/archive",
      pluginId: "bb--core",
      group: "4_lifecycle",
      action: {
        label: "Archive",
        icon: "Archive",
        run: async () => {
          archiveRuns.push(target.id);
        },
      },
    },
  ];

  function renderWithActions(threads: PluginSidebarThread[]) {
    archiveRuns.length = 0;
    return renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads,
        projects: [
          {
            id: "proj_1",
            name: "bb",
            isPersonal: false,
            href: "/p/proj_1",
            settingsHref: "/p/proj_1/settings",
          },
        ],
      },
      rpc: { listLifecycle: () => ({ rows: [] }) },
      threadActions,
    });
  }

  it("opens bb's thread menu on right-click", async () => {
    renderWithActions([thread({ id: "thr_menu", title: "Right click me" })]);
    fireEvent.contextMenu(await screen.findByText("Right click me"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Archive/ }));
    await waitFor(() => expect(archiveRuns).toEqual(["thr_menu"]));
  });

  it("opens bb's thread menu from the row's actions button", async () => {
    renderWithActions([thread({ id: "thr_more", title: "More actions" })]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Thread actions" }),
    );
    expect(
      await screen.findByRole("menuitem", { name: /Archive/ }),
    ).toBeDefined();
  });

  it("offers Snooze, Settle and the menu on a top-level row", async () => {
    renderWithActions([thread({ id: "thr_top" })]);
    await screen.findByText("A thread");
    expect(
      screen.getByRole("button", { name: "Snooze until tomorrow" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Settle thread" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Thread actions" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("offers Archive and the menu on a child row", async () => {
    renderWithActions([
      thread({ id: "thr_parent", title: "Parent work" }),
      thread({
        id: "thr_child",
        title: "Child work",
        parentThreadId: "thr_parent",
        createdAt: 200,
      }),
    ]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Parent work threads" }),
    );
    const childRow = screen
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes("Child work"))!;
    fireEvent.click(within(childRow).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archiveRuns).toEqual(["thr_child"]));
    expect(
      within(childRow).getByRole("button", { name: "Thread actions" }),
    ).toBeDefined();
    expect(
      within(childRow).queryByRole("button", { name: "Settle thread" }),
    ).toBeNull();
  });
});

describe("row metadata", () => {
  it("shows only the title and its status on one line", async () => {
    render([
      thread({
        id: "thr_m",
        providerId: "claude-code",
        host: { id: "host_1", name: "Sawyer's MacBook" },
        environment: {
          id: "env_1",
          name: "Worktree",
          branchName: "bb/feature",
          path: null,
          isWorktree: true,
          providerId: null,
          workspaceDisplayKind: "managed-worktree",
        },
      }),
    ]);
    expect(await screen.findByText("A thread")).toBeDefined();
    expect(screen.queryByLabelText("Claude Code")).toBeNull();
    expect(screen.queryByText("Sawyer's MacBook")).toBeNull();
    expect(screen.queryByText("bb/feature")).toBeNull();
    expect(screen.queryByText("bb")).toBeNull();
  });

  it("leaves the slot empty for an idle thread", async () => {
    render([
      thread({ id: "thr_t", updatedAt: Date.now() - (3 * 3_600_000 + 60_000) }),
    ]);
    await screen.findByText("A thread");
    expect(screen.queryByText("3h")).toBeNull();
  });

  it("leaves the slot empty for an unrecognized indicator", async () => {
    render([
      thread({
        id: "thr_new",
        indicator: "something-bb-ships-later" as never,
        updatedAt: Date.now() - (3 * 3_600_000 + 60_000),
      }),
    ]);
    await screen.findByText("A thread");
    expect(screen.queryByText("3h")).toBeNull();
  });
});

// The three states that want the user take the slot from the age label, and
// they use bb's own glyphs: the two lists sit in one window, and a user who
// switches between them should not have to learn a second vocabulary.
function statusGlyphs(): string[] {
  return [...document.querySelectorAll("[data-thread-status-glyph]")].map(
    (glyph) => glyph.getAttribute("data-thread-status-glyph") ?? "",
  );
}

describe("status glyphs", () => {
  for (const indicator of [
    "waiting-for-input",
    "unread-error",
    "unread-success",
    "runtime",
  ] as const) {
    it(`draws bb's ${indicator} glyph`, async () => {
      render([thread({ id: `thr_${indicator}`, indicator })]);
      await screen.findByText("A thread");
      expect(statusGlyphs()).toEqual([indicator]);
    });
  }

  it("draws nothing for an idle thread", async () => {
    render([thread({ id: "thr_idle" })]);
    await screen.findByText("A thread");
    expect(statusGlyphs()).toEqual([]);
  });

  it("rolls the most urgent child status onto a collapsed parent", async () => {
    render([
      thread({ id: "thr_parent", title: "Parent work" }),
      thread({
        id: "thr_working",
        title: "Working child",
        parentThreadId: "thr_parent",
        indicator: "runtime",
      }),
      thread({
        id: "thr_asking",
        title: "Asking child",
        parentThreadId: "thr_parent",
        indicator: "waiting-for-input",
      }),
    ]);
    await screen.findByText("Parent work");
    expect(statusGlyphs()).toEqual(["waiting-for-input"]);
  });
});

describe("child threads", () => {
  const parent = thread({ id: "thr_parent", title: "Parent work" });
  const child = thread({
    id: "thr_child",
    title: "Child work",
    parentThreadId: "thr_parent",
    createdAt: 200,
  });

  it("starts with the child list collapsed", async () => {
    render([parent, child]);
    expect(
      await screen.findByRole("button", { name: "Expand Parent work threads" }),
    ).toBeDefined();
    expect(screen.queryByText("Child work")).toBeNull();
  });

  it("nests a child under its parent", async () => {
    render([parent, child]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Parent work threads" }),
    );
    const rows = (await screen.findAllByRole("listitem")).map(
      (row) => row.textContent,
    );
    expect(rows).toEqual(["Parent work", "Child work"]);
  });

  it("collapses and expands the child list", async () => {
    render([parent, child]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Parent work threads" }),
    );
    expect(screen.getByText("Child work")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Parent work threads" }),
    );
    expect(screen.queryByText("Child work")).toBeNull();
  });

  it("keeps a settled parent in the inbox and shows its child's status", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          parent,
          { ...child, indicator: "runtime", indicatorLabel: "Thread working" },
        ],
        projects: [
          {
            id: "proj_1",
            name: "bb",
            isPersonal: false,
            href: "/p/proj_1",
            settingsHref: "/p/proj_1/settings",
          },
        ],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_parent",
              settledAt: 200,
              snoozedUntil: null,
              snoozedAt: null,
            },
          ],
        }),
      },
    });
    await screen.findByText("Parent work");
    expect(statusGlyphs()).toEqual(["runtime"]);
    expect(screen.queryByRole("region", { name: "Settled" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settle thread" })).toBeNull();
  });
});

describe("pinned threads", () => {
  it("lists a pinned child under Pinned, not under its parent", async () => {
    render([
      thread({ id: "thr_parent", title: "Parent work" }),
      thread({
        id: "thr_child",
        title: "Pinned child",
        parentThreadId: "thr_parent",
        isPinned: true,
        pinnedAt: 300,
      }),
    ]);
    const pinned = await screen.findByRole("region", { name: "Pinned" });
    expect(within(pinned).getByText("Pinned child")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Expand Parent work threads" }),
    ).toBeNull();
  });

  it("lists a pinned thread under Pinned even when it is settled", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "thr_pinned",
            title: "Pinned and settled",
            isPinned: true,
            pinnedAt: 300,
          }),
        ],
        projects: [],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_pinned",
              settledAt: 200,
              snoozedUntil: null,
              snoozedAt: null,
            },
          ],
        }),
      },
    });
    const pinned = await screen.findByRole("region", { name: "Pinned" });
    expect(within(pinned).getByText("Pinned and settled")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Settled" })).toBeNull();
  });

  it("offers no Snooze or Settle on a pinned row", async () => {
    render([thread({ id: "thr_pinned", isPinned: true, pinnedAt: 300 })]);
    await screen.findByText("A thread");
    expect(screen.queryByRole("button", { name: "Settle thread" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Snooze until tomorrow" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Thread actions" }),
    ).toBeDefined();
  });
});

describe("pull request on hover", () => {
  it("links the PR number in the row's hover actions", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_pr" })],
        projects: [],
      },
      rpc: { listLifecycle: () => ({ rows: [] }) },
      sidebarPullRequests: {
        thr_pr: {
          number: 412,
          title: "Fix the flake",
          url: "https://github.com/o/r/pull/412",
          state: "open",
          attention: "checks_failed",
        } as PluginSidebarPullRequest,
      },
    });
    const link = await screen.findByRole("link", {
      name: "Pull request #412: Fix the flake",
    });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/412");
    expect(link.className).toContain("destructive");
  });
});

describe("remembered layout", () => {
  it("keeps a collapsed shelf collapsed after a reload", async () => {
    const first = render([thread({ id: "thr_a" })]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Collapse Inbox section" }),
    );
    first.unmount();
    render([thread({ id: "thr_a" })]);
    expect(
      await screen.findByRole("button", { name: "Expand Inbox section" }),
    ).toBeDefined();
    expect(screen.queryByText("A thread")).toBeNull();
  });

  it("keeps an opened parent open after a reload", async () => {
    const threads = [
      thread({ id: "thr_parent", title: "Parent work" }),
      thread({
        id: "thr_child",
        title: "Child work",
        parentThreadId: "thr_parent",
      }),
    ];
    const first = render(threads);
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Parent work threads" }),
    );
    first.unmount();
    render(threads);
    expect(await screen.findByText("Child work")).toBeDefined();
  });
});

describe("pinned row actions", () => {
  it("offers bb's Archive and the menu on a pinned row", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "thr_parent", title: "Parent work" }),
          thread({
            id: "thr_child",
            title: "Pinned child",
            parentThreadId: "thr_parent",
            isPinned: true,
            pinnedAt: 300,
          }),
        ],
        projects: [],
      },
      rpc: { listLifecycle: () => ({ rows: [] }) },
      threadActions: () => [
        {
          key: "bb--core/archive",
          pluginId: "bb--core",
          group: "4_lifecycle",
          action: { label: "Archive", icon: "Archive", run: async () => {} },
        },
      ],
    });
    const pinned = await screen.findByRole("region", { name: "Pinned" });
    expect(
      within(pinned).getByRole("button", { name: "Archive" }),
    ).toBeDefined();
    expect(
      within(pinned).getByRole("button", { name: "Thread actions" }),
    ).toBeDefined();
    expect(
      within(pinned).queryByRole("button", { name: "Settle thread" }),
    ).toBeNull();
  });
});

describe("reordering pinned threads", () => {
  const ORDER = ["thr_one", "thr_two", "thr_three"];

  function stubRowRects() {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const id = this.querySelector("[data-sidebar-thread-id]")?.getAttribute(
          "data-sidebar-thread-id",
        );
        const index = ORDER.indexOf(id ?? "");
        return index === -1
          ? DOMRect.fromRect({ x: 0, y: 0, width: 260, height: 600 })
          : DOMRect.fromRect({ x: 0, y: index * 28, width: 260, height: 28 });
      },
    );
  }

  function renderPinned(reorderPinned: (args: unknown) => Promise<unknown>) {
    stubRowRects();
    return renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "thr_one", title: "One", isPinned: true, pinnedAt: 30 }),
          thread({ id: "thr_two", title: "Two", isPinned: true, pinnedAt: 20 }),
          thread({
            id: "thr_three",
            title: "Three",
            isPinned: true,
            pinnedAt: 10,
          }),
        ],
        projects: [],
      },
      rpc: { listLifecycle: () => ({ rows: [] }) },
      sdk: { threads: { reorderPinned } } as never,
    });
  }

  function pinnedTitles() {
    return within(screen.getByRole("region", { name: "Pinned" }))
      .getAllByRole("listitem")
      .map((row) => row.textContent);
  }

  async function press(element: HTMLElement, code: string) {
    fireEvent.keyDown(element, { code });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function sortableRow(title: string) {
    const link = await screen.findByRole("link", { name: title });
    return link.closest<HTMLElement>('[aria-roledescription="sortable"]')!;
  }

  it("moves a pinned thread and saves the order in bb", async () => {
    const calls: unknown[] = [];
    renderPinned(async (args) => {
      calls.push(args);
      return new Promise(() => {});
    });
    const row = await sortableRow("One");
    row.focus();
    await press(row, "Space");
    await press(row, "ArrowDown");
    await press(row, "ArrowDown");
    await press(row, "Space");

    await waitFor(() =>
      expect(calls).toEqual([
        {
          threadId: "thr_one",
          previousThreadId: "thr_three",
          nextThreadId: null,
        },
      ]),
    );
    await waitFor(() =>
      expect(pinnedTitles()).toEqual(["Two", "Three", "One"]),
    );
  });

  it("keeps the order when the drag is cancelled", async () => {
    const calls: unknown[] = [];
    renderPinned(async (args) => {
      calls.push(args);
    });
    const row = await sortableRow("One");
    row.focus();
    await press(row, "Space");
    await press(row, "ArrowDown");
    await press(row, "Escape");
    await waitFor(() =>
      expect(pinnedTitles()).toEqual(["One", "Two", "Three"]),
    );
    expect(calls).toEqual([]);
  });

  it("makes every pinned row a sortable drag handle", async () => {
    renderPinned(async () => undefined);
    await screen.findByText("One");
    expect(
      document.querySelectorAll('[aria-roledescription="sortable"]'),
    ).toHaveLength(3);
  });
});

describe("layout synced through the server", () => {
  function renderWithLayout(
    layout: {
      collapsedShelves: string[] | null;
      expandedParents: string[] | null;
    },
    threads: PluginSidebarThread[] = [thread({ id: "thr_a" })],
  ) {
    return renderSlot(inbox, listProps, {
      sidebarThreads: { status: "ready", threads, projects: [] },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        getLayout: () => layout,
        setLayoutMember: () => ({ ok: true }),
        replaceLayoutSet: () => ({ ok: true }),
      } as never,
    });
  }

  function callsTo(rendered: ReturnType<typeof renderSlot>, method: string) {
    return rendered.inspection.rpcCalls
      .filter((call) => call.method === method)
      .map((call) => call.input);
  }

  it("uses the layout saved on the server", async () => {
    renderWithLayout({ collapsedShelves: ["inbox"], expandedParents: [] });
    expect(
      await screen.findByRole("button", { name: "Expand Inbox section" }),
    ).toBeDefined();
    expect(screen.queryByText("A thread")).toBeNull();
  });

  it("saves a toggle to the server", async () => {
    const rendered = renderWithLayout({
      collapsedShelves: ["snoozed", "settled"],
      expandedParents: [],
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Collapse Inbox section" }),
    );
    expect(callsTo(rendered, "setLayoutMember")).toEqual([
      { set: "collapsedShelves", item: "inbox", member: true },
    ]);
  });

  it("uploads this browser's layout the first time", async () => {
    localStorage.setItem(
      "bb-sidebar:collapsed-shelves",
      JSON.stringify(["inbox"]),
    );
    const rendered = renderWithLayout({
      collapsedShelves: null,
      expandedParents: null,
    });
    await waitFor(() =>
      expect(callsTo(rendered, "replaceLayoutSet")).toEqual([
        { set: "collapsedShelves", items: ["inbox"] },
        { set: "expandedParents", items: [] },
      ]),
    );
  });

  it("follows a change made on another device", async () => {
    let collapsedElsewhere: string[] = [];
    const rendered = renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_a" })],
        projects: [],
      },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        getLayout: () => ({
          collapsedShelves: collapsedElsewhere,
          expandedParents: [],
        }),
      } as never,
    });
    expect(await screen.findByText("A thread")).toBeDefined();
    collapsedElsewhere = ["inbox"];
    await rendered.behavior.emitRealtime("layout", { set: "collapsedShelves" });
    await waitFor(() => expect(screen.queryByText("A thread")).toBeNull());
  });
});
