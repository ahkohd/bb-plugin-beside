import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { bbSidebarRpcContract } from "./server";

interface PluginsRpcCaller {
  plugins: {
    callRpc<TOutput>(args: {
      pluginId: string;
      method: string;
      input?: unknown;
      outputSchema: z.ZodType<TOutput>;
    }): Promise<TOutput>;
  };
}

const PUSH_NOTIFICATIONS_PLUGIN_ID = "push-notifications";

type PushLevel = "inherit" | "all" | "input-only" | "muted";

const pushLevelSchema = z.enum(["inherit", "all", "input-only", "muted"]);

const threadNotificationsSchema = z.object({
  threads: z.record(z.string(), z.object({ own: z.string() }).passthrough()),
});

async function readPushLevel(
  sdk: PluginsRpcCaller,
  threadId: string,
): Promise<PushLevel | null> {
  try {
    const { threads } = await sdk.plugins.callRpc({
      pluginId: PUSH_NOTIFICATIONS_PLUGIN_ID,
      method: "threadNotifications.list",
      input: { threadIds: [threadId] },
      outputSchema: threadNotificationsSchema,
    });
    const parsed = pushLevelSchema.safeParse(
      threads[threadId]?.own ?? "inherit",
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function setPushLevel(
  sdk: PluginsRpcCaller,
  threadId: string,
  level: PushLevel,
): Promise<unknown> {
  return sdk.plugins
    .callRpc({
      pluginId: PUSH_NOTIFICATIONS_PLUGIN_ID,
      method: "threadNotifications.set",
      input: { threadId, level },
      outputSchema: z.unknown(),
    })
    .catch(() => undefined);
}

export async function muteThread(
  rpc: PluginRpcClient<typeof bbSidebarRpcContract>,
  sdk: PluginsRpcCaller,
  threadId: string,
): Promise<void> {
  const pushLevelBeforeMute = await readPushLevel(sdk, threadId);
  await rpc.call("mute", { threadId, pushLevelBeforeMute });
  await setPushLevel(sdk, threadId, "muted");
}

export async function unmuteThread(
  rpc: PluginRpcClient<typeof bbSidebarRpcContract>,
  sdk: PluginsRpcCaller,
  threadId: string,
): Promise<void> {
  const { pushLevelBeforeMute } = await rpc.call("unmute", { threadId });
  const current = await readPushLevel(sdk, threadId);
  if (current !== null && current !== "muted") return;
  await setPushLevel(sdk, threadId, pushLevelBeforeMute ?? "inherit");
}
