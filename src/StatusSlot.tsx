import {
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  useSidebarThreadRowStatus,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

export function ThreadStatus({ thread }: { thread: PluginSidebarThread }) {
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  return (
    <ThreadStatusGlyph indicator={thread.indicator} rowStatus={rowStatus} />
  );
}
