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
  localStorage.setItem("bb-sidebar:lifecycle", "[]");
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
    fireEvent.click(
      within(shelf).getByRole("button", { name: /^Expand .* section$/ }),
    );
    expect(within(shelf).getByText("Finished work")).toBeDefined();
  });

  it("keeps a settled thread settled while it runs", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "thr_busy",
            title: "Still running",
            indicator: "runtime",
            status: "active",
            runtimeStatus: "active",
            latestAttentionAt: 100,
          }),
        ],
        projects: [],
      },
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
    expect(
      await screen.findByRole("region", { name: "Settled" }),
    ).toBeDefined();
    expect(screen.queryByText("Still running")).toBeNull();
  });

  it("brings a settled thread back when it asks a question", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({
            id: "thr_ask",
            title: "Needs an answer",
            indicator: "waiting-for-input",
            hasPendingInteraction: true,
          }),
        ],
        projects: [],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_ask",
              settledAt: 200,
              snoozedUntil: null,
              snoozedAt: null,
            },
          ],
        }),
      },
    });
    expect(await screen.findByText("Needs an answer")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Settled" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settle thread" })).toBeNull();
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
    fireEvent.click(
      within(shelf).getByRole("button", { name: /^Expand .* section$/ }),
    );
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

  it("keeps a settled parent settled while its child runs", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [parent, { ...child, indicator: "runtime", status: "active" }],
        projects: [],
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
    expect(
      await screen.findByRole("region", { name: "Settled" }),
    ).toBeDefined();
    expect(screen.queryByText("Parent work")).toBeNull();
  });

  it("brings a settled parent back when its child asks a question", async () => {
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          parent,
          {
            ...child,
            indicator: "waiting-for-input",
            hasPendingInteraction: true,
          },
        ],
        projects: [],
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
    expect(statusGlyphs()).toEqual(["waiting-for-input"]);
    expect(screen.queryByRole("region", { name: "Settled" })).toBeNull();
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

describe("first frame after a reload", () => {
  it("puts parked threads on their shelf before the server answers", async () => {
    localStorage.setItem(
      "bb-sidebar:lifecycle",
      JSON.stringify([
        {
          threadId: "thr_done",
          settledAt: 200,
          snoozedUntil: null,
          snoozedAt: null,
        },
      ]),
    );
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "thr_done", title: "Finished work" }),
          thread({ id: "thr_live", title: "Live work" }),
        ],
        projects: [],
      },
      rpc: { listLifecycle: () => new Promise(() => {}) } as never,
    });
    expect(screen.getByText("Live work")).toBeDefined();
    expect(screen.queryByText("Finished work")).toBeNull();
    expect(screen.getByRole("region", { name: "Settled" })).toBeDefined();
  });

  it("waits for the server on a device with no saved copy", async () => {
    localStorage.removeItem("bb-sidebar:lifecycle");
    renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_done", title: "Finished work" })],
        projects: [],
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
    expect(screen.queryByText("Finished work")).toBeNull();
    expect(
      await screen.findByRole("region", { name: "Settled" }),
    ).toBeDefined();
    expect(screen.queryByText("Finished work")).toBeNull();
  });
});

describe("a thread that is running", () => {
  for (const busy of [
    { indicator: "runtime" as const, status: "active" as const },
    { status: "idle" as const, runtimeStatus: "provisioning" as const },
    { queuedWork: "waiting" as const },
  ]) {
    it(`can be parked while ${JSON.stringify(busy)}`, async () => {
      render([thread({ id: "thr_busy", ...busy })]);
      await screen.findByText("A thread");
      expect(
        screen.getByRole("button", { name: "Settle thread" }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Snooze until tomorrow" }),
      ).toBeDefined();
    });
  }

  it("cannot be parked while it waits for your answer", async () => {
    render([
      thread({
        id: "thr_ask",
        indicator: "waiting-for-input",
        hasPendingInteraction: true,
      }),
    ]);
    await screen.findByText("A thread");
    expect(screen.queryByRole("button", { name: "Settle thread" })).toBeNull();
  });
});

describe("muted threads", () => {
  const mutedRow = (threadId: string) => ({
    threadId,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    mutedAt: 100,
  });

  function renderMuted(
    threads: PluginSidebarThread[],
    mutedIds: string[],
    extra: Record<string, unknown> = {},
  ) {
    return renderSlot(inbox, listProps, {
      sidebarThreads: { status: "ready", threads, projects: [] },
      rpc: {
        listLifecycle: () => ({ rows: mutedIds.map(mutedRow) }),
        unmute: () => ({ ok: true }),
      } as never,
      ...extra,
    });
  }

  it("keeps a muted thread on a collapsed Muted shelf through new activity", async () => {
    renderMuted(
      [
        thread({
          id: "thr_quiet",
          title: "Noisy work",
          isUnread: true,
          indicator: "unread-success",
          latestAttentionAt: 900,
        }),
      ],
      ["thr_quiet"],
    );
    const shelf = await screen.findByRole("region", { name: "Muted" });
    expect(
      within(shelf).getByRole("button", { name: "Expand Muted section" }),
    ).toBeDefined();
    expect(screen.queryByText("Noisy work")).toBeNull();
  });

  it("shows no Muted shelf when nothing is muted", async () => {
    renderMuted([thread({ id: "thr_a" })], []);
    await screen.findByText("A thread");
    expect(screen.queryByRole("region", { name: "Muted" })).toBeNull();
  });

  it("flags the Muted header when a muted thread asks a question", async () => {
    renderMuted(
      [
        thread({
          id: "thr_ask",
          title: "Asking quietly",
          indicator: "waiting-for-input",
          hasPendingInteraction: true,
        }),
      ],
      ["thr_ask"],
    );
    const shelf = await screen.findByRole("region", { name: "Muted" });
    expect(screen.queryByText("Asking quietly")).toBeNull();
    expect(
      shelf
        .querySelector("[data-shelf-trailing] [data-thread-status-glyph]")
        ?.getAttribute("data-thread-status-glyph"),
    ).toBe("waiting-for-input");
  });

  function pushFake(currentLevel: string) {
    const calls: { method: string; input: unknown }[] = [];
    return {
      calls,
      sdk: {
        plugins: {
          callRpc: async (args: { method: string; input: unknown }) => {
            calls.push({ method: args.method, input: args.input });
            return args.method === "threadNotifications.list"
              ? {
                  threads: {
                    thr_quiet: { own: currentLevel, ancestorCap: null },
                  },
                }
              : {};
          },
        },
      },
    };
  }

  async function unmuteFromRow(
    pushLevelBeforeMute: string | null,
    currentLevel: string,
  ) {
    const push = pushFake(currentLevel);
    const rendered = renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_quiet", title: "Quiet work" })],
        projects: [],
      },
      rpc: {
        listLifecycle: () => ({ rows: [mutedRow("thr_quiet")] }),
        unmute: () => ({ ok: true, pushLevelBeforeMute }),
      } as never,
      sdk: push.sdk as never,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Expand Muted section" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unmute thread" }));
    await waitFor(() =>
      expect(
        rendered.inspection.rpcCalls.filter((call) => call.method === "unmute"),
      ).toEqual([{ method: "unmute", input: { threadId: "thr_quiet" } }]),
    );
    await waitFor(() =>
      expect(
        push.calls.some((call) => call.method === "threadNotifications.list"),
      ).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    return push.calls.filter(
      (call) => call.method === "threadNotifications.set",
    );
  }

  it("restores the push level the thread had before it was muted", async () => {
    expect(await unmuteFromRow("input-only", "muted")).toEqual([
      {
        method: "threadNotifications.set",
        input: { threadId: "thr_quiet", level: "input-only" },
      },
    ]);
  });

  it("falls back to the default level when none was saved", async () => {
    expect(await unmuteFromRow(null, "muted")).toEqual([
      {
        method: "threadNotifications.set",
        input: { threadId: "thr_quiet", level: "inherit" },
      },
    ]);
  });

  it("leaves a push level the user changed while muted", async () => {
    expect(await unmuteFromRow("input-only", "all")).toEqual([]);
  });
});

describe("mute action in bb's thread menu", () => {
  const action = app.threadActions.find(
    (registration) => registration.id === "mute",
  )!;
  const target = {
    id: "thr_a",
    projectId: "proj_1",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    sectionId: null,
    isUnread: false,
    status: "idle" as const,
    environment: null,
  };

  it("offers Mute on an unmuted thread, saves the push level and mutes push", async () => {
    const rpcCalls: unknown[] = [];
    const pushCalls: { method: string; input: unknown }[] = [];
    const item = action.item({
      thread: target,
      data: {
        mutedIds: new Set<string>(),
        rpc: { call: async (...args: unknown[]) => void rpcCalls.push(args) },
      },
      sdk: {
        plugins: {
          callRpc: async (args: { method: string; input: unknown }) => {
            pushCalls.push({ method: args.method, input: args.input });
            return args.method === "threadNotifications.list"
              ? { threads: { thr_a: { own: "input-only", ancestorCap: null } } }
              : {};
          },
        },
      },
      navigate: {},
    } as never)!;
    expect(item.label).toBe("Mute");
    await item.run({} as never);
    expect(rpcCalls).toEqual([
      ["mute", { threadId: "thr_a", pushLevelBeforeMute: "input-only" }],
    ]);
    expect(pushCalls.at(-1)).toEqual({
      method: "threadNotifications.set",
      input: { threadId: "thr_a", level: "muted" },
    });
  });

  it("offers Unmute on a muted thread", () => {
    const item = action.item({
      thread: target,
      data: { mutedIds: new Set(["thr_a"]), rpc: {} },
      sdk: {},
      navigate: {},
    } as never)!;
    expect(item.label).toBe("Unmute");
  });
});

describe("inbox actions menu", () => {
  function renderInboxWith(threads: PluginSidebarThread[], extraRpc = {}) {
    return renderSlot(inbox, listProps, {
      sidebarThreads: { status: "ready", threads, projects: [] },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        settleMany: () => ({ ok: true }),
        snoozeMany: () => ({ ok: true }),
        getSettings: () => ({ settleOnReadSince: null }),
        setSettleOnRead: ({ enabled }: { enabled: boolean }) => ({
          settleOnReadSince: enabled ? 1_000 : null,
        }),
        ...extraRpc,
      } as never,
    });
  }

  const threadsWithOneAsking = () => [
    thread({ id: "thr_a", title: "Alpha" }),
    thread({
      id: "thr_b",
      title: "Beta",
      indicator: "runtime",
      status: "active",
    }),
    thread({
      id: "thr_ask",
      title: "Asking",
      indicator: "waiting-for-input",
      hasPendingInteraction: true,
    }),
  ];

  async function openMenu() {
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Inbox actions" }),
      { button: 0, ctrlKey: false },
    );
    return screen.findByRole("menu");
  }

  function rpcInputs(rendered: ReturnType<typeof renderSlot>, method: string) {
    return rendered.inspection.rpcCalls
      .filter((call) => call.method === method)
      .map((call) => call.input);
  }

  it("settles every parkable Inbox thread, skipping one that asks", async () => {
    const rendered = renderInboxWith(threadsWithOneAsking());
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Settle all/ }));
    await waitFor(() =>
      expect(rpcInputs(rendered, "settleMany")).toEqual([
        { threadIds: ["thr_a", "thr_b"] },
      ]),
    );
  });

  it("snoozes every parkable Inbox thread until the picked time", async () => {
    const rendered = renderInboxWith(threadsWithOneAsking());
    const menu = await openMenu();
    const snoozeAll = within(menu).getByRole("menuitem", {
      name: /Snooze all/,
    });
    fireEvent.keyDown(snoozeAll, { key: "ArrowRight" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Tomorrow" }));
    await waitFor(() =>
      expect(rpcInputs(rendered, "snoozeMany")).toHaveLength(1),
    );
    expect(rpcInputs(rendered, "snoozeMany")[0]).toMatchObject({
      threadIds: ["thr_a", "thr_b"],
      snoozedUntil: expect.any(Number),
    });
  });

  it("turns settle on read on from the menu", async () => {
    const rendered = renderInboxWith([thread({ id: "thr_a" })]);
    const menu = await openMenu();
    fireEvent.click(
      within(menu).getByRole("menuitemcheckbox", {
        name: "Settle after reading",
      }),
    );
    await waitFor(() =>
      expect(rpcInputs(rendered, "setSettleOnRead")).toEqual([
        { enabled: true },
      ]),
    );
  });
});

describe("settle on read", () => {
  function renderAt(
    activeThreadId: string,
    threads: PluginSidebarThread[],
    since: number | null = 1_000,
  ) {
    const props = { ...listProps, activeThreadId };
    const rendered = renderSlot(inbox, props, {
      sidebarThreads: { status: "ready", threads, projects: [] },
      rpc: {
        listLifecycle: () => ({ rows: [] }),
        settle: () => ({ ok: true }),
        getSettings: () => ({ settleOnReadSince: since }),
      } as never,
    });
    const moveTo = async (nextActiveThreadId: string) => {
      await waitFor(() =>
        expect(
          rendered.inspection.rpcCalls.some(
            (call) => call.method === "getSettings",
          ),
        ).toBe(true),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      rendered.lifecycle.rerender(
        <inbox.component {...props} activeThreadId={nextActiveThreadId} />,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    const settled = () =>
      rendered.inspection.rpcCalls
        .filter((call) => call.method === "settle")
        .map((call) => call.input);
    return { moveTo, settled };
  }

  const other = thread({ id: "thr_other", title: "Other", createdAt: 50 });

  it("settles a read, idle thread when you move to another one", async () => {
    const view = renderAt("thr_read", [
      thread({ id: "thr_read", title: "Read it", lastReadAt: 2_000 }),
      other,
    ]);
    await screen.findByText("Read it");
    await view.moveTo("thr_other");
    expect(view.settled()).toEqual([{ threadId: "thr_read" }]);
  });

  it("leaves a thread that is still running", async () => {
    const view = renderAt("thr_run", [
      thread({
        id: "thr_run",
        title: "Running",
        lastReadAt: 2_000,
        indicator: "runtime",
        status: "active",
        runtimeStatus: "active",
      }),
      other,
    ]);
    await screen.findByText("Running");
    await view.moveTo("thr_other");
    expect(view.settled()).toEqual([]);
  });

  it("leaves a thread read before the setting was switched on", async () => {
    const view = renderAt("thr_old", [
      thread({ id: "thr_old", title: "Read long ago", lastReadAt: 500 }),
      other,
    ]);
    await screen.findByText("Read long ago");
    await view.moveTo("thr_other");
    expect(view.settled()).toEqual([]);
  });

  it("does nothing while the setting is off", async () => {
    const view = renderAt(
      "thr_read",
      [thread({ id: "thr_read", title: "Read it", lastReadAt: 2_000 }), other],
      null,
    );
    await screen.findByText("Read it");
    await view.moveTo("thr_other");
    expect(view.settled()).toEqual([]);
  });
});

describe("parked shelf menus", () => {
  const parkedRow = (
    threadId: string,
    shelf: "snoozed" | "settled" | "muted",
  ) => ({
    threadId,
    settledAt: shelf === "settled" ? 200 : null,
    snoozedUntil: shelf === "snoozed" ? Date.now() + 3_600_000 : null,
    snoozedAt: shelf === "snoozed" ? 200 : null,
    mutedAt: shelf === "muted" ? 200 : null,
  });

  function renderShelf(shelf: "snoozed" | "settled" | "muted") {
    const archived: string[] = [];
    const rendered = renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "thr_one", title: "One" }),
          thread({ id: "thr_two", title: "Two" }),
        ],
        projects: [],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [parkedRow("thr_one", shelf), parkedRow("thr_two", shelf)],
        }),
        restoreLifecycle: () => ({ ok: true }),
        unmute: () => ({ ok: true, pushLevelBeforeMute: null }),
      } as never,
      sdk: {
        threads: {
          archive: async ({ threadId }: { threadId: string }) => {
            archived.push(threadId);
            return { ok: true, archivedThreadIds: [threadId] };
          },
        },
        plugins: {
          callRpc: async () => ({ threads: {} }),
        },
      } as never,
    });
    return { rendered, archived };
  }

  async function pick(label: string, item: string) {
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: `${label} actions` }),
      { button: 0, ctrlKey: false },
    );
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: item }));
  }

  function rpcInputs(rendered: ReturnType<typeof renderSlot>, method: string) {
    return rendered.inspection.rpcCalls
      .filter((call) => call.method === method)
      .map((call) => call.input);
  }

  it("wakes every snoozed thread", async () => {
    const { rendered } = renderShelf("snoozed");
    await pick("Snoozed", "Wake all");
    await waitFor(() =>
      expect(rpcInputs(rendered, "restoreLifecycle")).toEqual([
        {
          entries: [
            { threadId: "thr_one", row: null },
            { threadId: "thr_two", row: null },
          ],
        },
      ]),
    );
  });

  it("moves every settled thread back to the Inbox", async () => {
    const { rendered } = renderShelf("settled");
    await pick("Settled", "Move all to Inbox");
    await waitFor(() =>
      expect(rpcInputs(rendered, "restoreLifecycle")).toHaveLength(1),
    );
  });

  it("archives every settled thread through bb", async () => {
    const { archived } = renderShelf("settled");
    await pick("Settled", "Archive all");
    await waitFor(() =>
      expect(archived.sort()).toEqual(["thr_one", "thr_two"]),
    );
  });

  it("unmutes every muted thread", async () => {
    const { rendered } = renderShelf("muted");
    await pick("Muted", "Unmute all");
    await waitFor(() =>
      expect(rpcInputs(rendered, "unmute")).toEqual([
        { threadId: "thr_one" },
        { threadId: "thr_two" },
      ]),
    );
  });

  it("archives every muted thread through bb", async () => {
    const { archived } = renderShelf("muted");
    await pick("Muted", "Archive all");
    await waitFor(() =>
      expect(archived.sort()).toEqual(["thr_one", "thr_two"]),
    );
  });
});

describe("auto-archive setting", () => {
  it("defaults to Never and saves a picked duration", async () => {
    const rendered = renderSlot(inbox, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: [thread({ id: "thr_done", title: "Done" })],
        projects: [],
      },
      rpc: {
        listLifecycle: () => ({
          rows: [
            {
              threadId: "thr_done",
              settledAt: 200,
              snoozedUntil: null,
              snoozedAt: null,
              mutedAt: null,
            },
          ],
        }),
        getSettings: () => ({
          settleOnReadSince: null,
          autoArchiveSettledDays: null,
        }),
        setAutoArchiveSettledDays: ({ days }: { days: number | null }) => ({
          autoArchiveSettledDays: days,
        }),
      } as never,
    });
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Settled actions" }),
      { button: 0, ctrlKey: false },
    );
    const menu = await screen.findByRole("menu");
    const trigger = within(menu).getByRole("menuitem", {
      name: /Auto-archive/,
    });
    expect(trigger.textContent).toContain("Never");
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "After 7 days" }),
    );
    await waitFor(() =>
      expect(
        rendered.inspection.rpcCalls
          .filter((call) => call.method === "setAutoArchiveSettledDays")
          .map((call) => call.input),
      ).toEqual([{ days: 7 }]),
    );
  });
});
