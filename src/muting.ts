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

function setPushNotificationLevel(
  sdk: PluginsRpcCaller,
  threadId: string,
  level: "muted" | "inherit",
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

export async function setThreadMuted(
  rpc: PluginRpcClient<typeof bbSidebarRpcContract>,
  sdk: PluginsRpcCaller,
  threadId: string,
  muted: boolean,
): Promise<void> {
  await rpc.call(muted ? "mute" : "unmute", { threadId });
  await setPushNotificationLevel(sdk, threadId, muted ? "muted" : "inherit");
}
