import type { DraftStorage } from "../project/editor-draft";
import { snapshotStoredProject } from "../project/project-state";
import { recordIdentifier, recordObject, snapshotExperiment, type ExperimentSet } from "./record";

export const EXPERIMENT_EXIT_JOURNAL_KEY = "micropython-web-lab:experiment-exit:v1";
export const MAX_EXPERIMENT_EXIT_BYTES = 256 * 1024;
export interface ExperimentExitJournal {
  readonly schemaVersion: 1;
  readonly setId: string;
  readonly baseRevision: number;
  readonly tabs: ExperimentSet["editor"]["tabs"];
  readonly activeTabId: string;
}

export function parseExperimentJournal(serialized: string): ExperimentExitJournal {
  if (new TextEncoder().encode(serialized).byteLength > MAX_EXPERIMENT_EXIT_BYTES) throw new Error("Experiment exit journal exceeds 256 KiB");
  const v = recordObject(JSON.parse(serialized));
  if (v.schemaVersion !== 1 || !Number.isSafeInteger(v.baseRevision) || (v.baseRevision as number) < 1) throw new Error("Invalid experiment exit journal");
  const editor = snapshotStoredProject({ version: 1, filesystem: { version: 1, entries: [] }, tabs: v.tabs, activeTabId: v.activeTabId });
  return { schemaVersion: 1, setId: recordIdentifier(v.setId), baseRevision: v.baseRevision as number, tabs: editor.tabs, activeTabId: editor.activeTabId };
}

export function writeExperimentJournal(storage: DraftStorage, record: ExperimentSet): string {
  const journal: ExperimentExitJournal = { schemaVersion: 1, setId: record.id, baseRevision: record.revision, ...record.editor };
  const serialized = JSON.stringify(journal);
  parseExperimentJournal(serialized);
  storage.setItem(EXPERIMENT_EXIT_JOURNAL_KEY, serialized);
  return serialized;
}

export function recoverExperimentJournal(record: ExperimentSet, serialized: string): ExperimentSet {
  const journal = parseExperimentJournal(serialized);
  if (journal.setId !== record.id || journal.baseRevision !== record.revision) throw new Error("Experiment exit journal does not match the saved revision");
  const tabs = journal.tabs.map(tab => {
    const path = record.editor.tabs.find(saved => saved.id === tab.id)?.path;
    if (tab.path !== path) throw new Error("Exit journal cannot change file associations");
    return { ...tab };
  });
  return snapshotExperiment({ ...record, editor: { tabs, activeTabId: journal.activeTabId } });
}

/** Clear only the journal belonging to the revision whose write just completed. */
export function clearExperimentJournal(storage: DraftStorage, setId: string, baseRevision: number, expectedSerialized: string): void {
  const serialized = storage.getItem(EXPERIMENT_EXIT_JOURNAL_KEY);
  if (serialized === null || serialized !== expectedSerialized) return;
  const journal = parseExperimentJournal(serialized);
  if (journal.setId === setId && journal.baseRevision === baseRevision) storage.removeItem(EXPERIMENT_EXIT_JOURNAL_KEY);
}
