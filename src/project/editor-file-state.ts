import type { EditorWorkspaceTab } from "./editor-draft";
import type { ProjectEntry } from "./filesystem";

/** Textareas normalize line endings; viewing a CRLF file alone is not an edit. */
export function hasUnsavedEditorChanges(tab: EditorWorkspaceTab, savedEntry?: ProjectEntry): boolean {
  if (!tab.path || savedEntry?.kind !== "file") return true;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(savedEntry.data);
    return tab.source.replace(/\r\n?/g, "\n") !== source.replace(/\r\n?/g, "\n");
  } catch { return true; }
}
