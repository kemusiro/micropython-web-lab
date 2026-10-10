import { MAX_PROJECT_BYTES, ProjectFiles, projectPath, type ProjectSnapshot } from "./filesystem";
import { exportProjectZip, projectSubtree } from "./zip";
import { readProjectZip } from "./zip-client";
import { FileTree } from "./file-tree";
import { t } from "../i18n/i18n";

export interface FilePanelActions {
  snapshot(): ProjectSnapshot;
  open(path: string): void;
  saveAs(path: string): Promise<void>;
  change(snapshot: ProjectSnapshot, rename?: { from: string; to: string }): Promise<void>;
  replace(snapshot: ProjectSnapshot): Promise<void>;
  saveEditors(): Promise<void>;
  error(error: unknown): void;
  busyChanged(): void;
}

export class FilePanel {
  #actions: FilePanelActions;
  #root: HTMLElement;
  #tree: FileTree;
  #path: HTMLInputElement;
  #status: HTMLElement;
  #zip: ProjectSnapshot | null = null;
  #importRoot: HTMLSelectElement;
  #preview: HTMLElement;
  #busy = false;
  #runtimeLocked = false;
  get busy(): boolean { return this.#busy; }
  constructor(root: HTMLElement, actions: FilePanelActions) {
    this.#actions = actions;
    this.#root = root;
    root.className = "project-files";
    const summary = document.createElement("summary"); summary.textContent = t("files.title"); root.append(summary);
    this.#status = document.createElement("p"); this.#status.id = "project-files-status"; this.#status.setAttribute("aria-live", "polite"); root.append(this.#status);
    const layout = document.createElement("div"); layout.className = "project-file-layout"; root.append(layout);
    const explorer = document.createElement("div"); explorer.className = "project-file-explorer"; layout.append(explorer);
    const controls = document.createElement("div"); controls.className = "project-file-controls"; layout.append(controls);
    this.#tree = new FileTree({
      select: path => { this.#path.value = path; },
      open: path => { try { actions.open(path); } catch (error) { actions.error(error); } },
    });
    explorer.append(this.#tree.element);
    const hint = document.createElement("p"); hint.className = "project-tree-hint"; hint.textContent = t("files.treeHint"); explorer.append(hint);
    const label = document.createElement("label"); label.textContent = t("files.path");
    this.#path = document.createElement("input"); this.#path.id = "project-file-path"; this.#path.placeholder = "drivers/sensor.py"; label.append(this.#path); controls.append(label);
    this.#path.addEventListener("keydown", event => { if (event.key === "Enter") event.preventDefault(); });
    const buttons = document.createElement("div"); buttons.className = "project-file-actions"; controls.append(buttons);
    const button = (key: Parameters<typeof t>[0], id: string, callback: () => void | Promise<void>) => {
      const element = document.createElement("button"); element.type = "button"; element.className = "quiet"; element.id = id; element.textContent = t(key);
      element.addEventListener("click", () => {
        const locks = id !== "project-file-open";
        if (locks) this.#setBusy(true);
        void Promise.resolve().then(callback).catch(actions.error).finally(() => { if (locks) this.#setBusy(false); });
      }); buttons.append(element);
    };
    button("files.open", "project-file-open", () => actions.open(this.#tree.selectedPath));
    button("files.saveAs", "project-file-save-as", () => actions.saveAs(projectPath(this.#path.value)));
    button("files.mkdir", "project-directory-create", async () => { const files = new ProjectFiles(actions.snapshot()); files.mkdir(this.#path.value); await actions.change(files.snapshot()); });
    button("files.rename", "project-file-rename", async () => {
      const from = this.#tree.selectedPath, to = projectPath(this.#path.value);
      const files = new ProjectFiles(actions.snapshot()); files.rename(from, to); await actions.change(files.snapshot(), { from, to });
    });
    button("files.delete", "project-file-delete", async () => {
      const from = this.#tree.selectedPath;
      if (!window.confirm(t("files.deleteConfirm", { path: from }))) return;
      const files = new ProjectFiles(actions.snapshot()); files.remove(from); await actions.change(files.snapshot());
    });
    button("files.export", "project-zip-export", async () => {
      await actions.saveEditors();
      const bytes = exportProjectZip(actions.snapshot());
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/zip" }));
      const link = document.createElement("a"); link.href = url; link.download = "micropython-project.zip"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const upload = document.createElement("input"); upload.type = "file"; upload.accept = ".zip,application/zip"; upload.id = "project-zip-file";
    const uploadLabel = document.createElement("label"); uploadLabel.textContent = t("files.import"); uploadLabel.append(upload); controls.append(uploadLabel);
    this.#preview = document.createElement("div"); this.#preview.hidden = true; controls.append(this.#preview);
    this.#importRoot = document.createElement("select"); this.#importRoot.id = "project-zip-root"; this.#importRoot.setAttribute("aria-label", t("files.importRoot"));
    const previewLabel = document.createElement("label"); previewLabel.textContent = t("files.importRoot"); previewLabel.append(this.#importRoot); this.#preview.append(previewLabel);
    const tree = document.createElement("pre"); tree.id = "project-zip-preview"; this.#preview.append(tree);
    const confirm = document.createElement("button"); confirm.id = "project-zip-import"; confirm.type = "button"; confirm.textContent = t("files.replace"); this.#preview.append(confirm);
    upload.addEventListener("change", () => {
      this.#zip = null; this.#preview.hidden = true;
      const file = upload.files?.[0]; if (!file) return;
      this.#setBusy(true);
      void readProjectZip(file).then(snapshot => {
        this.#zip = snapshot;
        const directories = snapshot.entries.filter(entry => entry.kind === "directory").map(entry => entry.path);
        this.#importRoot.replaceChildren(...["", ...directories].map(path => { const option = document.createElement("option"); option.value = path; option.textContent = path || "/"; return option; }));
        this.#importRoot.onchange = () => { tree.textContent = projectSubtree(snapshot, this.#importRoot.value).entries.map(entry => entry.path + (entry.kind === "directory" ? "/" : "")).join("\n"); };
        this.#importRoot.onchange(new Event("change"));
        this.#preview.hidden = false;
      }).catch(actions.error).finally(() => this.#setBusy(false));
    });
    confirm.addEventListener("click", () => {
      if (!this.#zip || !window.confirm(t("files.replaceConfirm"))) return;
      this.#setBusy(true);
      void actions.replace(projectSubtree(this.#zip, this.#importRoot.value)).then(() => { this.#zip = null; this.#preview.hidden = true; upload.value = ""; }).catch(actions.error).finally(() => this.#setBusy(false));
    });
    this.render();
  }
  render(): void {
    const snapshot = this.#actions.snapshot();
    this.#tree.render(snapshot);
    const used = snapshot.entries.reduce((sum, entry) => sum + (entry.kind === "file" ? entry.data.length : 0), 0);
    this.#status.textContent = `${used.toLocaleString()} / ${MAX_PROJECT_BYTES.toLocaleString()} bytes · /project`;
  }
  #setBusy(busy: boolean): void { this.#busy = busy; this.#actions.busyChanged(); this.#applyLocked(); }
  #applyLocked(): void { this.#tree.setLocked(this.#runtimeLocked || this.#busy); for (const control of this.#root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")) control.disabled = this.#runtimeLocked || this.#busy; }
  setLocked(locked: boolean): void { this.#runtimeLocked = locked; this.#applyLocked(); }
}
