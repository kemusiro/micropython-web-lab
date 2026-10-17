import type { DraftStorage } from "../project/editor-draft";

export type AppScreen = "experiment" | "workspace";
export const APP_SCREEN_STORAGE_KEY = "micropython-web-lab:app-screen:v1";
export type ExperimentTopic = "led" | "button";
export const EXPERIMENT_TOPIC_STORAGE_KEY = "micropython-web-lab:experiment-topic:v1";

export function loadExperimentTopic(storage: DraftStorage | null): ExperimentTopic {
  try {
    return storage?.getItem(EXPERIMENT_TOPIC_STORAGE_KEY) === "button" ? "button" : "led";
  } catch {
    return "led";
  }
}

export function saveExperimentTopic(storage: DraftStorage | null, topic: ExperimentTopic): void {
  try {
    storage?.setItem(EXPERIMENT_TOPIC_STORAGE_KEY, topic);
  } catch {
    // Topic selection must still work when browser storage is unavailable.
  }
}

/** Presentation preference only; editor and connection schemas remain unchanged. */
export function loadAppScreen(
  storage: DraftStorage | null,
  options: { hasSavedWorkspace: boolean; storageError: boolean; localMode: boolean },
): AppScreen {
  if (options.localMode || options.storageError) return "workspace";
  try {
    const saved = storage?.getItem(APP_SCREEN_STORAGE_KEY);
    if (saved === "experiment" || saved === "workspace") return saved;
  } catch {
    // The existing draft status reports storage failures. Navigation still works.
  }
  return options.hasSavedWorkspace ? "workspace" : "experiment";
}

export function saveAppScreen(storage: DraftStorage | null, screen: AppScreen): void {
  try {
    storage?.setItem(APP_SCREEN_STORAGE_KEY, screen);
  } catch {
    // A failed preference write must never prevent access to code or recovery.
  }
}
