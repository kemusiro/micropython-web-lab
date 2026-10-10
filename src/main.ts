import "./styles.css";
import { ProjectWorkspace } from "./project/workspace";
import { FilePanel } from "./project/file-panel";
import { ProjectFiles, type ProjectSnapshot } from "./project/filesystem";

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
import { FIRST_EXPERIMENT_SOURCE, FirstExperiment } from "./examples/first-experiment";
import { loadAppScreen, saveAppScreen, type AppScreen } from "./layout/app-screen";
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
import { installWorkspaceViews } from "./layout/workspace-view";
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
const MAX_EXPERIMENT_OUTPUT_CHARACTERS = 4_000;

const browserStorage = getBrowserStorage();
let originalScreenPreference: string | null = null;
try { originalScreenPreference = browserStorage?.getItem("micropython-web-lab:app-screen:v1") ?? null; } catch { /* Blocked storage. */ }
let legacySavedAt = "";
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
const openExperimentButton = requiredElement<HTMLButtonElement>("open-experiment-button");
const openWorkspaceButton = requiredElement<HTMLButtonElement>("open-workspace-button");
const experimentStopButton = requiredElement<HTMLButtonElement>("experiment-stop-button");
const experimentRestartButton = requiredElement<HTMLButtonElement>("experiment-restart-button");
const experimentStep = requiredElement<HTMLParagraphElement>("experiment-step");
const experimentTitle = requiredElement<HTMLHeadingElement>("experiment-title");
const experimentInstruction = requiredElement<HTMLParagraphElement>("experiment-instruction");
const experimentFeedback = requiredElement<HTMLParagraphElement>("experiment-feedback");
const experimentOutputDetails = requiredElement<HTMLDetailsElement>("experiment-output-details");
const experimentOutput = requiredElement<HTMLPreElement>("experiment-output");
const experimentLed = requiredElement<HTMLSpanElement>("experiment-led");
const experimentLedState = requiredElement<HTMLSpanElement>("experiment-led-state");
const experimentNext = requiredElement<HTMLDivElement>("experiment-next");
const examplesSection = requiredElement<HTMLElement>("examples-title").closest<HTMLElement>(
  ".examples",
);
if (examplesSection === null) {
  throw new Error("Required .examples section was not found.");
}

installWorkspaceResizers({
  workspace,
  explorerPanel: requiredElement<HTMLElement>("workspace-explorer"),
  columnResizer: workspaceColumnResizer,
  rowResizer: workspaceRowResizer,
  editorPanel: scriptForm,
  terminalHeading,
  terminalShell,
  storage: browserStorage,
});

const workspaceViews = installWorkspaceViews({
  workspace,
  editorPanel: scriptForm,
  editorCodeArea: requiredElement<HTMLElement>("editor-code-area"),
  toolbar: requiredElement<HTMLElement>("workspace-toolbar"),
  rowResizer: workspaceRowResizer,
  terminalHeading,
  terminalShell,
  debuggerForm: debuggerCommandForm,
  inputForm: requiredElement<HTMLElement>("repl-batch"),
  viewButtons: Array.from(
    workspace.querySelectorAll<HTMLButtonElement>("[data-workspace-view-button]"),
  ),
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
let editorTabMovesFocus = false;
let replExecutionPending = false;
let replRuntimeBusy = false;
let autosaveTimer: number | null = null;
let activeDebuggerLine: number | null = null;
const lastDeviceSequences = new Map<string, number>();
const initialScript = FIRST_EXPERIMENT_SOURCE;
codeEditor.value = initialScript;
const experiment = new FirstExperiment();
let appScreen: AppScreen = "workspace";
let experimentTabId: string | null = null;
let currentRuntimeStatus: RuntimeStatus = "stopped";
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
const projectWorkspace = new ProjectWorkspace();
let projectSaveGeneration = 0;
let projectPersistence = Promise.resolve();
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
    onCheckpoint: () => projectPersistence,
    onReplBusy: (busy) => {
      replRuntimeBusy = busy;
      updateRuntimeStatus(runtime.status);
    },
  },
  undefined,
  {
    deviceInputs: sharedDeviceInputs?.toTransfer(),
    debuggerChannel: sharedDebuggerChannel ?? undefined,
    ...(localDeviceMetadata === null ? { connectionGraph: activeConnectionGraph } : {}),
  },
);


const filePanel = new FilePanel(requiredElement<HTMLElement>("project-files"), {
  snapshot: () => projectWorkspace.files.snapshot(),
  open: openProjectFile,
  createFile: () => openEditorTab(t("editor.untitled"), ""),
  activePath: () => activeEditorTab().path,
  saveAs: saveActiveEditorTo,
  change: changeProjectFiles,
  replace: replaceProjectFiles,
  backupDrafts: backupEditorDrafts,
  error: projectError,
  busyChanged: () => updateRuntimeStatus(runtime.status),
});

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
      (!replExecutionPending && !replRuntimeBusy &&
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
const restoredWorkspace = restoreEditorWorkspace();
appScreen = loadAppScreen(browserStorage, {
  hasSavedWorkspace: restoredWorkspace === "loaded",
  storageError: restoredWorkspace === "invalid" || (restoredWorkspace === "unavailable" && browserStorage !== null),
  localMode: __WEB_LAB_LOCAL_MODE__,
});
if (appScreen === "experiment") experimentTabId = activeEditorTabId;
if (!__WEB_LAB_LOCAL_MODE__) saveAppScreen(browserStorage, appScreen);
renderAppScreen();
openWorkspaceButton.addEventListener("click", () => showAppScreen("workspace"));
openExperimentButton.addEventListener("click", () => {
  if (codeEditor.readOnly) return;
  if (editorTabs.some((tab) => tab.id === experimentTabId)) {
    selectEditorTab(experimentTabId!);
  } else {
    if (!openEditorTab(t("experiment.sampleTitle"), FIRST_EXPERIMENT_SOURCE)) return;
    experimentTabId = activeEditorTabId;
  }
  experiment.reset();
  experimentOutput.textContent = "";
  experimentOutputDetails.hidden = true;
  experimentOutputDetails.open = false;
  showAppScreen("experiment");
});
requiredElement<HTMLButtonElement>("experiment-finish-button").addEventListener("click", () => showAppScreen("workspace"));
requiredElement<HTMLButtonElement>("experiment-button-example").addEventListener("click", () => {
  showAppScreen("workspace");
  openDeviceExample("button-gp15");
});
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
  updateActiveEditorTabSource(codeEditor.value, true);
  updateEditorTabSaveIndicators();
  scheduleDraftSave();
  optionalContentIntegration.editorChanged(codeEditor.value);
});
codeEditor.addEventListener("scroll", updateDebuggerLineMarker);
codeEditor.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    editorTabMovesFocus = true;
    return;
  }
  if (event.key === "Tab" && editorTabMovesFocus) {
    editorTabMovesFocus = false;
    return;
  }
  editorTabMovesFocus = false;
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
  filePanel.saveActiveTab();
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
  saveCurrentDraft();
  codeEditor.focus();
});

window.addEventListener("pagehide", () => {
  if (autosaveTimer !== null) {
    cancelScheduledDraftSave();
    // A bounded synchronous editor journal covers navigation before IndexedDB
    // can finish. The full binary filesystem remains in IndexedDB.
    updateActiveEditorTabSource(codeEditor.value);
    if (draftStorage) saveEditorWorkspace(draftStorage, editorTabs, activeEditorTabId);
    saveCurrentDraft();
  }
});

replInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    sendCurrentInput();
  }
});

const restartRuntime = (): void => {
  appendTerminal(t("system.restarting"));
  runtime.restart();
};
restartButton.addEventListener("click", restartRuntime);
experimentRestartButton.addEventListener("click", restartRuntime);

const stopRuntime = (): void => {
  runtime.stop();
  appendTerminal(t("system.stopped"));
};
stopButton.addEventListener("click", stopRuntime);
experimentStopButton.addEventListener("click", stopRuntime);

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
    openEditorTab(t("editor.untitled"), source);
  });
}

const deviceSampleList = requiredElement<HTMLElement>("device-sample-list");
for (const entry of referenceDeviceUis) {
  if (!hasDeviceExample(entry.instanceId)) continue;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quiet";
  button.dataset.libraryDeviceExample = entry.instanceId;
  button.textContent = entry.definition.title;
  button.addEventListener("click", () => openDeviceExample(entry.instanceId));
  deviceSampleList.append(button);
}

const configurationScreen = requiredElement<HTMLElement>("device-configuration-screen");
const openConfigurationButton = requiredElement<HTMLButtonElement>("open-device-configuration");
const closeConfigurationButton = requiredElement<HTMLButtonElement>("close-device-configuration");
function showDeviceConfiguration(open: boolean): void {
  workspace.dataset.deviceConfiguration = String(open);
  configurationScreen.hidden = !open;
  (open ? closeConfigurationButton : openConfigurationButton).focus({ preventScroll: true });
}
openConfigurationButton.addEventListener("click", () => showDeviceConfiguration(true));
closeConfigurationButton.addEventListener("click", () => showDeviceConfiguration(false));

void initializeProject();
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
  if (filePanel.busy || replRuntimeBusy || runtime.status !== "ready") return;
  cancelScheduledDraftSave();
  const source = codeEditor.value;
  if (source.trim().length === 0) {
    appendTerminal(t("system.enterCode"));
    if (appScreen === "experiment") {
      experiment.feedback = "error";
      appendExperimentOutput(t("experiment.enterCode"));
      experimentOutputDetails.open = true;
      renderExperiment();
    }
    return;
  }

  if (mode === "debug" && sharedDebuggerChannel === null) {
    appendTerminal(t("system.debugIsolation"));
    return;
  }

  // Execute the current buffer; imported modules still use explicitly saved files.
  if (projectWorkspace.loaded) {
    try {
      updateActiveEditorTabSource(source);
      void persistProject().catch(projectError);
    } catch (error) { projectError(error); return; }
  }
  const accepted = runtime.executeScript(source, mode, activeEditorTab().path);
  if (!accepted) {
    appendTerminal(t("system.waitReady"));
    return;
  }

  optionalContentIntegration.executionStarted(source, mode);
  if (appScreen === "experiment" && mode === "run") {
    experiment.start(source);
    experimentOutput.textContent = "";
    experimentOutputDetails.hidden = true;
    experimentOutputDetails.open = false;
    renderExperiment();
  }
  appendTerminal(
    mode === "debug" ? t("system.debugStarted") : t("system.runStarted"),
  );
}

function showAppScreen(screen: AppScreen): void {
  showDeviceConfiguration(false);
  appScreen = screen;
  saveAppScreen(browserStorage, screen);
  if (screen === "experiment") workspaceViews.reset();
  renderAppScreen();
  // The navigation control being activated becomes hidden in the new screen.
  (screen === "experiment" ? codeEditor : restartButton).focus({ preventScroll: true });
}

function renderAppScreen(): void {
  document.body.dataset.appScreen = appScreen;
  openExperimentButton.hidden = appScreen === "experiment" || __WEB_LAB_LOCAL_MODE__;
  openWorkspaceButton.hidden = appScreen === "workspace";
  runScriptButton.textContent = t(appScreen === "experiment" ? "experiment.run" : "editor.run");
  renderExperiment();
}

function renderExperiment(): void {
  const stage = experiment.stage;
  const suffix = ({ run: "Run", edit: "Edit", complete: "Complete" } as const)[stage];
  experimentStep.textContent = t(`experiment.step${suffix}`);
  experimentTitle.textContent = t(`experiment.title${suffix}`);
  experimentInstruction.textContent = t(`experiment.instruction${suffix}`);
  experimentFeedback.textContent = currentRuntimeStatus === "starting"
    ? t("experiment.feedback.starting")
    : currentRuntimeStatus === "error"
      ? t("experiment.feedback.unavailable")
      : currentRuntimeStatus === "stopped"
        ? t("experiment.feedback.stopped")
        : t(`experiment.feedback.${experiment.feedback}`);
  const inExperiment = appScreen === "experiment";
  experimentStopButton.hidden = !inExperiment || currentRuntimeStatus !== "executing";
  experimentRestartButton.hidden = !inExperiment || (currentRuntimeStatus !== "stopped" && currentRuntimeStatus !== "error");
  if (document.activeElement === experimentStopButton && experimentStopButton.hidden) {
    (experimentRestartButton.hidden ? runScriptButton : experimentRestartButton).focus({ preventScroll: true });
  }
  experimentNext.hidden = stage !== "complete";
  for (const button of experimentNext.querySelectorAll<HTMLButtonElement>("button")) {
    button.disabled = currentRuntimeStatus !== "ready";
  }
}

function appendExperimentOutput(data: string): void {
  experimentOutput.textContent = ((experimentOutput.textContent ?? "") + data).slice(-MAX_EXPERIMENT_OUTPUT_CHARACTERS);
  experimentOutputDetails.hidden = false;
}

function restoreEditorWorkspace(): "empty" | "loaded" | "invalid" | "unavailable" {
  if (draftStorage === null) {
    setDraftStatus(t("draft.unavailable"), "error");
    renderEditorTabs();
    return "unavailable";
  }

  const result = loadEditorWorkspace(draftStorage);
  switch (result.status) {
    case "empty":
      setDraftStatus(t("draft.initial"), "idle");
      break;
    case "loaded":
      legacySavedAt = result.workspace.savedAt;
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
  return result.status;
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
  void backupEditorDrafts().catch(projectError);
}

function projectError(error: unknown): void {
  setDraftStatus(error instanceof Error ? error.message : String(error), "error");
}

async function initializeProject(): Promise<void> {
  codeEditor.readOnly = true;
  filePanel.setLocked(true);
  try {
    const stored = await projectWorkspace.load(editorTabs, activeEditorTabId, legacySavedAt);
    editorTabs = stored.tabs;
    activeEditorTabId = stored.activeTabId;
    codeEditor.value = activeEditorTab().source;
    renderEditorTabs();
    runtime.setProject(projectWorkspace.files.snapshot());
    await projectWorkspace.save(editorTabs, activeEditorTabId);
    updateEditorTabSaveIndicators();
    if (projectWorkspace.restored && !originalScreenPreference && !__WEB_LAB_LOCAL_MODE__) {
      appScreen = "workspace"; experimentTabId = null;
      saveAppScreen(browserStorage, appScreen); renderAppScreen();
    }
    if (projectWorkspace.restored) setDraftStatus(t("draft.restored", { time: formatSavedAt(new Date().toISOString()) }), "saved");
  } catch (error) { projectError(error); }
  filePanel.render();
  runtime.start();
}

function persistProject(): Promise<void> {
  const generation = ++projectSaveGeneration;
  setDraftStatus(t("draft.pending"), "pending");
  projectPersistence = projectWorkspace.save(editorTabs, activeEditorTabId).then(() => {
    updateEditorTabSaveIndicators();
    if (generation === projectSaveGeneration) setDraftStatus(t("draft.saved", { time: formatSavedAt(new Date().toISOString()) }), "saved");
  });
  return projectPersistence;
}

async function saveActiveEditorTo(path: string): Promise<boolean> {
  if (runtime.status !== "ready") throw new Error(t("files.wait"));
  updateActiveEditorTabSource(codeEditor.value);
  if (editorTabs.some(tab => tab.id !== activeEditorTabId && tab.path === path)) throw new Error(t("files.alreadyOpen"));
  const entry = projectWorkspace.files.get(path);
  if (entry?.kind === "directory") throw new Error(t("files.invalidFilename"));
  if (entry && activeEditorTab().path !== path && !window.confirm(t("files.overwriteConfirm", { path }))) return false;
  cancelScheduledDraftSave();
  const nextTabs = editorTabs.map(tab => tab.id === activeEditorTabId
    ? { ...tab, path, title: path.split("/").at(-1)!.slice(0, 80) } : tab);
  const files = new ProjectFiles(projectWorkspace.files.snapshot());
  files.write(path, new TextEncoder().encode(activeEditorTab().source));
  // Persist first: a failed save must not rename or bind an untitled editor.
  await projectWorkspace.replace(files.snapshot(), nextTabs, activeEditorTabId);
  editorTabs = nextTabs;
  runtime.setProject(files.snapshot());
  renderEditorTabs();
  filePanel.render();
  setDraftStatus(t("files.saved", { time: formatSavedAt(new Date().toISOString()) }), "saved");
  return true;
}

async function backupEditorDrafts(): Promise<void> {
  if (!projectWorkspace.loaded) throw new Error(t("draft.unavailable"));
  cancelScheduledDraftSave();
  updateActiveEditorTabSource(codeEditor.value);
  await persistProject();
}

function openProjectFile(path: string): void {
  if (codeEditor.readOnly) return;
  const entry = projectWorkspace.files.get(path);
  if (entry?.kind !== "file") throw new Error(t("files.selectFile"));
  const existing = editorTabs.find(tab => tab.path === path);
  if (existing) { selectEditorTab(existing.id); return; }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(entry.data);
  if (source.length > MAX_SCRIPT_CHARACTERS || source.includes("\0")) throw new Error(t("files.notEditable"));
  if (openEditorTab(path.split("/").at(-1)!, source)) {
    editorTabs = editorTabs.map(tab => tab.id === activeEditorTabId ? { ...tab, path } : tab);
    renderEditorTabs();
  }
}

async function changeProjectFiles(snapshot: ProjectSnapshot, rename?: { from: string; to: string }): Promise<void> {
  if (runtime.status !== "ready") throw new Error(t("files.wait"));
  cancelScheduledDraftSave();
  updateActiveEditorTabSource(codeEditor.value);
  const nextTabs = editorTabs.map(tab => {
    const path = tab.path;
    return rename && path && (path === rename.from || path.startsWith(rename.from + "/"))
      ? { ...tab, path: rename.to + path.slice(rename.from.length), title: (rename.to + path.slice(rename.from.length)).split("/").at(-1)!.slice(0, 80) }
      : tab;
  }).filter(tab => !tab.path || snapshot.entries.some(entry => entry.kind === "file" && entry.path === tab.path));
  if (!nextTabs.length) nextTabs.push({ id: "main", title: "main.py", source: "" });
  const nextActive = nextTabs.some(tab => tab.id === activeEditorTabId) ? activeEditorTabId : nextTabs[0]!.id;
  await projectWorkspace.replace(snapshot, nextTabs, nextActive);
  editorTabs = nextTabs; activeEditorTabId = nextActive; codeEditor.value = activeEditorTab().source;
  runtime.setProject(snapshot); renderEditorTabs(); filePanel.render();
}

async function replaceProjectFiles(snapshot: ProjectSnapshot): Promise<void> {
  if (runtime.status !== "ready") throw new Error(t("files.wait"));
  let tab: EditorWorkspaceTab = { id: "main", title: "main.py", source: "" };
  const candidates = snapshot.entries.filter(entry => entry.kind === "file" && entry.path.endsWith(".py")).sort((a, b) => Number(b.path === "main.py") - Number(a.path === "main.py"));
  for (const candidate of candidates) {
    if (candidate.kind !== "file") continue;
    try {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(candidate.data);
      if (source.length <= MAX_SCRIPT_CHARACTERS && !source.includes("\0")) {
        tab = { ...tab, path: candidate.path, title: candidate.path.split("/").at(-1)!.slice(0, 80), source };
        break;
      }
    } catch { /* Binary files remain in the project without being opened as text. */ }
  }
  cancelScheduledDraftSave();
  await projectWorkspace.replace(snapshot, [tab], tab.id);
  editorTabs = [tab]; activeEditorTabId = tab.id; codeEditor.value = tab.source;
  runtime.setProject(snapshot); runtime.restart(); renderEditorTabs(); filePanel.render();
}

function acceptRuntimeFiles(snapshot: ProjectSnapshot): void {
  const before = projectWorkspace.files;
  editorTabs = editorTabs.map(tab => {
    if (!tab.path) return tab;
    const previous = before.get(tab.path);
    const incoming = snapshot.entries.find(entry => entry.path === tab.path);
    if (previous?.kind === "file" && incoming?.kind === "file" && tab.source === new TextDecoder().decode(previous.data)) {
      try {
        const source = new TextDecoder("utf-8", { fatal: true }).decode(incoming.data);
        if (source.length <= MAX_SCRIPT_CHARACTERS && !source.includes("\0")) return { ...tab, source };
      } catch { /* Keep an editable draft when Python writes binary data. */ }
    }
    return tab;
  }).filter(tab => !tab.path || before.get(tab.path)?.kind !== "file" || snapshot.entries.some(entry => entry.path === tab.path && entry.kind === "file"));
  if (!editorTabs.length) editorTabs = [{ id: "main", title: "main.py", source: "" }];
  if (!editorTabs.some(tab => tab.id === activeEditorTabId)) activeEditorTabId = editorTabs[0]!.id;
  before.replace(snapshot);
  renderEditorTabs();
  codeEditor.value = activeEditorTab().source;
  filePanel.render();
  void persistProject().catch(projectError);
}

function activeEditorTab(): EditorWorkspaceTab {
  return editorTabs.find((tab) => tab.id === activeEditorTabId) ?? editorTabs[0]!;
}

function updateActiveEditorTabSource(source: string, edited = false): void {
  const index = editorTabs.findIndex((tab) => tab.id === activeEditorTabId);
  if (index < 0) {
    return;
  }
  if (!edited && source === editorTabs[index]!.source.replace(/\r\n?/g, "\n")) return;
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
    select.setAttribute("aria-label", tab.title);
    select.textContent = tab.title;
    select.title = tab.path ? "/project/" + tab.path : tab.title;
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
    const saveState = document.createElement("span");
    saveState.id = `editor-tab-state-${tab.id}`;
    saveState.className = "visually-hidden";
    saveState.dataset.editorSaveState = tab.id;
    item.append(select, close, saveState);
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
  updateEditorTabSaveIndicators();
}

function updateEditorTabSaveIndicators(): void {
  for (const tab of editorTabs) {
    const select = [...editorTabsElement.querySelectorAll<HTMLButtonElement>("[data-editor-tab]")].find(element => element.dataset.editorTab === tab.id);
    const state = [...editorTabsElement.querySelectorAll<HTMLElement>("[data-editor-save-state]")].find(element => element.dataset.editorSaveState === tab.id);
    if (!select || !state) continue;
    const unsaved = projectWorkspace.isTabUnsaved(tab);
    select.textContent = (unsaved ? "●" : "") + tab.title;
    select.dataset.unsaved = String(unsaved);
    state.hidden = !unsaved;
    state.textContent = unsaved ? t("editor.unsavedChanges") : "";
    if (unsaved) select.setAttribute("aria-describedby", state.id);
    else select.removeAttribute("aria-describedby");
  }
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

function openEditorTab(title: string, source: string): boolean {
  if (codeEditor.readOnly) {
    return false;
  }
  if (editorTabs.length >= MAX_EDITOR_TABS) {
    setDraftStatus(t("editor.tabLimit", { count: MAX_EDITOR_TABS }), "error");
    return false;
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
  return true;
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
  if (projectWorkspace.isTabUnsaved(tab)) {
    if (!window.confirm(t(tab.path ? "editor.closeFileTabConfirm" : "editor.closeTabConfirm", { title: tab.title }))) return;
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
  openEditorTab(t("editor.untitled"), source);
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
    case "filesystem":
      acceptRuntimeFiles(message.project);
      break;
    case "ready":
      replExecutionPending = false;
      runtimeVersion.textContent = `${compactVersion(message.micropythonVersion)} · restricted · ${message.runtimeBuild.sourceCommit.slice(0, 7)}`;
      break;
    case "repl-reset":
      appendTerminal(t("system.softReset"));
      break;
    case "stdout":
      if (experiment.running) appendExperimentOutput(message.data);
      optionalContentIntegration.stdout(message.data);
      appendTerminal(message.data);
      break;
    case "stderr":
      if (experiment.running) appendExperimentOutput(message.data);
      appendTerminal(message.data);
      break;
    case "error":
      appendExperimentOutput(message.message);
      experimentOutputDetails.open = true;
      renderExperiment();
      appendTerminal(`\n[runtime error] ${message.message}\n`);
      break;
    case "execution-result":
      if (experiment.running) {
        if (!message.ok && message.error) appendExperimentOutput(message.error);
        experiment.finish(message.ok);
        experimentOutputDetails.open = !message.ok;
        renderExperiment();
      }
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
  if (state.pinId === "LED" && state.mode === "output") {
    experimentLed.dataset.on = String(state.value === 1);
    experimentLedState.textContent = t(state.value === 1 ? "experiment.ledOn" : "experiment.ledOff");
    experiment.observeLed(state.value === 1);
  }
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
    filename: message.filename.replace(/^\/project\//, ""),
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
  currentRuntimeStatus = status;
  if (status === "starting" || status === "stopped" || status === "error") {
    experiment.interrupt();
    experimentLed.dataset.on = "false";
    experimentLedState.textContent = t("experiment.ledOff");
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
  const sourceLocked = status === "executing" || status === "debugging" || filePanel.busy || replRuntimeBusy;
  openExperimentButton.disabled = sourceLocked;
  codeEditor.readOnly = sourceLocked;
  renderEditorTabs();
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-device-example]")) {
    button.disabled = sourceLocked;
  }
  filePanel.setLocked(sourceLocked || status === "starting" || !projectWorkspace.loaded);
  saveDraftButton.disabled = sourceLocked || !projectWorkspace.loaded;
  resetDraftButton.disabled = sourceLocked;
  if (status !== "debugging") {
    clearDebuggerWorkspace();
  }
  terminalDirectInput.disabled = status !== "ready" || filePanel.busy;
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
  sendButton.disabled = status !== "ready" || filePanel.busy;
  runScriptButton.disabled = status !== "ready" || filePanel.busy || replRuntimeBusy;
  debugScriptButton.disabled = status !== "ready" || sharedDebuggerChannel === null || filePanel.busy || replRuntimeBusy;
  debugScriptButton.title =
    sharedDebuggerChannel === null
      ? t("debugger.requiresIsolation")
      : t("debugger.description");
  stopButton.disabled = status === "stopped";
  renderExperiment();
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
