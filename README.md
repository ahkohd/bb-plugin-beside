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

Three shelves:

- **Inbox** — one line per thread, the same height as a row in bb's own list:
  the title, then one fixed-width status slot. Hover a row and the status
  gives way to Snooze and Settle buttons, styled like bb's own row actions.
  Pinned threads sit above.

  One slot, one marker, one width, so the whole column lines up. The slot
  shows the status glyph while a thread has something to say, and stays empty
  once it does not, as in bb's own list. A snoozed row shows its wake time
  instead. The glyphs are bb's own: the red circle-x
  for a failure, the circle-question for a raised hand, the spinner for live
  work, and a blue notification dot for a thread that finished while you were
  not looking. Both lists sit in the same window, so they speak one language.

- **Snoozed** — hidden until a wake time you chose. A snoozed thread comes
  back early if it starts working or asks you something.
- **Settled** — work you are done with, in muted rows.

## Child threads nest under their parent

As in bb's own list, a child thread sits under its parent, indented with a
guide line. A chevron beside the parent's title collapses or expands the
children; they start expanded. Children follow their parent's shelf, so they
are parked and restored with it. A child that is working or asking you
something keeps its parent in the inbox, so live work is never parked out of
sight.

The thread header also carries two chips:

- On a parent: a chip with one coloured disc per child. It opens the list of
  children.
- On a child: a chip that names the parent and opens it.

An orphan — a child whose parent is deleted or not on screen — stays at the
top level of the list, and its header shows no parent chip.

## What it demonstrates

| Plugin API                                         | Used for                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `experimental_threadList`                          | the sidebar's scrolling list (bb keeps the New-thread button, search, nav rows, and footer) |
| `experimental_threadHeaderAction`                  | the two header chips: children on a parent, and the way back on a child                     |
| `experimental_useSidebarThreads`                   | live threads and projects, from the host's own cache                                        |
| `experimental_useSidebarThreadActions`             | open, open-in-split, new thread                                                             |
| `experimental_useSidebarThreadSplit`               | dragging a row out to a split pane                                                          |
| `@radix-ui/react-context-menu` (shimmed)           | this plugin's own right-click menu, built on the action hook                                |
| `bb.storage.database()` + `bb.rpc` + `bb.realtime` | the settled/snoozed store                                                                   |

The plugin API ships **no components**. Status glyphs and the right-click menu
are both this plugin's own: `indicator` arrives as data, and every menu item is
one call on `experimental_useSidebarThreadActions`. Choosing them is the point
of a replaced sidebar. Deletion still routes through `requestDelete`, so BB
shows its confirmation dialog rather than a plugin deleting a subtree silently.
The small icon and select components also live in this example. The example
does not import BB's private shared UI package.

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
