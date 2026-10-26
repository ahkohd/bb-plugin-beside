# BB Sidebar

An inbox-style replacement for bb's sidebar thread list, and the reference
example for `app.slots.experimental_threadList`.

This plugin started as an example in the BB repository. Install its public
release from GitHub:

```sh
bb plugin install git:https://github.com/ahkohd/bb-sidebar.git
```

Turn it on in **Settings → Appearance → Sidebar**. bb's own list stays the
default, and comes back the moment you switch away or disable this plugin.

The plugin replaces the scrolling list only. bb's New-thread button, search
field, plugin nav rows, and footer stay exactly where they are — this list
filters by the host's search and adds just one control of its own, a project
scope picker.

## The idea

The list never re-orders itself. Threads sort by creation time, newest first,
and hold that place until you park them. Status lives inside each row instead
of in its position, so the sidebar only moves when you act — no row slides
away under your cursor because an agent finished something.

Four shelves:

- **Pinned** — every pinned thread, in bb's pin order, whatever shelf it
  would otherwise be on and even when it is a child thread. A pinned row has
  no Snooze or Settle; its hover actions are bb's Archive and "…", which has Unpin.
- **Inbox** — one line per thread, the same height as a row in bb's own list:
  the title, then one fixed-width status slot. Hover a row and the status
  gives way to the pull request number, if the branch has one, and Snooze,
  Settle and "…" buttons, styled like bb's own row actions.

  The slot draws bb's own status glyph while a thread has something to say,
  and stays empty once it does not, as in bb's own list: the circle-question
  when an agent is waiting for your answer, the red circle-x for a failure,
  the spinner for live work, and a dot for a thread that finished while you
  were not looking. A snoozed row shows its wake time instead.

- **Snoozed** — hidden until a wake time you chose. A snoozed thread comes
  back early if it starts working or asks you something.
- **Settled** — work you are done with, in muted rows.

Collapsed shelves and opened parents are remembered in this browser's local
storage, so they survive a reload.

## Child threads nest under their parent

As in bb's own list, a child thread sits under its parent, indented with a
guide line. A chevron beside the parent's title expands or collapses the
children; they start collapsed. While collapsed, the parent's status slot
shows the most urgent status among its children, so a child that is working
or asking you something is never invisible. Children follow their parent's
shelf, and a busy child keeps its parent in the inbox.

An orphan — a child whose parent is deleted or not on screen — stays at the
top level of the list.

## What it demonstrates

| Plugin API                                                                   | Used for                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `experimental_threadList`                                                    | the sidebar's scrolling list (bb keeps the New-thread button, search, nav rows, and footer) |
| `experimental_useSidebarThreads`                                             | live threads and projects, from the host's own cache                                        |
| `useBbNavigate`                                                              | opening a thread, or opening it in a split                                                  |
| `experimental_useSidebarThreadSplit`                                         | dragging a row out to a split pane                                                          |
| `experimental_ThreadActionsMenu` and `experimental_ThreadActionsContextMenu` | bb's own thread menu, from the row's "…" button and on right-click                          |
| `experimental_ThreadStatusGlyph` and `useSidebarThreadRowStatus`             | bb's own status glyph in each row                                                           |
| `experimental_useSidebarThreadPullRequest`                                   | the pull request number in a row's hover actions                                            |
| `experimental_useThreadActions`                                              | bb's Archive action on a child row                                                          |
| `@radix-ui/react-tooltip` (shimmed)                                          | bb's tooltip on the row buttons                                                             |
| `bb.storage.database()` + `bb.rpc` + `bb.realtime`                           | the settled/snoozed store                                                                   |

The thread menu is bb's own, so it has every item bb's sidebar has, including
other plugins' thread actions, and archive and delete keep bb's confirmations.
The small
icon, select and tooltip components also live in this example. The example does
not import BB's private shared UI package.

## Where the lifecycle lives

Settled and snoozed state is in **this plugin's** SQLite database, never on
bb's thread. Putting it on the thread would mean a schema change, a wire
change, and a `HOST_DAEMON_PROTOCOL_VERSION` bump for a concept only this
sidebar understands. Uninstalling the plugin takes its state with it.

One rule matters more than the rest: **a thread that is working can never be
parked.** bb has more kinds of live work than a session status — workflows,
background agents, background commands, plan mode, goals — and every one of
them blocks parking and wakes a parked thread. Hiding running work is the one
failure this feature cannot afford. See `canPark` in `src/lifecycle.ts`.
