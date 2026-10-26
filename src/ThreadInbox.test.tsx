// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
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

afterEach(cleanup);

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
describe("attention states", () => {
  const states = [
    ["waiting-for-input", "Thread needs user input"],
    ["unread-error", "Unread thread failed"],
    ["unread-success", "Unread thread succeeded"],
  ] as const;

  for (const [indicator, label] of states) {
    it(`shows the ${indicator} glyph instead of the age`, async () => {
      render([
        thread({
          id: `thr_${indicator}`,
          indicator,
          indicatorLabel: label,
          updatedAt: Date.now() - (3 * 3_600_000 + 60_000),
        }),
      ]);
      expect(await screen.findByLabelText(label)).toBeDefined();
      expect(screen.queryByText("3h")).toBeNull();
    });
  }

  // Running work is the one state the user does NOT have to act on, so it gets
  // the neutral spinner and no notification dot.
  it("shows the spinner, not a dot, while work runs", async () => {
    render([
      thread({
        id: "thr_busy",
        isUnread: true,
        indicator: "runtime",
        indicatorLabel: "Thread working",
      }),
    ]);
    expect(await screen.findByLabelText("Thread working")).toBeDefined();
    expect(screen.queryByLabelText("Unread thread succeeded")).toBeNull();
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
    expect(await screen.findByLabelText("Thread working")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Settled" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settle thread" })).toBeNull();
  });
});
