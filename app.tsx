// Beside — an inbox-style replacement for bb's sidebar thread
// list, and the reference example for `app.slots.experimental_threadList`.
//
// The idea it is built around: the list NEVER re-orders itself. Threads sort
// by creation time, newest first, and hold that place. Status is carried by
// each card, not by position, so the sidebar only moves when you act.
import {
  definePluginApp,
  experimental_THREAD_ACTION_GROUPS,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "./src/components/Icon";
import { muteThread, unmuteThread } from "./src/muting";
import { ThreadInbox } from "./src/ThreadInbox";
import { useMutedThreadIds } from "./src/useMutedThreadIds";

const MUTE_ICON = "beside.mute";
const UNMUTE_ICON = "beside.unmute";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "inbox",
    title: "Beside",
    description:
      "Threads newest first in a list that never re-orders, with Snoozed, Settled and Muted shelves.",
    component: ThreadInbox,
  });

  app.experimental_icons.register({
    name: MUTE_ICON,
    component: ({ className }) => (
      <Icon name="NotificationOff" className={className} />
    ),
  });
  app.experimental_icons.register({
    name: UNMUTE_ICON,
    component: ({ className }) => (
      <Icon name="Notification" className={className} />
    ),
  });

  app.slots.experimental_threadAction({
    id: "mute",
    title: "Mute",
    icon: MUTE_ICON,
    group: experimental_THREAD_ACTION_GROUPS.state,
    useData: () => useMutedThreadIds(),
    item: ({ thread, data, sdk }) => {
      const isMuted = data.mutedIds.has(thread.id);
      return {
        label: isMuted ? "Unmute" : "Mute",
        icon: isMuted ? UNMUTE_ICON : MUTE_ICON,
        run: () =>
          isMuted
            ? unmuteThread(data.rpc, sdk, thread.id)
            : muteThread(data.rpc, sdk, thread.id),
      };
    },
  });
});
