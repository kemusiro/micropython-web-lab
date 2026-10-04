import "./styles.css";

import { createOptionalContentIntegration } from "virtual:optional-content-integration";
import {
  clearEditorWorkspace,
  loadEditorWorkspace,
  MAX_EDITOR_TABS,
  saveEditorWorkspace,
  type DraftStorage,
  type EditorWorkspaceTab,
} from "./project/editor-draft";
import {
  loadConnectionProject,
  saveConnectionProject,
} from "./project/connection-project";
import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "./board/raspberry-pi-pico-2-w";
import { ConnectionEditor, type ConnectionEditorApplyResult } from "./connections/connection-editor";
import { resolveConnectionGraph, type ConnectionGraphV1 } from "./connections/connection-model";
import { MANAGED_CONNECTION_GRAPH } from "./connections/managed-connection-graph";
import { createManagedDeviceDefinitions } from "./connections/connection-presets";
import { localDeviceMetadata } from "virtual:local-device-metadata";
import type { DeviceAction } from "./device-api/types";
import { DeviceUiRenderer } from "./device-ui/device-ui-renderer";
import {
  referenceDeviceUisForConnectionGraph,
  referenceDeviceUisForLocale,
} from "./device-ui/reference-device-ui";
import { deviceExampleSource, hasDeviceExample } from "./examples/device-examples";
import { scenarioExampleSource } from "./examples/scenario-examples";
import { changeEditorIndentation } from "./editor/indentation";
import { RuntimeClient } from "./runtime/client";
import {
  applyDocumentTranslations,
  isSupportedLocale,
  loadLocale,
  localeTag,
  saveLocale,
  t,
} from "./i18n/i18n";
import { SharedDebuggerChannel } from "./runtime/debugger-channel";
import {
  MAX_SCRIPT_CHARACTERS,
  type DebuggerVariable,
  type ScriptExecutionMode,
  type RuntimeDeviceState,
  type RuntimeStatus,
  type WorkerToMainMessage,
} from "./runtime/protocol";
import { terminateReplInput } from "./runtime/repl-input";
import { isInterruptShortcut, terminalSequenceForKey } from "./runtime/terminal-key-input";
import { TerminalScreen } from "./runtime/terminal-screen";
import { installWorkspaceResizers } from "./layout/workspace-layout";
import {
  ANALOG_VALUE_INPUT_ID,
  BME280_HUMIDITY_INPUT_ID,
  BME280_PRESSURE_INPUT_ID,
  BME280_TEMPERATURE_INPUT_ID,
  BUTTON_PRESSED_INPUT_ID,
  GT_502MGG_ALTITUDE_CM_INPUT_ID,
  GT_502MGG_GENERATE_INPUT_ID,
  GT_502MGG_LATITUDE_E7_INPUT_ID,
  GT_502MGG_LONGITUDE_E7_INPUT_ID,
  SharedDeviceInputs,
  UART_RECEIVE_INPUT_ID,
  WEB_LAB_DEVICE_INPUT_LAYOUT,
} from "./simulation/shared-device-inputs";

const MAX_TERMINAL_CHARACTERS = 200_000;
const AUTOSAVE_DELAY_MS = 400;

const browserStorage = getBrowserStorage();
const uiLocale = loadLocale(browserStorage, navigator.languages);
applyDocumentTranslations(document, uiLocale);

const terminal = requiredElement<HTMLPreElement>("terminal");
const terminalText = requiredElement<HTMLSpanElement>("terminal-text");
const terminalTextAfterCursor = requiredElement<HTMLSpanElement>("terminal-text-after-cursor");
const terminalShell = requiredElement<HTMLDivElement>("terminal-shell");
const terminalDirectInput = requiredElement<HTMLTextAreaElement>("terminal-direct-input");
const workspace = requiredElement<HTMLElement>("workspace");
const workspaceColumnResizer = requiredElement<HTMLElement>("workspace-column-resizer");
const workspaceRowResizer = requiredElement<HTMLElement>("workspace-row-resizer");
const terminalHeading = requiredElement<HTMLElement>("terminal-heading");
const debuggerCommandForm = requiredElement<HTMLFormElement>("debugger-command-form");
const debuggerCommandInput = requiredElement<HTMLInputElement>("debugger-command-input");
const inputForm = requiredElement<HTMLFormElement>("input-form");
const replInput = requiredElement<HTMLTextAreaElement>("repl-input");
const scriptForm = requiredElement<HTMLFormElement>("script-form");
const codeEditor = requiredElement<HTMLTextAreaElement>("code-editor");
const editorTabsElement = requiredElement<HTMLDivElement>("editor-tabs");
const editorDebugWorkspace = requiredElement<HTMLDivElement>("editor-debug-workspace");
const debugCurrentLine = requiredElement<HTMLDivElement>("debug-current-line");
const debugVariablePanel = requiredElement<HTMLElement>("debug-variable-panel");
const debugVariableList = requiredElement<HTMLDivElement>("debug-variable-list");
const debuggerLocation = requiredElement<HTMLSpanElement>("debugger-location");
const saveDraftButton = requiredElement<HTMLButtonElement>("save-draft-button");
const resetDraftButton = requiredElement<HTMLButtonElement>("reset-draft-button");
const draftStatus = requiredElement<HTMLSpanElement>("draft-status");
const restartButton = requiredElement<HTMLButtonElement>("restart-button");
const stopButton = requiredElement<HTMLButtonElement>("stop-button");
const clearButton = requiredElement<HTMLButtonElement>("clear-button");
const sendButton = requiredElement<HTMLButtonElement>("send-button");
const runScriptButton = requiredElement<HTMLButtonElement>("run-script-button");
const debugScriptButton = requiredElement<HTMLButtonElement>("debug-script-button");
const languageSelect = requiredElement<HTMLSelectElement>("language-select");
const statusIndicator = requiredElement<HTMLSpanElement>("status-indicator");
const runtimeStatus = requiredElement<HTMLSpanElement>("runtime-status");
const runtimeVersion = requiredElement<HTMLElement>("runtime-version");
const deviceUiRoot = requiredElement<HTMLDivElement>("device-ui-root");
const connectionEditorRoot = requiredElement<HTMLDivElement>("connection-editor-root");
const deviceUiInputStatus = requiredElement<HTMLParagraphElement>("device-ui-input-status");
const localDeviceBanner = requiredElement<HTMLElement>("local-device-banner");
const localDeviceName = requiredElement<HTMLSpanElement>("local-device-name");
const examplesSection = requiredElement<HTMLElement>("examples-title").closest<HTMLElement>(
  ".examples",
);
if (examplesSection === null) {
  throw new Error("Required .examples section was not found.");
}

installWorkspaceResizers({
  workspace,
  columnResizer: workspaceColumnResizer,
  rowResizer: workspaceRowResizer,
  editorPanel: scriptForm,
  terminalHeading,
  terminalShell,
  storage: browserStorage,
});

if (__WEB_LAB_LOCAL_MODE__) {
  const instances = localDeviceMetadata?.instances ?? [];
  localDeviceName.textContent =
    instances.length === 1
      ? `${instances[0]!.name}（${instances[0]!.deviceId}）`
      : t("local.summary", {
          instances: instances.length,
          sources: localDeviceMetadata?.sourceCount ?? 0,
          names: instances
            .map((instance) =>
              uiLocale === "ja"
                ? `${instance.name}（${instance.instanceId}）`
                : `${instance.name} (${instance.instanceId})`,
            )
            .join(uiLocale === "ja" ? "、" : ", "),
        });
  localDeviceBanner.hidden = false;
}

const terminalScreen = new TerminalScreen();
let terminalFrame: number | null = null;
let terminalInputComposing = false;
let replExecutionPending = false;
let autosaveTimer: number | null = null;
let activeDebuggerLine: number | null = null;
const lastDeviceSequences = new Map<string, number>();
const initialScript = codeEditor.value;
let editorTabs: EditorWorkspaceTab[] = [
  { id: "main", title: "main.py", source: initialScript },
];
let activeEditorTabId = "main";
let editorTabSequence = 0;
const optionalContentIntegration = createOptionalContentIntegration({
  mountBefore: examplesSection,
  openEditorTab,
});
const draftStorage = browserStorage;
const referenceDeviceUis = referenceDeviceUisForLocale(uiLocale);
const sharedDeviceInputs = window.crossOriginIsolated
  ? SharedDeviceInputs.create(WEB_LAB_DEVICE_INPUT_LAYOUT)
  : null;
const sharedDebuggerChannel = window.crossOriginIsolated
  ? SharedDebuggerChannel.create()
  : null;
const managedDeviceDefinitions = createManagedDeviceDefinitions();
const initialConnection = loadInitialConnectionGraph();
let activeConnectionGraph = initialConnection.graph;
const deviceUiRenderer = new DeviceUiRenderer(
  deviceUiRoot,
  deviceUiEntries(activeConnectionGraph),
  handleDeviceUiAction,
  sharedDeviceInputs !== null,
  {
    exampleInstanceIds: new Set(
      referenceDeviceUis
        .map((entry) => entry.instanceId)
        .filter((instanceId) => hasDeviceExample(instanceId)),
    ),
    orderStorage: browserStorage,
    openExample: openDeviceExample,
  },
);
deviceUiInputStatus.textContent =
  sharedDeviceInputs === null
    ? t("device.inputUnavailable")
    : t("device.inputAvailable");
deviceUiInputStatus.dataset.state = sharedDeviceInputs === null ? "unavailable" : "available";

const runtime = new RuntimeClient(
  {
    onMessage: handleRuntimeMessage,
    onStatus: updateRuntimeStatus,
  },
  undefined,
  {
    deviceInputs: sharedDeviceInputs?.toTransfer(),
    debuggerChannel: sharedDebuggerChannel ?? undefined,
    ...(localDeviceMetadata === null ? { connectionGraph: activeConnectionGraph } : {}),
  },
);

new ConnectionEditor(connectionEditorRoot, {
  defaultGraph: localDeviceMetadata?.connectionGraph ?? MANAGED_CONNECTION_GRAPH,
  initialGraph: activeConnectionGraph,
  board: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
  deviceNames: connectionDeviceNames(),
  readOnly: localDeviceMetadata !== null,
  initialMessage: initialConnection.message,
  validate: validateEditedConnectionGraph,
  apply: applyEditedConnectionGraph,
});

window.addEventListener(
  "keydown",
  (event) => {
    if (
      !isInterruptShortcut(event) ||
      (!replExecutionPending &&
        runtime.status !== "executing" &&
        runtime.status !== "debugging")
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    forceKeyboardInterrupt();
  },
  { capture: true },
);

inputForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendCurrentInput();
});

terminalShell.addEventListener("click", () => {
  if (runtime.status === "debugging") {
    debuggerCommandInput.focus({ preventScroll: true });
  } else if (!terminalDirectInput.disabled) {
    terminalDirectInput.focus({ preventScroll: true });
  }
});

terminalDirectInput.addEventListener("keydown", (event) => {
  if (event.isComposing) {
    return;
  }
  const sequence = terminalSequenceForKey(event);
  if (sequence === null) {
    return;
  }
  event.preventDefault();
  sendDirectTerminalInput(sequence);
});

terminalDirectInput.addEventListener("input", (event) => {
  if (
    terminalInputComposing ||
    (event as InputEvent).isComposing
  ) {
    return;
  }
  flushDirectTerminalInput();
});

terminalDirectInput.addEventListener("compositionstart", () => {
  terminalInputComposing = true;
});

terminalDirectInput.addEventListener("compositionend", () => {
  terminalInputComposing = false;
  flushDirectTerminalInput();
});

debuggerCommandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendDebuggerCommand();
});

debuggerCommandForm.addEventListener("click", (event) => {
  if (!(event.target instanceof HTMLButtonElement)) {
    return;
  }
  const command = event.target.dataset.debuggerCommand;
  if (command !== undefined) {
    sendDebuggerCommand(command);
  }
});

scriptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runCurrentScript("run");
});

debugScriptButton.addEventListener("click", () => {
  runCurrentScript("debug");
});

codeEditor.maxLength = MAX_SCRIPT_CHARACTERS;
replInput.maxLength = MAX_SCRIPT_CHARACTERS;
terminalDirectInput.maxLength = MAX_SCRIPT_CHARACTERS;
restoreEditorWorkspace();
languageSelect.value = uiLocale;
languageSelect.addEventListener("change", () => {
  const selectedLocale = languageSelect.value;
  if (!isSupportedLocale(selectedLocale) || selectedLocale === uiLocale) {
    return;
  }
  if (autosaveTimer !== null) {
    cancelScheduledDraftSave();
    saveCurrentDraft();
  }
  saveLocale(browserStorage, selectedLocale);
  window.location.reload();
});
codeEditor.addEventListener("input", () => {
  updateActiveEditorTabSource(codeEditor.value);
  scheduleDraftSave();
  optionalContentIntegration.editorChanged(codeEditor.value);
});
codeEditor.addEventListener("scroll", updateDebuggerLineMarker);
codeEditor.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && !codeEditor.readOnly) {
    event.preventDefault();
    const selectionDirection = codeEditor.selectionDirection;
    const result = changeEditorIndentation(
      codeEditor.value,
      codeEditor.selectionStart,
      codeEditor.selectionEnd,
      event.shiftKey ? "outdent" : "indent",
    );
    if (!result.changed || result.value.length > MAX_SCRIPT_CHARACTERS) {
      return;
    }
    codeEditor.value = result.value;
    codeEditor.setSelectionRange(
      result.selectionStart,
      result.selectionEnd,
      selectionDirection,
    );
    codeEditor.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    runCurrentScript("run");
  }
});

saveDraftButton.addEventListener("click", () => {
  cancelScheduledDraftSave();
  saveCurrentDraft();
});

resetDraftButton.addEventListener("click", () => {
  const confirmed = window.confirm(t("draft.resetConfirm"));
  if (!confirmed) {
    return;
  }

  cancelScheduledDraftSave();
  if (draftStorage === null) {
    setDraftStatus(t("draft.unavailable"), "error");
    return;
  }

  const result = clearEditorWorkspace(draftStorage);
  if (!result.ok) {
    setDraftStatus(result.message, "error");
    return;
  }

  editorTabs = [{ id: "main", title: "main.py", source: initialScript }];
  activeEditorTabId = "main";
  codeEditor.value = initialScript;
  renderEditorTabs();
  optionalContentIntegration.editorChanged(codeEditor.value);
  setDraftStatus(t("draft.initial"), "idle");
  codeEditor.focus();
});

window.addEventListener("pagehide", () => {
  if (autosaveTimer !== null) {
    cancelScheduledDraftSave();
    saveCurrentDraft();
  }
});

replInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    sendCurrentInput();
  }
});

restartButton.addEventListener("click", () => {
  appendTerminal(t("system.restarting"));
  runtime.restart();
});

stopButton.addEventListener("click", () => {
  runtime.stop();
  appendTerminal(t("system.stopped"));
});

clearButton.addEventListener("click", () => {
  terminalScreen.clear();
  renderTerminal();
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-scenario-example]")) {
  button.addEventListener("click", () => {
    const source = scenarioExampleSource(button.dataset.scenarioExample ?? "", {
      buttonPin: connectedGpioNumber(activeConnectionGraph, "button-gp15", "input", 15),
    });
    if (source === null) {
      return;
    }
    const title = button.closest<HTMLElement>(".scenario-example-card")
      ?.querySelector<HTMLElement>("h3")
      ?.textContent?.trim();
    openEditorTab(title || t("editor.untitled"), source);
  });
}

runtime.start();
void optionalContentIntegration.initialize();

function loadInitialConnectionGraph(): {
  graph: ConnectionGraphV1;
  message: string;
} {
  if (localDeviceMetadata !== null) {
    return {
      graph: localDeviceMetadata.connectionGraph,
      message: t("connection.initialLocal"),
    };
  }
  if (draftStorage === null) {
    return {
      graph: MANAGED_CONNECTION_GRAPH,
      message: t("connection.storageUnavailable"),
    };
  }
  const loaded = loadConnectionProject(draftStorage);
  if (loaded.status === "empty") {
    return { graph: MANAGED_CONNECTION_GRAPH, message: t("connection.managed") };
  }
  if (loaded.status !== "loaded") {
    return {
      graph: MANAGED_CONNECTION_GRAPH,
      message: t("connection.loadFallback", { error: loaded.message }),
    };
  }
  const validationError = validateEditedConnectionGraph(loaded.project.graph);
  if (validationError !== null) {
    return {
      graph: MANAGED_CONNECTION_GRAPH,
      message: t("connection.invalidStored", { error: validationError }),
    };
  }
  return {
    graph: loaded.project.graph,
    message: t("connection.restored", { time: formatSavedAt(loaded.project.savedAt) }),
  };
}

function connectionDeviceNames(): ReadonlyMap<string, string> {
  const names = new Map(
    referenceDeviceUis.map((entry) => [entry.instanceId, entry.definition.title]),
  );
  for (const instance of localDeviceMetadata?.instances ?? []) {
    names.set(instance.instanceId, instance.name);
  }
  return names;
}

function deviceUiEntries(graph: ConnectionGraphV1): typeof referenceDeviceUis {
  return referenceDeviceUisForConnectionGraph(graph, uiLocale);
}

function connectedGpioNumber(
  graph: ConnectionGraphV1,
  instanceId: string,
  portId: string,
  fallback: number,
): number {
  const endpoint = graph.devices
    .find((device) => device.instanceId === instanceId)
    ?.ports.find((port) => port.portId === portId)?.endpoint;
  if (endpoint?.kind !== "gpio") {
    return fallback;
  }
  const match = /^GP(\d+)$/.exec(endpoint.pin);
  return match === null ? fallback : Number(match[1]);
}

function validateEditedConnectionGraph(graph: ConnectionGraphV1): string | null {
  if (localDeviceMetadata !== null) {
    return null;
  }
  try {
    resolveConnectionGraph(
      graph,
      RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
      managedDeviceDefinitions,
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function applyEditedConnectionGraph(graph: ConnectionGraphV1): ConnectionEditorApplyResult {
  const validationError = validateEditedConnectionGraph(graph);
  if (validationError !== null) {
    return { ok: false, message: validationError };
  }
  if (draftStorage === null) {
    return { ok: false, message: t("connection.saveUnavailable") };
  }
  const saved = saveConnectionProject(draftStorage, graph);
  if (!saved.ok) {
    return saved;
  }
  activeConnectionGraph = graph;
  lastDeviceSequences.clear();
  deviceUiRenderer.replace(deviceUiEntries(graph));
  runtime.setConnectionGraph(graph);
  appendTerminal(t("connection.appliedTerminal"));
  runtime.restart();
  return { ok: true, message: t("connection.applied") };
}

function sendCurrentInput(): void {
  const input = replInput.value;
  if (input.trim().length === 0) {
    return;
  }

  const accepted = runtime.sendInput(terminateReplInput(input));
  if (!accepted) {
    appendTerminal(t("system.inputUnavailable"));
    return;
  }

  replExecutionPending = true;
  replInput.value = "";
}

function flushDirectTerminalInput(): void {
  const data = terminalDirectInput.value;
  terminalDirectInput.value = "";
  if (data.length > 0) {
    sendDirectTerminalInput(data);
  }
}

function sendDirectTerminalInput(data: string): void {
  const accepted = runtime.sendInput(data);
  if (!accepted) {
    appendTerminal(t("system.directInputUnavailable"));
    return;
  }
  if (data.includes("\r") || data.includes("\n") || data.includes("\x04")) {
    replExecutionPending = true;
  }
}

function sendDebuggerCommand(selectedCommand?: string): void {
  const commandFromInput = selectedCommand === undefined;
  const command = selectedCommand ?? debuggerCommandInput.value;
  let accepted: boolean;
  try {
    accepted = runtime.sendDebuggerCommand(command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendTerminal(t("system.debuggerCommandError", { message }));
    return;
  }
  if (!accepted) {
    appendTerminal(t("system.debuggerWait"));
    return;
  }
  if (commandFromInput) {
    debuggerCommandInput.value = "";
  }
  appendTerminal(`${command}\n`);
  if (/^(?:q|quit|exit)$/i.test(command.trim())) {
    appendTerminal(t("system.debuggerQuit"));
  }
}

function forceKeyboardInterrupt(): void {
  replExecutionPending = false;
  appendTerminal(t("system.interrupt"));
  runtime.restart();
}

function runCurrentScript(mode: ScriptExecutionMode): void {
  const source = codeEditor.value;
  if (source.trim().length === 0) {
    appendTerminal(t("system.enterCode"));
    return;
  }

  if (mode === "debug" && sharedDebuggerChannel === null) {
    appendTerminal(t("system.debugIsolation"));
    return;
  }

  const accepted = runtime.executeScript(source, mode);
  if (!accepted) {
    appendTerminal(t("system.waitReady"));
    return;
  }

  optionalContentIntegration.executionStarted(source, mode);
  appendTerminal(
    mode === "debug" ? t("system.debugStarted") : t("system.runStarted"),
  );
}

function restoreEditorWorkspace(): void {
  if (draftStorage === null) {
    setDraftStatus(t("draft.unavailable"), "error");
    renderEditorTabs();
    return;
  }

  const result = loadEditorWorkspace(draftStorage);
  switch (result.status) {
    case "empty":
      setDraftStatus(t("draft.initial"), "idle");
      break;
    case "loaded":
      editorTabs = result.workspace.tabs.map((tab) => ({ ...tab }));
      activeEditorTabId = result.workspace.activeTabId;
      codeEditor.value = activeEditorTab().source;
      setDraftStatus(
        t("draft.restored", { time: formatSavedAt(result.workspace.savedAt) }),
        "saved",
      );
      break;
    case "invalid":
    case "unavailable":
      setDraftStatus(result.message, "error");
      break;
  }
  renderEditorTabs();
}

function scheduleDraftSave(): void {
  cancelScheduledDraftSave();
  setDraftStatus(t("draft.pending"), "pending");
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    saveCurrentDraft();
  }, AUTOSAVE_DELAY_MS);
}

function cancelScheduledDraftSave(): void {
  if (autosaveTimer === null) {
    return;
  }
  window.clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

function saveCurrentDraft(): void {
  if (draftStorage === null) {
    setDraftStatus(t("draft.unavailable"), "error");
    return;
  }

  updateActiveEditorTabSource(codeEditor.value);
  const result = saveEditorWorkspace(draftStorage, editorTabs, activeEditorTabId);
  if (!result.ok || result.workspace === undefined) {
    setDraftStatus(result.ok ? t("draft.unknownResult") : result.message, "error");
    return;
  }

  setDraftStatus(t("draft.saved", { time: formatSavedAt(result.workspace.savedAt) }), "saved");
}

function activeEditorTab(): EditorWorkspaceTab {
  return editorTabs.find((tab) => tab.id === activeEditorTabId) ?? editorTabs[0]!;
}

function updateActiveEditorTabSource(source: string): void {
  const index = editorTabs.findIndex((tab) => tab.id === activeEditorTabId);
  if (index < 0) {
    return;
  }
  editorTabs[index] = { ...editorTabs[index]!, source };
}

function renderEditorTabs(): void {
  const locked = codeEditor.readOnly;
  const elements: HTMLElement[] = editorTabs.map((tab) => {
    const item = document.createElement("div");
    item.className = "editor-tab";
    item.dataset.active = String(tab.id === activeEditorTabId);

    const select = document.createElement("button");
    select.type = "button";
    select.className = "editor-tab-select";
    select.dataset.editorTab = tab.id;
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(tab.id === activeEditorTabId));
    select.textContent = tab.title;
    select.title = tab.title;
    select.disabled = locked;
    select.addEventListener("click", () => selectEditorTab(tab.id));

    const close = document.createElement("button");
    close.type = "button";
    close.className = "editor-tab-close";
    close.dataset.closeEditorTab = tab.id;
    close.textContent = "×";
    close.setAttribute("aria-label", t("editor.closeTab", { title: tab.title }));
    close.disabled = locked || editorTabs.length === 1;
    close.addEventListener("click", () => closeEditorTab(tab.id));
    item.append(select, close);
    return item;
  });

  const add = document.createElement("button");
  add.type = "button";
  add.className = "editor-tab-new";
  add.textContent = "+";
  add.title = t("editor.newTab");
  add.setAttribute("aria-label", t("editor.newTab"));
  add.disabled = locked || editorTabs.length >= MAX_EDITOR_TABS;
  add.addEventListener("click", () => openEditorTab(t("editor.untitled"), ""));
  elements.push(add);
  editorTabsElement.replaceChildren(...elements);
}

function selectEditorTab(tabId: string): void {
  if (codeEditor.readOnly || tabId === activeEditorTabId) {
    return;
  }
  const tab = editorTabs.find((candidate) => candidate.id === tabId);
  if (tab === undefined) {
    return;
  }
  updateActiveEditorTabSource(codeEditor.value);
  activeEditorTabId = tab.id;
  codeEditor.value = tab.source;
  codeEditor.scrollTop = 0;
  optionalContentIntegration.editorChanged(codeEditor.value);
  renderEditorTabs();
  scheduleDraftSave();
  codeEditor.focus();
}

function openEditorTab(title: string, source: string): void {
  if (codeEditor.readOnly) {
    return;
  }
  if (editorTabs.length >= MAX_EDITOR_TABS) {
    setDraftStatus(t("editor.tabLimit", { count: MAX_EDITOR_TABS }), "error");
    return;
  }
  updateActiveEditorTabSource(codeEditor.value);
  editorTabSequence += 1;
  const id = `tab-${Date.now().toString(36)}-${editorTabSequence.toString(36)}`;
  editorTabs.push({ id, title: title.slice(0, 80), source });
  activeEditorTabId = id;
  codeEditor.value = source;
  codeEditor.scrollTop = 0;
  optionalContentIntegration.editorChanged(codeEditor.value);
  renderEditorTabs();
  scheduleDraftSave();
  codeEditor.focus();
}

function closeEditorTab(tabId: string): void {
  if (codeEditor.readOnly || editorTabs.length === 1) {
    return;
  }
  updateActiveEditorTabSource(codeEditor.value);
  const index = editorTabs.findIndex((tab) => tab.id === tabId);
  const tab = editorTabs[index];
  if (tab === undefined) {
    return;
  }
  if (tab.source.trim().length > 0 && !window.confirm(t("editor.closeTabConfirm", { title: tab.title }))) {
    return;
  }
  editorTabs.splice(index, 1);
  if (activeEditorTabId === tabId) {
    const next = editorTabs[Math.min(index, editorTabs.length - 1)]!;
    activeEditorTabId = next.id;
    codeEditor.value = next.source;
    codeEditor.scrollTop = 0;
    optionalContentIntegration.editorChanged(codeEditor.value);
  }
  renderEditorTabs();
  scheduleDraftSave();
  codeEditor.focus();
}

function openDeviceExample(instanceId: string): void {
  const source = deviceExampleSource(instanceId, {
    buttonPin: connectedGpioNumber(activeConnectionGraph, "button-gp15", "input", 15),
  });
  const entry = referenceDeviceUis.find((candidate) => candidate.instanceId === instanceId);
  if (source === null || entry === undefined) {
    return;
  }
  openEditorTab(t("editor.sampleTitle", { device: entry.definition.title }), source);
}

function setDraftStatus(message: string, state: "idle" | "pending" | "saved" | "error"): void {
  draftStatus.textContent = message;
  draftStatus.dataset.state = state;
}

function formatSavedAt(savedAt: string): string {
  return new Intl.DateTimeFormat(localeTag(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(savedAt));
}

function getBrowserStorage(): DraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function handleRuntimeMessage(message: WorkerToMainMessage): void {
  switch (message.type) {
    case "ready":
      replExecutionPending = false;
      runtimeVersion.textContent = `${compactVersion(message.micropythonVersion)} · restricted · ${message.runtimeBuild.sourceCommit.slice(0, 7)}`;
      break;
    case "repl-reset":
      appendTerminal(t("system.softReset"));
      break;
    case "stdout":
      optionalContentIntegration.stdout(message.data);
      appendTerminal(message.data);
      break;
    case "stderr":
      appendTerminal(message.data);
      break;
    case "error":
      appendTerminal(`\n[runtime error] ${message.message}\n`);
      break;
    case "execution-result":
      optionalContentIntegration.executionFinished(message.ok);
      if (message.ok) {
        appendTerminal(t("system.runComplete"));
      } else {
        appendTerminal(`\n[script error] ${message.error ?? t("system.unknownError")}\n`);
      }
      break;
    case "debugger-paused":
      renderDebuggerPause(message);
      break;
    case "debugger-resumed":
      clearDebuggerWorkspace();
      break;
    case "device-state":
      renderDeviceState(message.state);
      break;
    case "device-model-state":
      deviceUiRenderer.update(message.event);
      break;
  }
}

function handleDeviceUiAction(instanceId: string, action: DeviceAction): void {
  if (sharedDeviceInputs === null) {
    throw new Error(t("device.requiresIsolation"));
  }
  if (
    instanceId === "button-gp15" &&
    action.controlId === "pressed" &&
    typeof action.value === "boolean"
  ) {
    sharedDeviceInputs.setScalar(BUTTON_PRESSED_INPUT_ID, action.value ? 1 : 0);
    return;
  }
  if (
    instanceId === "analog-gp26" &&
    action.controlId === "value" &&
    typeof action.value === "number"
  ) {
    sharedDeviceInputs.setScalar(ANALOG_VALUE_INPUT_ID, action.value);
    return;
  }
  if (
    instanceId === "gt-502mgg-n" &&
    action.controlId === "rawReceiveText" &&
    typeof action.value === "string"
  ) {
    sharedDeviceInputs.enqueue(UART_RECEIVE_INPUT_ID, new TextEncoder().encode(action.value));
    return;
  }
  if (
    instanceId === "gt-502mgg-n" &&
    action.controlId === "positionText" &&
    typeof action.value === "string"
  ) {
    const fields = action.value.split(",").map((field) => field.trim());
    if (fields.length !== 3 || fields.some((field) => field.length === 0)) {
      throw new TypeError(t("device.positionFormat"));
    }
    const [latitude, longitude, altitude] = fields.map(Number) as [number, number, number];
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new RangeError(t("device.latitudeRange"));
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new RangeError(t("device.longitudeRange"));
    }
    if (!Number.isFinite(altitude) || altitude < -1_000 || altitude > 20_000) {
      throw new RangeError(t("device.altitudeRange"));
    }
    sharedDeviceInputs.setScalar(
      GT_502MGG_LATITUDE_E7_INPUT_ID,
      Math.round(latitude * 10_000_000),
    );
    sharedDeviceInputs.setScalar(
      GT_502MGG_LONGITUDE_E7_INPUT_ID,
      Math.round(longitude * 10_000_000),
    );
    sharedDeviceInputs.setScalar(
      GT_502MGG_ALTITUDE_CM_INPUT_ID,
      Math.round(altitude * 100),
    );
    sharedDeviceInputs.setScalar(GT_502MGG_GENERATE_INPUT_ID, 1);
    return;
  }
  if (instanceId === "ae-bme280-0x76" && typeof action.value === "number") {
    const inputIds: Readonly<Record<string, string>> = {
      temperatureC: BME280_TEMPERATURE_INPUT_ID,
      humidityPercent: BME280_HUMIDITY_INPUT_ID,
      pressureHpa: BME280_PRESSURE_INPUT_ID,
    };
    const inputId = inputIds[action.controlId];
    if (inputId !== undefined) {
      sharedDeviceInputs.setScalar(inputId, action.value);
      return;
    }
  }
  throw new Error(
    t("device.unsupportedAction", { action: `${instanceId}.${action.controlId}` }),
  );
}

function renderDeviceState(state: RuntimeDeviceState): void {
  if (state.kind !== "gpio-pin") {
    return;
  }
  const sequenceKey = "gpio-board";
  if (state.sequence <= (lastDeviceSequences.get(sequenceKey) ?? 0)) {
    return;
  }
  lastDeviceSequences.set(sequenceKey, state.sequence);
  optionalContentIntegration.deviceState(state);
}

function resetVirtualBoardState(): void {
  lastDeviceSequences.clear();
  sharedDeviceInputs?.setScalar(BUTTON_PRESSED_INPUT_ID, 0);
}

function renderDebuggerPause(
  message: Extract<WorkerToMainMessage, { type: "debugger-paused" }>,
): void {
  activeDebuggerLine = message.line;
  editorDebugWorkspace.dataset.debugging = "true";
  debugVariablePanel.hidden = false;
  debuggerLocation.textContent = t("debugger.location", {
    filename: message.filename,
    line: message.line,
    functionName: message.functionName,
  });
  renderDebuggerVariables(message.globals);
  window.requestAnimationFrame(() => {
    revealDebuggerLine(message.line);
  });
}

function renderDebuggerVariables(variables: readonly DebuggerVariable[]): void {
  debugVariableList.replaceChildren();
  if (variables.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = t("debugger.noGlobals");
    debugVariableList.append(empty);
    return;
  }

  for (const variable of variables) {
    const row = document.createElement("div");
    row.className = "debug-variable-row";
    row.setAttribute("role", "listitem");

    const name = document.createElement("code");
    name.className = "debug-variable-name";
    name.textContent = variable.name;
    name.title = variable.name;

    const value = document.createElement("div");
    value.className = "debug-variable-value";
    const rendered = document.createElement("code");
    rendered.textContent = variable.value;
    const typeName = document.createElement("small");
    typeName.textContent = variable.typeName;
    value.append(rendered, typeName);
    row.append(name, value);
    debugVariableList.append(row);
  }
}

function revealDebuggerLine(line: number): void {
  const style = getComputedStyle(codeEditor);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const paddingTop = Number.parseFloat(style.paddingTop);
  if (!Number.isFinite(lineHeight) || !Number.isFinite(paddingTop)) {
    return;
  }
  const lineTop = paddingTop + (line - 1) * lineHeight;
  const visibleTop = codeEditor.scrollTop;
  const visibleBottom = visibleTop + codeEditor.clientHeight;
  if (lineTop < visibleTop || lineTop + lineHeight > visibleBottom) {
    codeEditor.scrollTop = Math.max(0, lineTop - (codeEditor.clientHeight - lineHeight) / 2);
  }
  updateDebuggerLineMarker();
}

function updateDebuggerLineMarker(): void {
  if (activeDebuggerLine === null) {
    return;
  }
  const style = getComputedStyle(codeEditor);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const paddingTop = Number.parseFloat(style.paddingTop);
  if (!Number.isFinite(lineHeight) || !Number.isFinite(paddingTop)) {
    return;
  }
  const offset = 1 + paddingTop + (activeDebuggerLine - 1) * lineHeight - codeEditor.scrollTop;
  debugCurrentLine.style.height = `${lineHeight}px`;
  debugCurrentLine.style.transform = `translateY(${offset}px)`;
  debugCurrentLine.dataset.line = String(activeDebuggerLine);
  debugCurrentLine.dataset.label = t("debugger.currentLine", { line: activeDebuggerLine });
  debugCurrentLine.title = t("debugger.currentLine", { line: activeDebuggerLine });
  debugCurrentLine.hidden = false;
}

function clearDebuggerWorkspace(): void {
  activeDebuggerLine = null;
  delete editorDebugWorkspace.dataset.debugging;
  debugCurrentLine.hidden = true;
  delete debugCurrentLine.dataset.line;
  delete debugCurrentLine.dataset.label;
  debugCurrentLine.removeAttribute("style");
  debugVariablePanel.hidden = true;
  debuggerLocation.textContent = "";
}

function updateRuntimeStatus(status: RuntimeStatus): void {
  if (status === "starting" || status === "stopped" || status === "error") {
    replExecutionPending = false;
    resetVirtualBoardState();
    deviceUiRenderer.reset();
  }
  statusIndicator.dataset.status = status;
  runtimeStatus.textContent = {
    starting: t("runtime.starting"),
    ready: t("runtime.ready"),
    executing: t("runtime.executing"),
    debugging: t("runtime.debugging"),
    stopped: t("runtime.stopped"),
    error: t("runtime.error"),
  }[status];

  sendButton.disabled = status !== "ready";
  const sourceLocked = status === "executing" || status === "debugging";
  codeEditor.readOnly = sourceLocked;
  renderEditorTabs();
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-device-example]")) {
    button.disabled = sourceLocked;
  }
  saveDraftButton.disabled = sourceLocked;
  resetDraftButton.disabled = sourceLocked;
  if (status !== "debugging") {
    clearDebuggerWorkspace();
  }
  terminalDirectInput.disabled = status !== "ready";
  terminalShell.dataset.ready = String(status === "ready" || status === "debugging");
  if (status !== "ready") {
    terminalInputComposing = false;
    terminalDirectInput.value = "";
  }
  debuggerCommandForm.hidden = status !== "debugging";
  debuggerCommandInput.disabled = status !== "debugging";
  if (status === "debugging") {
    debuggerCommandInput.focus({ preventScroll: true });
  } else {
    debuggerCommandInput.value = "";
  }
  runScriptButton.disabled = status !== "ready";
  debugScriptButton.disabled = status !== "ready" || sharedDebuggerChannel === null;
  debugScriptButton.title =
    sharedDebuggerChannel === null
      ? t("debugger.requiresIsolation")
      : t("debugger.description");
  stopButton.disabled = status === "stopped";
  optionalContentIntegration.runtimeStatusChanged(status);
}

function updateReplExecutionState(): void {
  const contents = terminalScreen.text;
  const currentLine = contents.slice(contents.lastIndexOf("\n") + 1);
  if (currentLine === ">>> ") {
    replExecutionPending = false;
  }
}

function appendTerminal(data: string): void {
  terminalScreen.write(data);
  if (terminalFrame === null) {
    terminalFrame = requestAnimationFrame(() => {
      terminalFrame = null;
      renderTerminal();
      updateReplExecutionState();
    });
  }
}

function renderTerminal(): void {
  if (terminalScreen.text.length > MAX_TERMINAL_CHARACTERS) {
    terminalScreen.replace(
      t("system.oldOutputOmitted", {
        output: terminalScreen.text.slice(-MAX_TERMINAL_CHARACTERS),
      }),
    );
  }
  const contents = terminalScreen.text;
  const cursorOffset = terminalScreen.cursorOffset;
  terminalText.textContent = contents.slice(0, cursorOffset);
  terminalTextAfterCursor.textContent = contents.slice(cursorOffset);
  terminal.scrollTop = terminal.scrollHeight;
}

function compactVersion(version: string): string {
  const match = version.match(/MicroPython v[^;]+/);
  return match?.[0] ?? version;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Required element #${id} was not found.`);
  }
  return element as T;
}
