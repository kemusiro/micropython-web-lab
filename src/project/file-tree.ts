import { t } from "../i18n/i18n";
import type { ProjectEntry, ProjectSnapshot } from "./filesystem";

interface FileTreeActions {
  select(path: string): void;
  open(path: string): void;
}

/** View state stays separate from the saved filesystem. */
export class FileTree {
  readonly element: HTMLElement;
  readonly #list: HTMLUListElement;
  readonly #empty: HTMLElement;
  readonly #actions: FileTreeActions;
  readonly #expanded = new Set<string>();
  #entries: ProjectEntry[] = [];
  #structure = "";
  #selected = "";
  #focused = "";
  #locked = false;

  constructor(actions: FileTreeActions) {
    this.#actions = actions;
    this.element = document.createElement("div");
    this.element.className = "project-file-tree";
    const heading = document.createElement("div");
    heading.className = "project-tree-root";
    heading.append(fileIcon("directory"), document.createTextNode("/project"));
    this.#list = document.createElement("ul");
    this.#list.id = "project-file-tree";
    this.#list.setAttribute("role", "tree");
    this.#list.setAttribute("aria-label", t("files.list"));
    this.#empty = document.createElement("p");
    this.#empty.className = "project-tree-empty";
    this.#empty.textContent = t("files.empty");
    this.element.append(heading, this.#list, this.#empty);
  }

  get selectedPath(): string { return this.#selected; }

  render(snapshot: ProjectSnapshot): void {
    // Content-only writes must not replace the tree while someone is using it.
    const structure = JSON.stringify(snapshot.entries.map(entry => [entry.kind, entry.path]).sort());
    if (structure === this.#structure) return;
    const previousSelection = this.#selected;
    this.#structure = structure;
    this.#entries = snapshot.entries;
    const paths = new Set(this.#entries.map(entry => entry.path));
    for (const path of this.#expanded) if (!paths.has(path)) this.#expanded.delete(path);
    if (!paths.has(this.#selected)) {
      let parent = parentPath(this.#selected);
      while (parent && !paths.has(parent)) parent = parentPath(parent);
      this.#selected = parent;
    }
    this.#draw();
    if (!this.#selected) this.#selected = this.#visibleItems()[0]?.dataset.path ?? "";
    this.#updateSelection();
    if (this.#selected !== previousSelection) this.#actions.select(this.#selected);
  }

  setLocked(locked: boolean): void {
    this.#locked = locked;
    this.#list.setAttribute("aria-disabled", String(locked));
    this.#updateSelection();
  }

  #draw(): void {
    const restoreFocus = this.#list.contains(document.activeElement);
    const scrollTop = this.element.scrollTop;
    const children = new Map<string, ProjectEntry[]>();
    for (const entry of this.#entries) {
      const parent = parentPath(entry.path);
      const siblings = children.get(parent) ?? [];
      siblings.push(entry);
      children.set(parent, siblings);
    }
    const drawChildren = (parent: string, depth: number): HTMLLIElement[] => {
      const siblings = [...(children.get(parent) ?? [])].sort((a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        basename(a.path).localeCompare(basename(b.path), undefined, { numeric: true }));
      return siblings.map(entry => {
        const item = document.createElement("li");
        item.setAttribute("role", "treeitem");
        item.setAttribute("aria-label", basename(entry.path));
        item.setAttribute("aria-level", String(depth + 1));
        item.dataset.path = entry.path;
        item.dataset.kind = entry.kind;
        item.title = "/project/" + entry.path;
        const row = document.createElement("div");
        row.className = "project-tree-row";
        row.style.paddingInlineStart = `${depth * 1.1 + 0.35}rem`;
        const chevron = document.createElement("span");
        chevron.className = "project-tree-chevron";
        chevron.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.className = "project-tree-name";
        name.textContent = basename(entry.path);
        row.append(chevron, fileIcon(entry.kind), name);
        item.append(row);
        if (entry.kind === "directory") {
          const expanded = this.#expanded.has(entry.path);
          item.setAttribute("aria-expanded", String(expanded));
          chevron.textContent = expanded ? "▾" : "▸";
          const group = document.createElement("ul");
          group.setAttribute("role", "group");
          group.hidden = !expanded;
          group.append(...drawChildren(entry.path, depth + 1));
          item.append(group);
        }
        row.addEventListener("click", event => {
          if (this.#locked) return;
          this.#select(entry.path);
          if (entry.kind === "directory" && event.detail < 2) this.#toggle(entry.path);
        });
        row.addEventListener("dblclick", () => {
          if (!this.#locked && entry.kind === "file") this.#actions.open(entry.path);
        });
        item.addEventListener("keydown", event => {
          event.stopPropagation();
          this.#handleKey(event, entry);
        });
        item.addEventListener("focus", () => {
          this.#focused = entry.path;
          this.#updateSelection();
        });
        return item;
      });
    };
    this.#list.replaceChildren(...drawChildren("", 0));
    this.#empty.hidden = this.#entries.length !== 0;
    this.#updateSelection();
    this.element.scrollTop = scrollTop;
    if (restoreFocus) this.#focusItem(this.#focused);
  }

  #items(): HTMLElement[] {
    return [...this.#list.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  }

  #visibleItems(): HTMLElement[] {
    return this.#items().filter(item => !item.closest("[hidden]"));
  }

  #updateSelection(): void {
    const visible = this.#visibleItems();
    if (!visible.some(item => item.dataset.path === this.#focused)) {
      this.#focused = visible.find(item => item.dataset.path === this.#selected)?.dataset.path ?? visible[0]?.dataset.path ?? "";
    }
    for (const item of this.#items()) {
      item.setAttribute("aria-selected", String(item.dataset.path === this.#selected));
      item.tabIndex = !this.#locked && item.dataset.path === this.#focused ? 0 : -1;
    }
  }

  #focusItem(path: string): void {
    const item = this.#visibleItems().find(item => item.dataset.path === path);
    item?.focus({ preventScroll: true });
    item?.querySelector(".project-tree-row")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  #select(path: string): void {
    this.#selected = path;
    this.#focused = path;
    this.#updateSelection();
    this.#actions.select(path);
    this.#focusItem(path);
  }

  #toggle(path: string): void {
    if (this.#expanded.has(path)) this.#expanded.delete(path);
    else this.#expanded.add(path);
    this.#draw();
  }

  #handleKey(event: KeyboardEvent, entry: ProjectEntry): void {
    if (this.#locked || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = this.#visibleItems();
    const index = items.findIndex(item => item.dataset.path === entry.path);
    let target: string | undefined;
    switch (event.key) {
      case "ArrowDown": target = items[index + 1]?.dataset.path; break;
      case "ArrowUp": target = items[index - 1]?.dataset.path; break;
      case "Home": target = items[0]?.dataset.path; break;
      case "End": target = items.at(-1)?.dataset.path; break;
      case "ArrowRight":
        if (entry.kind === "directory") {
          if (!this.#expanded.has(entry.path)) this.#toggle(entry.path);
          else {
            const next = items[index + 1]?.dataset.path;
            if (next && parentPath(next) === entry.path) target = next;
          }
        }
        break;
      case "ArrowLeft":
        if (entry.kind === "directory" && this.#expanded.has(entry.path)) this.#toggle(entry.path);
        else target = parentPath(entry.path);
        break;
      case "Enter":
        if (entry.kind === "directory") this.#toggle(entry.path);
        else this.#actions.open(entry.path);
        break;
      case " ": this.#select(entry.path); break;
      default: return;
    }
    event.preventDefault();
    if (target) this.#select(target);
  }
}

function parentPath(path: string): string { return path.slice(0, Math.max(0, path.lastIndexOf("/"))); }
function basename(path: string): string { return path.split("/").at(-1)!; }

function fileIcon(kind: ProjectEntry["kind"]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("project-tree-icon", `project-tree-icon-${kind}`);
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", kind === "directory"
    ? "M2 5h6l2 2h8v10H2z M2 5V3h6l2 2h8v2"
    : "M4 2h8l4 4v12H4z M12 2v5h4 M7 11h6 M7 14h6");
  svg.append(path);
  return svg;
}
