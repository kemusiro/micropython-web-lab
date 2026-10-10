import { projectPath, type ProjectSnapshot } from "./filesystem";
import { t } from "../i18n/i18n";

export class SaveFileDialog {
  readonly #dialog = document.createElement("dialog");
  readonly #directory = document.createElement("select");
  readonly #filename = document.createElement("input");
  readonly #error = document.createElement("p");
  readonly #save = document.createElement("button");
  readonly #cancel = document.createElement("button");
  readonly #onSave: (path: string) => Promise<boolean>;
  #pending = false;

  constructor(onSave: (path: string) => Promise<boolean>) {
    this.#onSave = onSave;
    this.#dialog.id = "project-save-dialog";
    this.#dialog.className = "project-save-dialog";
    const form = document.createElement("form");
    const title = document.createElement("h2");
    title.id = "project-save-dialog-title";
    title.textContent = t("files.saveDialogTitle");
    this.#dialog.setAttribute("aria-labelledby", title.id);
    const directoryLabel = document.createElement("label");
    directoryLabel.textContent = t("files.directory");
    this.#directory.id = "project-save-directory";
    this.#directory.setAttribute("aria-label", t("files.directory"));
    directoryLabel.append(this.#directory);
    const filenameLabel = document.createElement("label");
    filenameLabel.textContent = t("files.filename");
    this.#filename.id = "project-save-filename";
    this.#filename.setAttribute("aria-label", t("files.filename"));
    this.#filename.required = true;
    this.#filename.placeholder = "main.py";
    this.#filename.autocomplete = "off";
    filenameLabel.append(this.#filename);
    this.#error.className = "project-save-error";
    this.#error.setAttribute("role", "alert");
    this.#error.hidden = true;
    const actions = document.createElement("div");
    actions.className = "project-save-actions";
    this.#cancel.type = "button";
    this.#cancel.className = "quiet";
    this.#cancel.textContent = t("files.cancel");
    this.#cancel.addEventListener("click", () => this.#dialog.close());
    this.#save.type = "submit";
    this.#save.textContent = t("files.save");
    actions.append(this.#cancel, this.#save);
    form.append(title, directoryLabel, filenameLabel, this.#error, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#submit();
    });
    this.#dialog.addEventListener("cancel", (event) => {
      if (this.#pending) event.preventDefault();
    });
    this.#dialog.append(form);
    document.body.append(this.#dialog);
  }

  open(snapshot: ProjectSnapshot, path?: string, selectedDirectory = ""): void {
    if (this.#dialog.open) return;
    const directories = snapshot.entries.filter(entry => entry.kind === "directory").map(entry => entry.path);
    this.#directory.replaceChildren(...["", ...directories].map(directory => {
      const option = document.createElement("option");
      option.value = directory;
      option.textContent = directory ? `/project/${directory}` : "/project";
      return option;
    }));
    const directory = path?.split("/").slice(0, -1).join("/") ?? selectedDirectory;
    this.#directory.value = directories.includes(directory) ? directory : "";
    this.#filename.value = path?.split("/").at(-1) ?? "";
    this.#error.hidden = true;
    this.#dialog.showModal();
    this.#filename.focus();
    this.#filename.select();
  }

  async #submit(): Promise<void> {
    if (this.#pending) return;
    this.#error.hidden = true;
    try {
      const name = this.#filename.value.trim();
      if (!name || name.includes("/") || name.includes("\\")) throw new Error(t("files.invalidFilename"));
      const path = projectPath(this.#directory.value ? `${this.#directory.value}/${name}` : name);
      this.#pending = true;
      for (const control of [this.#directory, this.#filename, this.#save, this.#cancel]) control.disabled = true;
      if (await this.#onSave(path)) this.#dialog.close();
    } catch (error) {
      this.#error.textContent = error instanceof Error ? error.message : t("draft.unknownResult");
      this.#error.hidden = false;
    } finally {
      this.#pending = false;
      for (const control of [this.#directory, this.#filename, this.#save, this.#cancel]) control.disabled = false;
    }
  }
}
