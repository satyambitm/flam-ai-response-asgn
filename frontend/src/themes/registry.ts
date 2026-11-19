import type { ComponentType } from "react";
import type { ThemeData } from "../core/api";
import { EchoView } from "./echo/View";
import { StudyView } from "./study/View";

export type ThemeView = ComponentType<{ data: ThemeData }>;

/** First-run copy for a theme: what it makes, and inputs to start from. */
export interface ThemeIntro {
  title: string;
  body: string;
  examples: string[];
}

/**
 * Erases a View's precise data type for the registry. Safe because the backend validated `data`
 * against this theme's schema before it got here; the ErrorBoundary is the second line of defense.
 */
export function defineView<T extends ThemeData>(view: ComponentType<{ data: T }>): ThemeView {
  return view as ThemeView;
}

// Adding a theme = one View + one entry here. Themes without a View aren't shown.
export const VIEWS: Record<string, ThemeView> = {
  study: defineView(StudyView),
  echo: defineView(EchoView),
};

/** Shown only in dev or with ?debug: they exist to exercise the pipeline, not for users. */
export const DEV_ONLY: ReadonlySet<string> = new Set(["echo"]);

export const INTROS: Record<string, ThemeIntro> = {
  study: {
    title: "Turn notes into a study set",
    body: "Paste your notes or name a topic. You get flashcards to flip through and a quiz that explains every answer, then re-tests the ones you missed.",
    examples: [
      "Photosynthesis: light reactions vs the Calvin cycle",
      "The causes of World War I",
      "Big-O notation with examples",
      "How vaccines train the immune system",
    ],
  },
  echo: {
    title: "Pipeline test",
    body: "Any text comes back as a title and a checklist of key points. Pair it with fault injection to see every failure state.",
    examples: ["This weekend: groceries, clean the kitchen, call the dentist"],
  },
};
