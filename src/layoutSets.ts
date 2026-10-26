export const LAYOUT_SET_NAMES = [
  "collapsedShelves",
  "expandedParents",
] as const;
export type LayoutSetName = (typeof LAYOUT_SET_NAMES)[number];

export const LAYOUT_CHANNEL = "layout";

export const SETTINGS_CHANNEL = "settings";
