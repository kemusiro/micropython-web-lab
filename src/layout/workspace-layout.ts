export const WORKSPACE_LAYOUT_STORAGE_KEY = "micropython-web-lab:workspace-layout:v1";

export interface WorkspaceLayoutState {
  columnRatio: number;
  editorRatio: number;
}

export interface WorkspaceLayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredWorkspaceLayout extends WorkspaceLayoutState {
  schemaVersion: 1;
}

interface WorkspaceLayoutElements {
  workspace: HTMLElement;
  explorerPanel?: HTMLElement;
  columnResizer: HTMLElement;
  rowResizer: HTMLElement;
  editorPanel: HTMLElement;
  terminalHeading: HTMLElement;
  terminalShell: HTMLElement;
  storage: WorkspaceLayoutStorage | null;
}

export const DEFAULT_WORKSPACE_LAYOUT: Readonly<WorkspaceLayoutState> = {
  columnRatio: 0.6,
  editorRatio: 0.75,
};

const COLUMN_RATIO_MIN = 0.4;
const COLUMN_RATIO_MAX = 0.78;
const EDITOR_RATIO_MIN = 0.45;
const EDITOR_RATIO_MAX = 0.85;
const COLUMN_KEYBOARD_STEP = 0.025;
const EDITOR_KEYBOARD_STEP = 0.035;
const MIN_LEFT_PANE_PX = 384;
const MIN_DEVICE_PANE_PX = 352;
const TERMINAL_TRACK_WEIGHT = 0.55;

export function loadWorkspaceLayout(
  storage: WorkspaceLayoutStorage | null,
): WorkspaceLayoutState {
  try {
    const value = storage?.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    if (value === null || value === undefined) {
      return { ...DEFAULT_WORKSPACE_LAYOUT };
    }
    const parsed: unknown = JSON.parse(value);
    if (!isStoredWorkspaceLayout(parsed)) {
      return { ...DEFAULT_WORKSPACE_LAYOUT };
    }
    return normalizeWorkspaceLayout(parsed);
  } catch {
    return { ...DEFAULT_WORKSPACE_LAYOUT };
  }
}

export function saveWorkspaceLayout(
  storage: WorkspaceLayoutStorage | null,
  state: WorkspaceLayoutState,
): void {
  const normalized = normalizeWorkspaceLayout(state);
  try {
    storage?.setItem(
      WORKSPACE_LAYOUT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, ...normalized } satisfies StoredWorkspaceLayout),
    );
  } catch {
    // The resized panes remain usable for this page even when storage is blocked.
  }
}

export function normalizeWorkspaceLayout(state: WorkspaceLayoutState): WorkspaceLayoutState {
  return {
    columnRatio: clampFinite(
      state.columnRatio,
      COLUMN_RATIO_MIN,
      COLUMN_RATIO_MAX,
      DEFAULT_WORKSPACE_LAYOUT.columnRatio,
    ),
    editorRatio: clampFinite(
      state.editorRatio,
      EDITOR_RATIO_MIN,
      EDITOR_RATIO_MAX,
      DEFAULT_WORKSPACE_LAYOUT.editorRatio,
    ),
  };
}

export function installWorkspaceResizers(elements: WorkspaceLayoutElements): () => void {
  let state = loadWorkspaceLayout(elements.storage);
  let activePointer: { axis: "column" | "row"; pointerId: number } | null = null;

  const paneSpace = (): { left: number; width: number; minimum: number; maximum: number } => {
    const box = elements.workspace.getBoundingClientRect();
    const explorerWidth = elements.explorerPanel?.getBoundingClientRect().width ?? 0;
    const width = Math.max(1, box.width - explorerWidth);
    const handleWidth = elements.columnResizer.getBoundingClientRect().width;
    const minimum = Math.min(COLUMN_RATIO_MAX, (explorerWidth > 0 ? 320 : MIN_LEFT_PANE_PX) / width);
    const maximum = Math.max(
      minimum,
      Math.min(
        COLUMN_RATIO_MAX,
        (width - (explorerWidth > 0 ? 288 : MIN_DEVICE_PANE_PX) - handleWidth) / width,
      ),
    );
    return { left: box.left + explorerWidth, width, minimum, maximum };
  };

  const render = (): void => {
    const space = paneSpace();
    const columnRatio = clamp(state.columnRatio, space.minimum, space.maximum);
    const editorWeight = (TERMINAL_TRACK_WEIGHT * state.editorRatio) / (1 - state.editorRatio);
    elements.workspace.style.setProperty("--workspace-left-pane", `${columnRatio * space.width}px`);
    elements.workspace.style.setProperty("--workspace-editor-weight", `${editorWeight}fr`);
    elements.columnResizer.setAttribute("aria-valuenow", String(Math.round(columnRatio * 100)));
    elements.rowResizer.setAttribute("aria-valuenow", String(Math.round(state.editorRatio * 100)));
  };

  const persist = (): void => saveWorkspaceLayout(elements.storage, state);

  const updateColumn = (clientX: number): void => {
    const space = paneSpace();
    state = {
      ...state,
      columnRatio: clamp((clientX - space.left) / space.width, space.minimum, space.maximum),
    };
    render();
  };

  const updateRow = (clientY: number): void => {
    const editorBox = elements.editorPanel.getBoundingClientRect();
    const headingBox = elements.terminalHeading.getBoundingClientRect();
    const terminalBox = elements.terminalShell.getBoundingClientRect();
    const handleHeight = elements.rowResizer.getBoundingClientRect().height;
    const flexibleHeight = terminalBox.bottom - editorBox.top - headingBox.height - handleHeight;
    if (flexibleHeight <= 0) {
      return;
    }
    state = {
      ...state,
      editorRatio: clamp(
        (clientY - editorBox.top - handleHeight / 2) / flexibleHeight,
        EDITOR_RATIO_MIN,
        EDITOR_RATIO_MAX,
      ),
    };
    render();
  };

  const finishPointer = (element: HTMLElement, pointerId: number): void => {
    if (activePointer?.pointerId !== pointerId) {
      return;
    }
    activePointer = null;
    delete elements.workspace.dataset.resizing;
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    persist();
  };

  const onColumnPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    activePointer = { axis: "column", pointerId: event.pointerId };
    elements.workspace.dataset.resizing = "column";
    elements.columnResizer.setPointerCapture(event.pointerId);
    updateColumn(event.clientX);
  };
  const onRowPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    activePointer = { axis: "row", pointerId: event.pointerId };
    elements.workspace.dataset.resizing = "row";
    elements.rowResizer.setPointerCapture(event.pointerId);
    updateRow(event.clientY);
  };
  const onColumnPointerMove = (event: PointerEvent): void => {
    if (activePointer?.axis === "column" && activePointer.pointerId === event.pointerId) {
      updateColumn(event.clientX);
    }
  };
  const onRowPointerMove = (event: PointerEvent): void => {
    if (activePointer?.axis === "row" && activePointer.pointerId === event.pointerId) {
      updateRow(event.clientY);
    }
  };
  const onColumnPointerEnd = (event: PointerEvent): void =>
    finishPointer(elements.columnResizer, event.pointerId);
  const onRowPointerEnd = (event: PointerEvent): void =>
    finishPointer(elements.rowResizer, event.pointerId);

  const onColumnKeyDown = (event: KeyboardEvent): void => {
    let nextRatio = state.columnRatio;
    if (event.key === "ArrowLeft") nextRatio -= COLUMN_KEYBOARD_STEP;
    else if (event.key === "ArrowRight") nextRatio += COLUMN_KEYBOARD_STEP;
    else if (event.key === "Home") nextRatio = COLUMN_RATIO_MIN;
    else if (event.key === "End") nextRatio = COLUMN_RATIO_MAX;
    else return;
    event.preventDefault();
    state = normalizeWorkspaceLayout({ ...state, columnRatio: nextRatio });
    render();
    persist();
  };

  const onRowKeyDown = (event: KeyboardEvent): void => {
    let nextRatio = state.editorRatio;
    if (event.key === "ArrowUp") nextRatio -= EDITOR_KEYBOARD_STEP;
    else if (event.key === "ArrowDown") nextRatio += EDITOR_KEYBOARD_STEP;
    else if (event.key === "Home") nextRatio = EDITOR_RATIO_MIN;
    else if (event.key === "End") nextRatio = EDITOR_RATIO_MAX;
    else return;
    event.preventDefault();
    state = normalizeWorkspaceLayout({ ...state, editorRatio: nextRatio });
    render();
    persist();
  };

  elements.columnResizer.addEventListener("pointerdown", onColumnPointerDown);
  elements.columnResizer.addEventListener("pointermove", onColumnPointerMove);
  elements.columnResizer.addEventListener("pointerup", onColumnPointerEnd);
  elements.columnResizer.addEventListener("pointercancel", onColumnPointerEnd);
  elements.rowResizer.addEventListener("pointerdown", onRowPointerDown);
  elements.rowResizer.addEventListener("pointermove", onRowPointerMove);
  elements.rowResizer.addEventListener("pointerup", onRowPointerEnd);
  elements.rowResizer.addEventListener("pointercancel", onRowPointerEnd);
  elements.columnResizer.addEventListener("keydown", onColumnKeyDown);
  elements.rowResizer.addEventListener("keydown", onRowKeyDown);

  const resizeObserver = new ResizeObserver(render);
  resizeObserver.observe(elements.workspace);
  if (elements.explorerPanel !== undefined) resizeObserver.observe(elements.explorerPanel);
  render();

  return () => {
    resizeObserver.disconnect();
    elements.columnResizer.removeEventListener("pointerdown", onColumnPointerDown);
    elements.columnResizer.removeEventListener("pointermove", onColumnPointerMove);
    elements.columnResizer.removeEventListener("pointerup", onColumnPointerEnd);
    elements.columnResizer.removeEventListener("pointercancel", onColumnPointerEnd);
    elements.rowResizer.removeEventListener("pointerdown", onRowPointerDown);
    elements.rowResizer.removeEventListener("pointermove", onRowPointerMove);
    elements.rowResizer.removeEventListener("pointerup", onRowPointerEnd);
    elements.rowResizer.removeEventListener("pointercancel", onRowPointerEnd);
    elements.columnResizer.removeEventListener("keydown", onColumnKeyDown);
    elements.rowResizer.removeEventListener("keydown", onRowKeyDown);
  };
}

function isStoredWorkspaceLayout(value: unknown): value is StoredWorkspaceLayout {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StoredWorkspaceLayout>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.columnRatio === "number" &&
    Number.isFinite(candidate.columnRatio) &&
    typeof candidate.editorRatio === "number" &&
    Number.isFinite(candidate.editorRatio)
  );
}

function clampFinite(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
