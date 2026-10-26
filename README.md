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

Five shelves:

- **Pinned** — every pinned thread, in bb's pin order, whatever shelf it
  would otherwise be on and even when it is a child thread. Drag a pinned row
  up or down to reorder it; the order is saved in bb, so bb's own list shows
  it too. Dragging out of the sidebar still opens the thread in a split. A
  pinned row has no Snooze or Settle; its hover actions are bb's Archive and
  "…", which has Unpin.
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
  back early when it finishes, fails or asks you something.
- **Settled** — work you are done with, in muted rows.
- **Muted** — threads you never want back in the inbox, but do not want to
  archive. Mute from the "…" menu; a muted thread stays here through any
  update until you unmute it, and muting also turns off its push
  notifications. If a muted thread asks you a question, the Muted header shows
  bb's question glyph. The shelf only appears while something is muted.

The Inbox header has a "…" menu, shown on hover:

- **Settle all** and **Snooze all** park every thread the Inbox is showing,
  so the project filter and search apply. Threads waiting for your answer are
  skipped. A toast offers Undo, which puts each thread back exactly as it was.
- **Settle after reading** settles a thread when you move from it to another
  thread, if you have read it and it is idle. It only applies to threads read
  after you switch it on, and the setting is shared by all your devices.

The parked shelves have "…" menus too, each with an Undo toast:

- **Snoozed**: Wake all.
- **Settled**: Archive all, and Move all to Inbox.
- **Muted**: Unmute all, which restores each thread's push level, and Archive
  all.

Archive all uses bb's own archive, which also archives a thread's children.

The Settled menu also has **Auto-archive**: Never (the default), or after 1,
3, 7, 14 or 30 days. Once an hour the bb server archives threads that have
stayed settled that long with no news since, skipping pinned, running and
queued threads. An auto-archived thread leaves the plugin's records, so if you
unarchive it, it comes back to the Inbox.

Collapsed shelves and opened parents are saved in this plugin's database on
the bb server, so the layout follows you to every device and updates live in
every open window. Each browser keeps a local copy to draw the first frame
before the server answers, and the first load uploads that copy, so an
existing layout carries over.

## Child threads nest under their parent

As in bb's own list, a child thread sits under its parent, indented with a
guide line. A chevron beside the parent's title expands or collapses the
children; they start collapsed. While collapsed, the parent's status slot
shows the most urgent status among its children, so a child that is working
or asking you something is never invisible. Children follow their parent's
shelf, and a child that asks you something brings its parent back to the
inbox.

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

You can park a thread while it runs: it stays parked while it works, and
comes back on its next attention — when it finishes, fails or asks you
something. The one thing that cannot be parked is a thread already waiting for
your answer, because hiding the question would stall the agent. See `canPark`
and `resolveShelf` in `src/lifecycle.ts`.
