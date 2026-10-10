/** Page-local presentation state, independent of saved projects and pane ratios. */
type WorkspaceView = "normal" | "editor" | "repl";

interface WorkspaceViewElements {
  workspace: HTMLElement;
  editorPanel: HTMLElement;
  editorCodeArea: HTMLElement;
  toolbar: HTMLElement;
  rowResizer: HTMLElement;
  terminalHeading: HTMLElement;
  terminalShell: HTMLElement;
  debuggerForm: HTMLElement;
  inputForm: HTMLElement;
  viewButtons: readonly HTMLButtonElement[];
}

export function installWorkspaceViews(elements: WorkspaceViewElements): { reset(): void; dispose(): void } {
  let view: WorkspaceView = "normal";
  const editorControls = Array.from(elements.editorPanel.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !child.contains(elements.editorCodeArea),
  );

  const updateMinimumHeight = (): void => {
    if (!window.matchMedia("(min-width: 960px)").matches) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const height = (element: HTMLElement): number => element.getBoundingClientRect().height;
    let editorMinimum = 0;
    if (view !== "repl") {
      const style = getComputedStyle(elements.editorPanel);
      const chrome =
        editorControls.reduce((total, control) => total + height(control), 0) +
        parseFloat(style.rowGap) * editorControls.length +
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      // Match the 16rem code area and 11rem terminal minimums in styles.css.
      editorMinimum = Math.ceil(chrome + 16 * rem);
      elements.workspace.style.setProperty("--workspace-editor-min-height", `${editorMinimum}px`);
    }
    const terminalMinimum =
      view === "editor"
        ? 0
        : height(elements.terminalHeading) + 11 * rem +
          height(elements.debuggerForm) + height(elements.inputForm);
    const minimum = Math.ceil(
      height(elements.toolbar) + editorMinimum + terminalMinimum +
      (view === "normal" ? height(elements.rowResizer) : 0) + 2,
    );
    elements.workspace.style.setProperty("--workspace-min-height", `${minimum}px`);
  };

  const onViewClick = (event: MouseEvent): void => {
    const button = event.currentTarget as HTMLButtonElement;
    const nextView = button.dataset.workspaceViewButton;
    if (nextView !== "normal" && nextView !== "editor" && nextView !== "repl") return;
    setView(nextView);
    // Bring the new view into sight after changing from a scrolled, taller layout.
    elements.workspace.scrollIntoView({ block: "start" });
  };

  const setView = (nextView: WorkspaceView): void => {
    view = nextView;
    elements.workspace.dataset.workspaceView = view;
    for (const control of elements.viewButtons) {
      control.setAttribute("aria-pressed", String(control.dataset.workspaceViewButton === view));
    }
    updateMinimumHeight();
  };

  // Switching screens changes several observed controls at once. Measure on the
  // next frame instead of resizing an observed element during observer delivery.
  let resizeFrame: number | null = null;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      updateMinimumHeight();
    });
  });
  for (const element of [
    elements.workspace,
    elements.toolbar,
    elements.terminalHeading,
    elements.debuggerForm,
    elements.inputForm,
    ...editorControls,
  ]) {
    resizeObserver.observe(element);
  }
  for (const button of elements.viewButtons) button.addEventListener("click", onViewClick);
  elements.workspace.dataset.workspaceView = view;
  updateMinimumHeight();

  return {
    reset: () => setView("normal"),
    dispose: () => {
      resizeObserver.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      for (const button of elements.viewButtons) button.removeEventListener("click", onViewClick);
    },
  };
}
