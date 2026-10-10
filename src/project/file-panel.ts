import { MAX_PROJECT_BYTES, ProjectFiles, projectPath, type ProjectSnapshot } from "./filesystem";
import { exportProjectZip, projectSubtree } from "./zip";
import { readProjectZip } from "./zip-client";
import { SaveFileDialog } from "./save-file-dialog";
import { NameDialog } from "./name-dialog";
import { MoveDialog } from "./move-dialog";
import { FileTree } from "./file-tree";
import { t } from "../i18n/i18n";

export interface FilePanelActions {
  snapshot(): ProjectSnapshot;
  open(path: string): void;
  createFile(): void;
  activePath(): string | undefined;
  saveAs(path: string): Promise<boolean>;
  change(snapshot: ProjectSnapshot, rename?: { from: string; to: string }): Promise<void>;
  replace(snapshot: ProjectSnapshot): Promise<void>;
  backupDrafts(): Promise<void>;
  error(error: unknown): void;
  busyChanged(): void;
}

export class FilePanel {
  #actions: FilePanelActions;
  #root: HTMLElement;
  #tree: FileTree;
  #selection: HTMLElement;
  #status: HTMLElement;
  #zip: ProjectSnapshot | null = null;
  #importRoot: HTMLSelectElement;
  #preview: HTMLElement;
  #saveDialog: SaveFileDialog;
  #nameDialog = new NameDialog();
  #moveDialog: MoveDialog;
  #busy = false;
  #runtimeLocked = false;
  get busy(): boolean { return this.#busy; }
  constructor(root: HTMLElement, actions: FilePanelActions) {
    this.#actions = actions;
    this.#root = root;
    this.#saveDialog = new SaveFileDialog(path => this.#saveTo(path));
    this.#moveDialog = new MoveDialog((from, directory) => this.#moveTo(from, directory));
    root.className = "project-files";
    const summary = document.createElement("summary"); summary.textContent = t("files.title"); root.append(summary);
    this.#status = document.createElement("p"); this.#status.id = "project-files-status"; this.#status.setAttribute("aria-live", "polite"); root.append(this.#status);
    const layout = document.createElement("div"); layout.className = "project-file-layout"; root.append(layout);
    const explorer = document.createElement("div"); explorer.className = "project-file-explorer"; layout.append(explorer);
    const controls = document.createElement("details"); controls.className = "project-file-controls"; controls.id = "project-file-tools"; layout.append(controls);
    const toolsSummary = document.createElement("summary"); toolsSummary.textContent = t("workspace.fileTools"); controls.append(toolsSummary);
    this.#tree = new FileTree({
      select: () => { this.#updateSelection(); this.#applyLocked(); },
      open: path => { try { actions.open(path); } catch (error) { actions.error(error); } },
      move: (from, directory) => { void this.#moveTo(from, directory).catch(actions.error); },
    });
    explorer.append(this.#tree.element);
    const hint = document.createElement("p"); hint.className = "project-tree-hint"; hint.textContent = t("files.treeHint"); explorer.append(hint);
    const activeActions = document.createElement("div"); activeActions.className = "project-file-active-actions"; controls.append(activeActions);
    const saveActive = document.createElement("button"); saveActive.type = "button"; saveActive.id = "project-file-save"; saveActive.textContent = t("files.saveActive");
    saveActive.addEventListener("click", () => this.saveActiveTab());
    const saveAs = document.createElement("button"); saveAs.type = "button"; saveAs.className = "quiet"; saveAs.id = "project-file-save-as"; saveAs.textContent = t("files.saveAs");
    saveAs.addEventListener("click", () => this.#openSaveDialog());
    activeActions.append(saveActive, saveAs);
    this.#selection = document.createElement("p"); this.#selection.id = "project-file-selection"; this.#selection.className = "project-operation-context"; controls.append(this.#selection);
    const buttons = document.createElement("div"); buttons.className = "project-file-actions"; controls.append(buttons);
    const button = (key: Parameters<typeof t>[0], id: string, callback: () => void | Promise<void>, locks = true) => {
      const element = document.createElement("button"); element.type = "button"; element.className = "quiet"; element.id = id; element.textContent = t(key);
      element.addEventListener("click", () => {
        if (locks) this.#setBusy(true);
        void Promise.resolve().then(callback).catch(actions.error).finally(() => { if (locks) this.#setBusy(false); });
      }); buttons.append(element);
    };
    button("files.create", "project-file-create", () => actions.createFile(), false);
    button("files.open", "project-file-open", () => actions.open(this.#tree.selectedPath), false);
    button("files.mkdir", "project-directory-create", () => this.#openNameDialog("create"), false);
    button("files.rename", "project-file-rename", () => this.#openNameDialog("rename"), false);
    button("files.move", "project-file-move", () => {
      if (!this.#runtimeLocked && !this.#busy) this.#moveDialog.open(actions.snapshot(), this.#tree.selectedPath);
    }, false);
    button("files.delete", "project-file-delete", async () => {
      const from = this.#tree.selectedPath;
      const snapshot = actions.snapshot();
      const descendants = snapshot.entries.filter(entry => entry.path.startsWith(from + "/"));
      if (descendants.length && !window.confirm(t("files.deleteDirectoryConfirm", { path: `/project/${from}`, count: descendants.length }))) return;
      const files = new ProjectFiles(snapshot); files.remove(from, descendants.length > 0); await actions.change(files.snapshot());
    });
    button("files.export", "project-zip-export", async () => {
      await actions.backupDrafts();
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
  async #moveTo(from: string, directory: string): Promise<void> {
    if (this.#runtimeLocked || this.#busy) throw new Error(t("files.wait"));
    const to = projectPath(directory ? `${directory}/${from.split("/").at(-1)!}` : from.split("/").at(-1)!);
    if (to === from) return;
    this.#setBusy(true);
    try {
      const files = new ProjectFiles(this.#actions.snapshot());
      if ((directory && files.get(directory)?.kind !== "directory") || directory === from || directory.startsWith(from + "/")) throw new Error(t("files.invalidMoveDestination"));
      if (files.get(to)) throw new Error(t("files.moveConflict", { path: `/project/${to}` }));
      files.rename(from, to);
      await this.#actions.change(files.snapshot(), { from, to });
    } finally { this.#setBusy(false); }
    this.#tree.selectPath(to);
  }
  #openNameDialog(operation: "create" | "rename"): void {
    if (this.#runtimeLocked || this.#busy) return;
    const from = this.#tree.selectedPath;
    const entry = this.#actions.snapshot().entries.find(entry => entry.path === from);
    if (operation === "rename" && !entry) return;
    const parent = operation === "create" && entry?.kind !== "file" ? from : from.split("/").slice(0, -1).join("/");
    const directory = operation === "create" || entry?.kind === "directory";
    const contextPath = operation === "create" ? parent : from;
    this.#nameDialog.open({
      title: t(operation === "create" ? "files.mkdir" : directory ? "files.renameDirectory" : "files.renameFile"),
      label: t(directory ? "files.directoryName" : "files.filename"),
      context: t(operation === "create" ? "files.parentDirectory" : "files.selected", { path: contextPath ? `/project/${contextPath}` : "/project" }),
      name: operation === "create" ? "" : from.split("/").at(-1)!,
      submitLabel: t(operation === "create" ? "files.createAction" : "files.renameAction"),
      submit: async name => {
        if (this.#runtimeLocked || this.#busy) throw new Error(t("files.wait"));
        const to = projectPath(parent ? `${parent}/${name}` : name);
        if (operation === "rename" && to === from) return;
        this.#setBusy(true);
        try {
          const files = new ProjectFiles(this.#actions.snapshot());
          if (operation === "create") {
            // Never recreate a parent that disappeared while the dialog was open.
            if (parent && files.get(parent)?.kind !== "directory") throw new Error(t("files.selectDirectory"));
            files.mkdir(to);
          } else files.rename(from, to);
          await this.#actions.change(files.snapshot(), operation === "rename" ? { from, to } : undefined);
        } finally { this.#setBusy(false); }
        this.#tree.selectPath(to);
      },
    });
  }
  saveActiveTab(): void {
    if (this.#runtimeLocked || this.#busy) return;
    const path = this.#actions.activePath();
    if (path === undefined) this.#openSaveDialog();
    else void this.#saveTo(path).catch(this.#actions.error);
  }
  #openSaveDialog(): void {
    if (this.#runtimeLocked || this.#busy) return;
    const snapshot = this.#actions.snapshot();
    const selected = this.#tree.selectedPath;
    const entry = snapshot.entries.find(entry => entry.path === selected);
    const directory = entry?.kind === "directory" ? selected : selected.split("/").slice(0, -1).join("/");
    this.#saveDialog.open(snapshot, this.#actions.activePath(), directory);
  }
  async #saveTo(path: string): Promise<boolean> {
    if (this.#runtimeLocked || this.#busy) throw new Error(t("files.wait"));
    this.#setBusy(true);
    try { return await this.#actions.saveAs(path); }
    finally { this.#setBusy(false); }
  }
  render(): void {
    const snapshot = this.#actions.snapshot();
    this.#tree.render(snapshot);
    const used = snapshot.entries.reduce((sum, entry) => sum + (entry.kind === "file" ? entry.data.length : 0), 0);
    this.#status.textContent = `${used.toLocaleString()} / ${MAX_PROJECT_BYTES.toLocaleString()} bytes · /project`;
    this.#updateSelection();
    this.#applyLocked();
  }
  #updateSelection(): void {
    this.#selection.textContent = t("files.selected", { path: this.#tree.selectedPath ? `/project/${this.#tree.selectedPath}` : "/project" });
  }
  #setBusy(busy: boolean): void { this.#busy = busy; this.#actions.busyChanged(); this.#applyLocked(); }
  #applyLocked(): void {
    const locked = this.#runtimeLocked || this.#busy;
    this.#tree.setLocked(locked);
    for (const control of this.#root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")) control.disabled = locked;
    const selected = this.#actions.snapshot().entries.find(entry => entry.path === this.#tree.selectedPath);
    for (const id of ["project-file-rename", "project-file-move", "project-file-delete"]) this.#root.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = locked || !selected;
    this.#root.querySelector<HTMLButtonElement>("#project-file-open")!.disabled = locked || selected?.kind !== "file";
  }
  setLocked(locked: boolean): void { this.#runtimeLocked = locked; this.#applyLocked(); }
}
