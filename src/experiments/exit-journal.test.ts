import { describe, expect, it } from "vitest";
import { makeExperiment } from "../../fixtures/experiments/fixture";
import { snapshotExperiment } from "./record";
import { clearExperimentJournal, EXPERIMENT_EXIT_JOURNAL_KEY, parseExperimentJournal, recoverExperimentJournal, writeExperimentJournal } from "./exit-journal";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe("experiment exit journal", () => {
  it("recovers buffers and unnamed tabs without rewriting files, even when times match", () => {
    const persisted = makeExperiment();
    const edited = snapshotExperiment(persisted);
    edited.editor.tabs[0] = { ...edited.editor.tabs[0]!, source: "print('latest')" };
    edited.editor.tabs.push({ id: "new", title: "無題", source: "new draft" });
    const token = writeExperimentJournal(storage(), edited);
    const recovered = recoverExperimentJournal(persisted, token);
    expect(recovered.filesystem).toEqual(persisted.filesystem);
    expect(recovered.editor).toEqual(edited.editor);
    expect(recovered.revision).toBe(persisted.revision);
  });
  it.each([{ setId: "other" }, { baseRevision: 2 }, { schemaVersion: 2 }, { baseRevision: -1 }])(
    "refuses an unrelated, obsolete or invalid journal: %j", change => {
      const record = makeExperiment();
      const token = writeExperimentJournal(storage(), record);
      expect(() => recoverExperimentJournal(record, JSON.stringify({ ...JSON.parse(token), ...change }))).toThrow();
    },
  );
  it("does not change file associations from a journal", () => {
    const record = makeExperiment();
    const journal = JSON.parse(writeExperimentJournal(storage(), record));
    journal.tabs[0].path = "other.py";
    expect(() => recoverExperimentJournal(record, JSON.stringify(journal))).toThrow("file associations");
  });
  it("rejects oversized UTF-8 buffers without truncating or replacing a previous journal", () => {
    const record = makeExperiment();
    const store = storage();
    const token = writeExperimentJournal(store, record);
    record.editor.tabs[0] = { ...record.editor.tabs[0]!, source: "あ".repeat(100_000) };
    expect(() => writeExperimentJournal(store, record)).toThrow("256 KiB");
    expect(store.getItem(EXPERIMENT_EXIT_JOURNAL_KEY)).toBe(token);
    expect(() => parseExperimentJournal("{" )).toThrow();
  });
  it("does not clear a newer journal written while the same revision is saving", () => {
    const record = makeExperiment();
    const store = storage();
    const old = writeExperimentJournal(store, record);
    record.editor.tabs[0] = { ...record.editor.tabs[0]!, source: "newer buffer" };
    const latest = writeExperimentJournal(store, record);
    clearExperimentJournal(store, record.id, record.revision, old);
    expect(store.getItem(EXPERIMENT_EXIT_JOURNAL_KEY)).toBe(latest);
    clearExperimentJournal(store, "other", record.revision, latest);
    expect(store.getItem(EXPERIMENT_EXIT_JOURNAL_KEY)).toBe(latest);
    clearExperimentJournal(store, record.id, record.revision, latest);
    expect(store.getItem(EXPERIMENT_EXIT_JOURNAL_KEY)).toBeNull();
  });
});
