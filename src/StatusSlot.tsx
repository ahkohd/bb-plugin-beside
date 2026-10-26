import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { StatusGlyph, hasStatusGlyph } from "./StatusGlyph";

export function ThreadStatus({ thread }: { thread: PluginSidebarThread }) {
  if (!hasStatusGlyph(thread.indicator)) return null;
  return (
    <StatusGlyph indicator={thread.indicator} label={thread.indicatorLabel} />
  );
}
