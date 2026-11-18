import type { ComponentType } from "react";
import type { ThemeData } from "../core/api";
import { EchoView } from "./echo/View";

export type ThemeView = ComponentType<{ data: ThemeData }>;

/**
 * Erases a View's precise data type for the registry. Safe because the backend validated `data`
 * against this theme's schema before it got here; the ErrorBoundary is the second line of defense.
 */
export function defineView<T extends ThemeData>(view: ComponentType<{ data: T }>): ThemeView {
  return view as ThemeView;
}

// Adding a theme = one View + one entry here. Themes without a View aren't shown.
export const VIEWS: Record<string, ThemeView> = {
  echo: defineView(EchoView),
};
