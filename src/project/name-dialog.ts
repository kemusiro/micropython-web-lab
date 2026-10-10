import { projectPath } from "./filesystem";
import { t } from "../i18n/i18n";

interface NameDialogOptions {
  title: string;
  label: string;
  context: string;
  name: string;
  submitLabel: string;
  submit(name: string): Promise<void>;
}

/** Capture the operation target when opening; persist before closing the dialog. */
export class NameDialog {
  readonly #dialog = document.createElement("dialog");
  readonly #title = document.createElement("h2");
  readonly #context = document.createElement("p");
  readonly #label = document.createElement("span");
  readonly #name = document.createElement("input");
  readonly #error = document.createElement("p");
  readonly #submit = document.createElement("button");
  readonly #cancel = document.createElement("button");
  #options: NameDialogOptions | undefined;
  #pending = false;

  constructor() {
    this.#dialog.id = "project-name-dialog";
    this.#dialog.className = "project-save-dialog";
    this.#title.id = "project-name-dialog-title";
    this.#dialog.setAttribute("aria-labelledby", this.#title.id);
    this.#context.id = "project-name-context";
    this.#context.className = "project-operation-context";
    this.#name.id = "project-entry-name";
    this.#name.required = true;
    this.#name.autocomplete = "off";
    this.#name.setAttribute("aria-describedby", this.#context.id);
    const label = document.createElement("label");
    label.append(this.#label, this.#name);
    this.#error.className = "project-save-error";
    this.#error.setAttribute("role", "alert");
    this.#error.hidden = true;
    this.#cancel.type = "button";
    this.#cancel.className = "quiet";
    this.#cancel.textContent = t("files.cancel");
    this.#cancel.addEventListener("click", () => this.#dialog.close());
    this.#submit.type = "submit";
    const actions = document.createElement("div");
    actions.className = "project-save-actions";
    actions.append(this.#cancel, this.#submit);
    const form = document.createElement("form");
    form.append(this.#title, this.#context, label, this.#error, actions);
    form.addEventListener("submit", event => { event.preventDefault(); void this.#apply(); });
    this.#dialog.addEventListener("cancel", event => { if (this.#pending) event.preventDefault(); });
    this.#dialog.append(form);
    document.body.append(this.#dialog);
  }

  open(options: NameDialogOptions): void {
    if (this.#dialog.open) return;
    this.#options = options;
    this.#title.textContent = options.title;
    this.#context.textContent = options.context;
    this.#label.textContent = options.label;
    this.#name.value = options.name;
    this.#submit.textContent = options.submitLabel;
    this.#error.hidden = true;
    this.#dialog.showModal();
    this.#name.focus();
    this.#name.select();
  }

  async #apply(): Promise<void> {
    if (this.#pending || !this.#options) return;
    this.#error.hidden = true;
    try {
      const name = this.#name.value.trim();
      if (!name || name.includes("/") || name.includes("\\")) throw new Error(t("files.invalidName"));
      projectPath(name);
      this.#pending = true;
      for (const control of [this.#name, this.#submit, this.#cancel]) control.disabled = true;
      await this.#options.submit(name);
      this.#dialog.close();
    } catch (error) {
      this.#error.textContent = error instanceof Error ? error.message : t("draft.unknownResult");
      this.#error.hidden = false;
    } finally {
      this.#pending = false;
      for (const control of [this.#name, this.#submit, this.#cancel]) control.disabled = false;
    }
  }
}
