import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import * as z from "zod/mini";
import type { bbSidebarRpcContract } from "./server";

interface ParsingSchema<TOutput> {
  parse(value: unknown): TOutput;
}

interface PluginsRpcCaller {
  plugins: {
    callRpc<TOutput>(args: {
      pluginId: string;
      method: string;
      input?: unknown;
      outputSchema: ParsingSchema<TOutput>;
    }): Promise<TOutput>;
  };
}

type LifecycleRpc = PluginRpcClient<typeof bbSidebarRpcContract>;

const PUSH_NOTIFICATIONS_PLUGIN_ID = "push-notifications";

type PushLevel = "inherit" | "all" | "input-only" | "muted";

const pushLevelSchema = z.enum(["inherit", "all", "input-only", "muted"]);

const threadNotificationsSchema = z.object({
  threads: z.record(z.string(), z.looseObject({ own: z.string() })),
});

export class PushLevelError extends Error {}

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

async function setPushLevel(
  sdk: PluginsRpcCaller,
  threadId: string,
  level: PushLevel,
): Promise<boolean> {
  try {
    await sdk.plugins.callRpc({
      pluginId: PUSH_NOTIFICATIONS_PLUGIN_ID,
      method: "threadNotifications.set",
      input: { threadId, level },
      outputSchema: z.unknown(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function muteThread(
  rpc: LifecycleRpc,
  sdk: PluginsRpcCaller,
  threadId: string,
): Promise<void> {
  const pushLevelBeforeMute = await readPushLevel(sdk, threadId);
  await rpc.call("mute", { threadId, pushLevelBeforeMute });
  if (pushLevelBeforeMute === null) return;
  if (!(await setPushLevel(sdk, threadId, "muted"))) {
    throw new PushLevelError(
      "Muted here, but its push notifications could not be turned off",
    );
  }
}

export async function unmuteThread(
  rpc: LifecycleRpc,
  sdk: PluginsRpcCaller,
  threadId: string,
): Promise<void> {
  const { pushLevelBeforeMute } = await rpc.call("getMuteState", { threadId });
  const current = await readPushLevel(sdk, threadId);
  if (current === "muted") {
    const restored = await setPushLevel(
      sdk,
      threadId,
      pushLevelBeforeMute ?? "inherit",
    );
    if (!restored) {
      throw new PushLevelError(
        "Could not restore its push notifications, so it stays muted",
      );
    }
  }
  await rpc.call("unmute", { threadId });
}
