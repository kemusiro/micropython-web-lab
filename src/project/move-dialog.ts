import type { ProjectSnapshot } from "./filesystem";
import { t } from "../i18n/i18n";

export class MoveDialog {
  readonly #dialog = document.createElement("dialog");
  readonly #source = document.createElement("p");
  readonly #directory = document.createElement("select");
  readonly #error = document.createElement("p");
  readonly #move = document.createElement("button");
  readonly #cancel = document.createElement("button");
  readonly #onMove: (from: string, directory: string) => Promise<void>;
  #from = "";
  #parent = "";
  #pending = false;

  constructor(onMove: (from: string, directory: string) => Promise<void>) {
    this.#onMove = onMove;
    this.#dialog.id = "project-move-dialog";
    this.#dialog.className = "project-save-dialog";
    const title = document.createElement("h2");
    title.id = "project-move-dialog-title";
    title.textContent = t("files.moveTitle");
    this.#dialog.setAttribute("aria-labelledby", title.id);
    this.#source.className = "project-operation-context";
    const label = document.createElement("label");
    label.textContent = t("files.moveDestination");
    this.#directory.id = "project-move-directory";
    this.#directory.setAttribute("aria-label", t("files.moveDestination"));
    this.#directory.addEventListener("change", () => {
      this.#error.hidden = true;
      this.#updateControls();
    });
    label.append(this.#directory);
    const hint = document.createElement("p");
    hint.id = "project-move-hint";
    hint.className = "project-operation-context";
    hint.textContent = t("files.moveHint");
    this.#directory.setAttribute("aria-describedby", hint.id);
    this.#error.className = "project-save-error";
    this.#error.setAttribute("role", "alert");
    this.#error.hidden = true;
    this.#cancel.type = "button";
    this.#cancel.className = "quiet";
    this.#cancel.textContent = t("files.cancel");
    this.#cancel.addEventListener("click", () => this.#dialog.close());
    this.#move.type = "submit";
    this.#move.textContent = t("files.move");
    const actions = document.createElement("div");
    actions.className = "project-save-actions";
    actions.append(this.#cancel, this.#move);
    const form = document.createElement("form");
    form.append(title, this.#source, label, hint, this.#error, actions);
    form.addEventListener("submit", event => { event.preventDefault(); void this.#submit(); });
    this.#dialog.addEventListener("cancel", event => { if (this.#pending) event.preventDefault(); });
    this.#dialog.append(form);
    document.body.append(this.#dialog);
  }

  open(snapshot: ProjectSnapshot, from: string): void {
    if (this.#dialog.open || !snapshot.entries.some(entry => entry.path === from)) return;
    this.#from = from;
    this.#parent = from.split("/").slice(0, -1).join("/");
    this.#source.textContent = t("files.moveSource", { path: `/project/${from}` });
    // A directory cannot move into itself or any of its descendants.
    const directories = snapshot.entries.filter(entry => entry.kind === "directory" && entry.path !== from && !entry.path.startsWith(from + "/")).map(entry => entry.path);
    this.#directory.replaceChildren(...["", ...directories].map(directory => {
      const option = document.createElement("option");
      option.value = directory;
      option.textContent = directory ? `/project/${directory}` : "/project";
      return option;
    }));
    this.#directory.value = this.#parent;
    this.#error.hidden = true;
    this.#updateControls();
    this.#dialog.showModal();
    this.#directory.focus();
  }

  #updateControls(): void {
    this.#directory.disabled = this.#pending;
    this.#cancel.disabled = this.#pending;
    this.#move.disabled = this.#pending || this.#directory.value === this.#parent;
  }

  async #submit(): Promise<void> {
    if (this.#pending || this.#directory.value === this.#parent) return;
    this.#pending = true;
    this.#error.hidden = true;
    this.#updateControls();
    try {
      await this.#onMove(this.#from, this.#directory.value);
      this.#dialog.close();
    } catch (error) {
      this.#error.textContent = error instanceof Error ? error.message : t("draft.unknownResult");
      this.#error.hidden = false;
    } finally {
      this.#pending = false;
      this.#updateControls();
    }
  }
}
