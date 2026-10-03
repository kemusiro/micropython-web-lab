import type { BoardProfile } from "../board/board-profile";
import { t } from "../i18n/i18n";
import {
  validateConnectionGraph,
  type ConnectionEndpointV1,
  type ConnectionGraphV1,
  type DeviceConnectionV1,
  type PortConnectionV1,
} from "./connection-model";

const GPIO_PINS = [
  "GP0", "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7", "GP8", "GP9",
  "GP10", "GP11", "GP12", "GP13", "GP14", "GP15", "GP16", "GP17", "GP18",
  "GP19", "GP20", "GP21", "GP22", "GP26", "GP27", "GP28",
] as const;

export interface ConnectionEditorApplyResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface ConnectionEditorOptions {
  readonly defaultGraph: ConnectionGraphV1;
  readonly initialGraph: ConnectionGraphV1;
  readonly board: BoardProfile;
  readonly deviceNames: ReadonlyMap<string, string>;
  readonly readOnly?: boolean;
  readonly initialMessage?: string;
  validate(graph: ConnectionGraphV1): string | null;
  apply(graph: ConnectionGraphV1): ConnectionEditorApplyResult;
}

interface EditableDevice {
  readonly definition: DeviceConnectionV1;
  connected: boolean;
  ports: PortConnectionV1[];
}

interface EndpointUsage {
  readonly used: boolean;
  readonly owners: readonly string[];
}

type ConnectionFilter = "all" | "connected" | ConnectionEndpointV1["kind"];

type ConnectionDragState =
  | {
      readonly source: "device";
      readonly instanceId: string;
      readonly portId: string;
      readonly kind: ConnectionEndpointV1["kind"];
    }
  | {
      readonly source: "board";
      readonly instanceId: string;
      readonly portId: string;
      readonly kind: ConnectionEndpointV1["kind"];
    };

export class ConnectionEditor {
  readonly #root: HTMLElement;
  readonly #options: ConnectionEditorOptions;
  readonly #devices = new Map<string, EditableDevice>();
  readonly #collapsedDeviceIds = new Set<string>();
  #appliedGraph: ConnectionGraphV1;
  #searchQuery = "";
  #filter: ConnectionFilter = "all";
  #status: HTMLElement | null = null;
  #filterSummary: HTMLElement | null = null;
  #dropPalette: HTMLElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #scrollContainer: HTMLElement | null = null;
  #scrollListener: (() => void) | null = null;
  #boardScrollContainer: HTMLElement | null = null;
  #boardScrollListener: (() => void) | null = null;
  #boardScrollTop = 0;
  #dragState: ConnectionDragState | null = null;

  constructor(root: HTMLElement, options: ConnectionEditorOptions) {
    this.#root = root;
    this.#options = options;
    this.#appliedGraph = cloneGraph(options.initialGraph);
    this.#resetState(options.initialGraph);
    this.#render(options.initialMessage ?? t("connection.current"));
  }

  graph(): ConnectionGraphV1 {
    return validateConnectionGraph({
      schemaVersion: 1,
      boardProfile: this.#options.defaultGraph.boardProfile,
      devices: this.#options.defaultGraph.devices.flatMap((device) => {
        const editable = this.#devices.get(device.instanceId);
        if (editable === undefined || !editable.connected) {
          return [];
        }
        return [{ ...editable.definition, ports: editable.ports }];
      }),
    });
  }

  #resetState(initialGraph: ConnectionGraphV1): void {
    this.#devices.clear();
    const initialDevices = new Map(initialGraph.devices.map((device) => [device.instanceId, device]));
    for (const definition of this.#options.defaultGraph.devices) {
      const current = initialDevices.get(definition.instanceId);
      this.#devices.set(definition.instanceId, {
        definition,
        connected: current !== undefined,
        ports: clonePorts(current?.ports ?? definition.ports),
      });
    }
  }

  #render(message: string, messageState: "valid" | "saved" = "valid"): void {
    this.#resizeObserver?.disconnect();
    if (this.#scrollContainer !== null && this.#scrollListener !== null) {
      this.#scrollContainer.removeEventListener("scroll", this.#scrollListener);
    }
    if (this.#boardScrollContainer !== null && this.#boardScrollListener !== null) {
      this.#boardScrollTop = this.#boardScrollContainer.scrollTop;
      this.#boardScrollContainer.removeEventListener("scroll", this.#boardScrollListener);
    }
    this.#scrollContainer = null;
    this.#scrollListener = null;
    this.#boardScrollContainer = null;
    this.#boardScrollListener = null;
    const graph = this.graph();
    const dirty = !connectionGraphsEqual(graph, this.#appliedGraph);
    const validationError = this.#options.validate(graph);
    const affectedConnections =
      validationError === null
        ? new Set<string>()
        : findAffectedConnections(graph, validationError, this.#options.board);
    const toolbar = document.createElement("div");
    toolbar.className = "connection-editor-toolbar";

    const toolbarSummary = document.createElement("div");
    toolbarSummary.className = "connection-editor-toolbar-summary";
    const description = document.createElement("p");
    description.textContent = this.#options.readOnly
      ? t("connection.localReadonly")
      : t("connection.description");
    const dirtyIndicator = document.createElement("span");
    dirtyIndicator.className = "connection-dirty-indicator";
    dirtyIndicator.dataset.dirty = String(dirty);
    dirtyIndicator.textContent = dirty
      ? t("connection.unsaved")
      : t("connection.noUnsaved");
    toolbarSummary.append(description, dirtyIndicator);

    const actions = document.createElement("div");
    actions.className = "connection-editor-actions";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "quiet";
    reset.textContent = t("connection.reset");
    reset.disabled = this.#options.readOnly === true;
    reset.addEventListener("click", () => {
      this.#resetState(this.#options.defaultGraph);
      this.#render(t("connection.resetDone"));
    });
    const discard = document.createElement("button");
    discard.type = "button";
    discard.className = "quiet";
    discard.textContent = t("connection.discard");
    discard.disabled = this.#options.readOnly === true || !dirty;
    discard.addEventListener("click", () => {
      this.#resetState(this.#appliedGraph);
      this.#render(t("connection.discarded"));
    });
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = t("connection.apply");
    apply.disabled = this.#options.readOnly === true || !dirty || validationError !== null;
    apply.addEventListener("click", () => {
      const pendingGraph = this.graph();
      const result = this.#options.apply(pendingGraph);
      if (result.ok) {
        this.#appliedGraph = cloneGraph(pendingGraph);
        this.#render(result.message, "saved");
      } else {
        this.#showStatus(result.message, "error");
      }
    });
    actions.append(reset, discard, apply);
    toolbar.append(toolbarSummary, actions);

    const controls = this.#createFilterControls();

    const dropPalette = document.createElement("section");
    dropPalette.className = "connection-drop-palette";
    dropPalette.hidden = true;
    dropPalette.setAttribute("aria-live", "polite");
    this.#dropPalette = dropPalette;

    const canvas = document.createElement("div");
    canvas.className = "connection-editor-canvas";
    const wires = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wires.classList.add("connection-wires");
    wires.setAttribute("aria-hidden", "true");

    const boardNode = this.#createBoardNode();
    const deviceColumn = document.createElement("div");
    deviceColumn.className = "connection-device-column";
    for (const device of this.#options.defaultGraph.devices) {
      deviceColumn.append(
        this.#createDeviceNode(this.#devices.get(device.instanceId)!, affectedConnections),
      );
    }
    const noMatches = document.createElement("p");
    noMatches.className = "connection-filter-empty";
    noMatches.textContent = t("connection.noMatches");
    noMatches.hidden = true;
    deviceColumn.append(noMatches);
    canvas.append(wires, boardNode, deviceColumn);

    const legend = document.createElement("p");
    legend.className = "connection-editor-legend";
    legend.textContent = t("connection.legend");
    const status = document.createElement("p");
    status.className = "connection-editor-status";
    status.setAttribute("aria-live", "polite");
    this.#status = status;
    this.#root.replaceChildren(toolbar, controls, dropPalette, canvas, legend, status);

    if (validationError === null) {
      this.#showStatus(message, messageState);
    } else {
      this.#showStatus(
        localizeValidationError(
          validationError,
          graph,
          this.#options.board,
          this.#options.deviceNames,
        ),
        "error",
      );
    }
    this.#applyFilters();
    this.#scheduleWires(canvas, wires);
  }

  #createFilterControls(): HTMLElement {
    const controls = document.createElement("div");
    controls.className = "connection-editor-controls";

    const search = document.createElement("input");
    search.type = "search";
    search.value = this.#searchQuery;
    search.placeholder = t("connection.searchPlaceholder");
    search.setAttribute("aria-label", t("connection.searchLabel"));
    search.addEventListener("input", () => {
      this.#searchQuery = search.value;
      this.#applyFilters();
    });

    const filter = document.createElement("select");
    filter.setAttribute("aria-label", t("connection.filterLabel"));
    const filterOptions: readonly [ConnectionFilter, string][] = [
      ["all", t("connection.filterAll")],
      ["connected", t("connection.filterConnected")],
      ["gpio", "GPIO"],
      ["adc", "ADC"],
      ["i2c", "I2C"],
      ["spi", "SPI"],
      ["uart", "UART"],
      ["pwm", "PWM"],
    ];
    for (const [value, label] of filterOptions) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      filter.append(option);
    }
    filter.value = this.#filter;
    filter.addEventListener("change", () => {
      this.#filter = filter.value as ConnectionFilter;
      this.#applyFilters();
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "quiet";
    clear.textContent = t("connection.clearFilter");
    clear.addEventListener("click", () => {
      this.#searchQuery = "";
      this.#filter = "all";
      search.value = "";
      filter.value = "all";
      this.#applyFilters();
      search.focus();
    });

    const selectAll = document.createElement("button");
    selectAll.type = "button";
    selectAll.className = "quiet";
    selectAll.textContent = t("connection.selectAll");
    selectAll.disabled =
      this.#options.readOnly === true ||
      [...this.#devices.values()].every((device) => device.connected);
    selectAll.addEventListener("click", () => this.#setAllDevicesConnected(true));

    const deselectAll = document.createElement("button");
    deselectAll.type = "button";
    deselectAll.className = "quiet";
    deselectAll.textContent = t("connection.deselectAll");
    deselectAll.disabled =
      this.#options.readOnly === true ||
      [...this.#devices.values()].every((device) => !device.connected);
    deselectAll.addEventListener("click", () => this.#setAllDevicesConnected(false));

    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "quiet";
    collapse.textContent = t("connection.collapseAll");
    collapse.addEventListener("click", () => this.#setAllCollapsed(true));
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "quiet";
    expand.textContent = t("connection.expandAll");
    expand.addEventListener("click", () => this.#setAllCollapsed(false));

    const summary = document.createElement("span");
    summary.className = "connection-filter-summary";
    summary.setAttribute("aria-live", "polite");
    this.#filterSummary = summary;
    controls.append(search, filter, clear, selectAll, deselectAll, collapse, expand, summary);
    return controls;
  }

  #createBoardNode(): HTMLElement {
    const node = document.createElement("section");
    node.className = "connection-node connection-board-node";
    const title = document.createElement("h4");
    title.textContent = "Raspberry Pi Pico 2 W";
    const subtitle = document.createElement("p");
    subtitle.textContent = t("connection.functionalPorts");
    const ports = document.createElement("div");
    ports.className = "connection-node-ports";
    const endpoints = this.#boardEndpointCandidates();
    if (endpoints.length === 0) {
      const empty = document.createElement("span");
      empty.className = "connection-empty";
      empty.textContent = t("connection.none");
      ports.append(empty);
    }
    for (const endpoint of endpoints) {
      const key = endpointKey(endpoint);
      const row = document.createElement("div");
      row.className = `connection-board-port connection-kind-${endpoint.kind}`;
      row.dataset.connectionCandidateKind = endpoint.kind;
      row.dataset.connectionEndpointKey = key;
      row.dataset.connectionEndpointValue = endpointValue(endpoint);
      const endpointUsage = this.#endpointUsage(endpoint);
      row.dataset.connectionEndpointUsed = String(endpointUsage.used);
      const label = document.createElement("span");
      label.textContent = describeEndpoint(endpoint, this.#options.board);
      const usage = document.createElement("span");
      usage.className = "connection-endpoint-usage";
      usage.dataset.usage = endpointUsage.used ? "used" : "unused";
      usage.textContent = endpointUsage.used
        ? t("connection.endpointUsed")
        : t("connection.endpointUnused");
      if (endpointUsage.owners.length > 0) {
        usage.title = endpointUsage.owners.join(" / ");
      }
      const sockets = document.createElement("span");
      sockets.className = "connection-board-sockets";
      const connections = this.#connectionsAtEndpoint(endpoint);
      if (connections.length === 0) {
        const socket = document.createElement("span");
        socket.className = "connection-socket";
        socket.setAttribute("aria-hidden", "true");
        sockets.append(socket);
      }
      for (const connection of connections) {
        const socket = document.createElement("span");
        socket.className = "connection-socket";
        socket.dataset.connectionEndpoint = key;
        socket.dataset.connectionSourceFor = connection.connectionId;
        socket.draggable = this.#options.readOnly !== true;
        socket.title = connection.owner;
        socket.setAttribute(
          "aria-label",
          t("connection.dragBoardSocket", {
            endpoint: label.textContent,
            owner: connection.owner,
          }),
        );
        socket.addEventListener("dragstart", (event) => {
          if (this.#options.readOnly === true) {
            event.preventDefault();
            return;
          }
          this.#beginDrag(
            {
              source: "board",
              instanceId: connection.instanceId,
              portId: connection.portId,
              kind: endpoint.kind,
            },
            event,
          );
        });
        socket.addEventListener("dragend", () => this.#endDrag());
        sockets.append(socket);
      }
      this.#configureBoardDropTarget(row, endpoint);
      row.append(label, usage, sockets);
      ports.append(row);
    }
    node.append(title, subtitle, ports);
    return node;
  }

  #boardEndpointCandidates(): ConnectionEndpointV1[] {
    const endpoints = new Map<string, ConnectionEndpointV1>();
    for (const device of this.#devices.values()) {
      for (const port of device.ports) {
        for (const option of endpointOptions(port.endpoint, this.#options.board)) {
          const endpoint = updateEndpoint(port.endpoint, option.value);
          endpoints.set(endpointKey(endpoint), endpoint);
        }
      }
    }
    return [...endpoints.values()].sort((left, right) =>
      endpointKey(left).localeCompare(endpointKey(right), undefined, { numeric: true }),
    );
  }

  #connectionsAtEndpoint(endpoint: ConnectionEndpointV1): readonly {
    readonly connectionId: string;
    readonly instanceId: string;
    readonly portId: string;
    readonly owner: string;
  }[] {
    const key = endpointKey(endpoint);
    const connections: {
      connectionId: string;
      instanceId: string;
      portId: string;
      owner: string;
    }[] = [];
    for (const device of this.#devices.values()) {
      if (!device.connected) {
        continue;
      }
      for (const port of device.ports) {
        if (endpointKey(port.endpoint) !== key) {
          continue;
        }
        const deviceName =
          this.#options.deviceNames.get(device.definition.instanceId) ??
          device.definition.instanceId;
        connections.push({
          connectionId: `${device.definition.instanceId}.${port.portId}`,
          instanceId: device.definition.instanceId,
          portId: port.portId,
          owner: `${deviceName} · ${portLabel(port.portId)}`,
        });
      }
    }
    return connections;
  }

  #createDeviceNode(
    device: EditableDevice,
    affectedConnections: ReadonlySet<string>,
  ): HTMLElement {
    const node = document.createElement("section");
    node.className = "connection-node connection-device-node";
    node.dataset.connectionDevice = device.definition.instanceId;
    node.dataset.connected = String(device.connected);
    const deviceName =
      this.#options.deviceNames.get(device.definition.instanceId) ?? device.definition.instanceId;
    const kinds = [...new Set(device.ports.map((port) => port.endpoint.kind))];
    node.dataset.connectionKinds = kinds.join(" ");
    node.dataset.connectionSearch = [
      deviceName,
      device.definition.instanceId,
      device.definition.deviceId,
      ...kinds,
      ...device.ports.map((port) => port.portId),
    ]
      .join(" ")
      .toLocaleLowerCase();
    const hasConflict = device.ports.some((port) =>
      affectedConnections.has(`${device.definition.instanceId}.${port.portId}`),
    );
    node.dataset.conflict = String(hasConflict);
    const collapsed = this.#collapsedDeviceIds.has(device.definition.instanceId);
    node.dataset.collapsed = String(collapsed);

    const heading = document.createElement("div");
    heading.className = "connection-device-heading";
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "connection-device-collapse";
    collapse.setAttribute("aria-expanded", String(!collapsed));
    collapse.setAttribute(
      "aria-label",
      collapsed
        ? t("connection.expandDevice", { name: deviceName })
        : t("connection.collapseDevice", { name: deviceName }),
    );
    collapse.textContent = collapsed ? "▸" : "▾";
    const title = document.createElement("h4");
    title.textContent = deviceName;
    const summary = document.createElement("span");
    summary.className = "connection-device-summary";
    summary.textContent = t("connection.deviceSummary", {
      state: device.connected ? t("connection.connected") : t("connection.disconnected"),
      kinds: kinds.map((kind) => kind.toUpperCase()).join(" / "),
    });
    const toggleLabel = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = device.connected;
    toggle.disabled = this.#options.readOnly === true;
    toggle.dataset.connectionDeviceToggle = device.definition.instanceId;
    toggle.setAttribute("aria-label", t("connection.connectAria", { name: title.textContent }));
    toggle.addEventListener("change", () => {
      device.connected = toggle.checked;
      this.#render(t("connection.changed"));
    });
    const toggleText = document.createElement("span");
    toggleText.textContent = t("connection.connect");
    toggleLabel.append(toggle, toggleText);
    heading.append(collapse, title, summary, toggleLabel);

    const body = document.createElement("div");
    body.className = "connection-device-body";
    body.hidden = collapsed;
    const identity = document.createElement("small");
    identity.textContent = `${device.definition.deviceId}@${device.definition.deviceVersion}`;
    const ports = document.createElement("div");
    ports.className = "connection-node-ports";
    for (const port of device.ports) {
      ports.append(this.#createPortEditor(device, port, affectedConnections));
    }
    body.append(identity, ports);
    collapse.addEventListener("click", () => {
      const nextCollapsed = !body.hidden;
      body.hidden = nextCollapsed;
      node.dataset.collapsed = String(nextCollapsed);
      collapse.textContent = nextCollapsed ? "▸" : "▾";
      collapse.setAttribute("aria-expanded", String(!nextCollapsed));
      collapse.setAttribute(
        "aria-label",
        nextCollapsed
          ? t("connection.expandDevice", { name: deviceName })
          : t("connection.collapseDevice", { name: deviceName }),
      );
      if (nextCollapsed) {
        this.#collapsedDeviceIds.add(device.definition.instanceId);
      } else {
        this.#collapsedDeviceIds.delete(device.definition.instanceId);
      }
      this.#redrawWires();
    });
    node.append(heading, body);
    return node;
  }

  #createPortEditor(
    device: EditableDevice,
    port: PortConnectionV1,
    affectedConnections: ReadonlySet<string>,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = `connection-device-port connection-kind-${port.endpoint.kind}`;
    row.dataset.connectionPort = `${device.definition.instanceId}.${port.portId}`;
    row.dataset.conflict = String(affectedConnections.has(row.dataset.connectionPort));
    const socket = document.createElement("span");
    socket.className = "connection-socket";
    if (device.connected) {
      socket.dataset.connectionTarget = `${device.definition.instanceId}.${port.portId}`;
      socket.dataset.connectionEndpointKey = endpointKey(port.endpoint);
      socket.draggable = this.#options.readOnly !== true;
      socket.setAttribute(
        "aria-label",
        t("connection.dragDeviceSocket", {
          name:
            this.#options.deviceNames.get(device.definition.instanceId) ??
            device.definition.instanceId,
          port: portLabel(port.portId),
        }),
      );
      socket.addEventListener("dragstart", (event) => {
        if (this.#options.readOnly === true) {
          event.preventDefault();
          return;
        }
        this.#beginDrag(
          {
            source: "device",
            instanceId: device.definition.instanceId,
            portId: port.portId,
            kind: port.endpoint.kind,
          },
          event,
        );
      });
      socket.addEventListener("dragend", () => this.#endDrag());
      this.#configureDeviceDropTarget(socket, device, port);
    }
    const label = document.createElement("label");
    label.textContent = portLabel(port.portId);
    const select = document.createElement("select");
    select.disabled = !device.connected || this.#options.readOnly === true;
    select.dataset.connectionPortSelect = `${device.definition.instanceId}.${port.portId}`;
    select.setAttribute(
      "aria-label",
      t("connection.destinationAria", {
        name: this.#options.deviceNames.get(device.definition.instanceId) ?? device.definition.instanceId,
        port: portLabel(port.portId),
      }),
    );
    for (const option of endpointOptions(port.endpoint, this.#options.board)) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = endpointValue(port.endpoint);
    select.addEventListener("change", () => {
      const index = device.ports.findIndex((candidate) => candidate.portId === port.portId);
      device.ports[index] = {
        portId: port.portId,
        endpoint: updateEndpoint(port.endpoint, select.value),
      };
      this.#render(t("connection.changed"));
    });
    const detail = document.createElement("small");
    detail.textContent = endpointDetail(port.endpoint);
    row.append(socket, label, select, detail);
    return row;
  }

  #beginDrag(state: ConnectionDragState, event: DragEvent): void {
    this.#dragState = state;
    event.dataTransfer?.setData("text/plain", state.source);
    if (event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = "link";
    }
    this.#root.dataset.connectionDragging = state.kind;
    if (state.source === "board") {
      this.#showDropPalette(state);
    }
    for (const row of this.#root.querySelectorAll<HTMLElement>("[data-connection-candidate-kind]")) {
      const compatible =
        state.source === "board" &&
        row.dataset.connectionCandidateKind === state.kind &&
        row.dataset.connectionEndpointValue !== undefined &&
        this.#canAssignEndpointValue(
          state.instanceId,
          state.portId,
          state.kind,
          row.dataset.connectionEndpointValue,
        );
      row.dataset.dropCompatible = String(compatible);
    }
    for (const socket of this.#root.querySelectorAll<HTMLElement>("[data-connection-target]")) {
      const portRow = socket.closest<HTMLElement>("[data-connection-port]");
      const connectionId = portRow?.dataset.connectionPort;
      const compatible =
        state.source === "device" &&
        connectionId !== undefined &&
        this.#canSwapConnections(state.instanceId, state.portId, connectionId);
      socket.dataset.dropCompatible = String(compatible);
    }
    this.#showStatus(t("connection.dragging", { kind: state.kind.toUpperCase() }), "valid");
    this.#redrawWires();
  }

  #endDrag(): void {
    this.#dragState = null;
    delete this.#root.dataset.connectionDragging;
    this.#hideDropPalette();
    for (const row of this.#root.querySelectorAll<HTMLElement>("[data-connection-candidate-kind]")) {
      delete row.dataset.dropCompatible;
      row.classList.remove("connection-drop-active");
    }
    for (const socket of this.#root.querySelectorAll<HTMLElement>("[data-connection-target]")) {
      delete socket.dataset.dropCompatible;
      socket.classList.remove("connection-drop-active");
    }
    this.#redrawWires();
  }

  #showDropPalette(state: Extract<ConnectionDragState, { source: "board" }>): void {
    const palette = this.#dropPalette;
    const current = this.#devices
      .get(state.instanceId)
      ?.ports.find((candidate) => candidate.portId === state.portId);
    if (palette === null || current === undefined) {
      return;
    }

    const heading = document.createElement("strong");
    heading.textContent = t("connection.dropTargets", { kind: state.kind.toUpperCase() });
    const targets = document.createElement("div");
    targets.className = "connection-drop-palette-targets";
    for (const option of endpointOptions(current.endpoint, this.#options.board)) {
      if (!this.#canAssignEndpointValue(state.instanceId, state.portId, state.kind, option.value)) {
        continue;
      }
      const endpoint = updateEndpoint(current.endpoint, option.value);
      const usage = this.#endpointUsage(endpoint);
      const target = document.createElement("div");
      target.className = `connection-drop-target connection-kind-${endpoint.kind}`;
      target.dataset.connectionDropEndpoint = endpointKey(endpoint);
      target.dataset.dropCompatible = "true";
      target.setAttribute("role", "button");
      target.dataset.connectionUsage = usage.used ? "used" : "unused";
      const usageLabel = usage.used
        ? t("connection.endpointUsed")
        : t("connection.endpointUnused");
      target.setAttribute(
        "aria-label",
        t("connection.dropTargetAria", { target: option.label, usage: usageLabel }),
      );
      const socket = document.createElement("span");
      socket.className = "connection-socket";
      const content = document.createElement("span");
      content.className = "connection-drop-target-content";
      const label = document.createElement("span");
      label.className = "connection-drop-target-label";
      label.textContent = option.label;
      const usageText = document.createElement("small");
      usageText.className = "connection-drop-target-usage";
      usageText.dataset.usage = usage.used ? "used" : "unused";
      usageText.textContent = usage.used
        ? `${usageLabel} · ${usage.owners.join(" / ")}`
        : usageLabel;
      content.append(label, usageText);
      target.append(socket, content);
      this.#configureBoardDropTarget(target, endpoint);
      targets.append(target);
    }
    palette.replaceChildren(heading, targets);

    const panel = this.#root.closest<HTMLElement>(".virtual-board-panel");
    const bounds = panel?.getBoundingClientRect() ?? this.#root.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const top = Math.max(8, bounds.top + 8);
    const left = Math.max(8, bounds.left + 8);
    const right = Math.min(viewportWidth - 8, bounds.right - 8);
    const bottom = Math.min(viewportHeight - 8, bounds.bottom - 8);
    palette.style.setProperty("--connection-palette-top", `${top}px`);
    palette.style.setProperty("--connection-palette-left", `${left}px`);
    palette.style.setProperty("--connection-palette-width", `${Math.max(180, right - left)}px`);
    palette.style.setProperty(
      "--connection-palette-max-height",
      `${Math.max(120, bottom - top)}px`,
    );
    palette.hidden = false;
  }

  #hideDropPalette(): void {
    if (this.#dropPalette === null) {
      return;
    }
    this.#dropPalette.hidden = true;
    this.#dropPalette.replaceChildren();
  }

  #endpointUsage(endpoint: ConnectionEndpointV1): EndpointUsage {
    const resources = new Set(connectionResourceIds(endpoint, this.#options.board));
    const owners = new Set<string>();
    for (const device of this.graph().devices) {
      for (const port of device.ports) {
        if (
          !connectionResourceIds(port.endpoint, this.#options.board).some((resource) =>
            resources.has(resource),
          )
        ) {
          continue;
        }
        const deviceName =
          this.#options.deviceNames.get(device.instanceId) ?? device.instanceId;
        owners.add(`${deviceName} · ${portLabel(port.portId)}`);
      }
    }
    return { used: owners.size > 0, owners: [...owners] };
  }

  #configureBoardDropTarget(row: HTMLElement, endpoint: ConnectionEndpointV1): void {
    row.addEventListener("dragover", (event) => {
      const state = this.#dragState;
      if (
        state?.source !== "board" ||
        !this.#canAssignEndpointValue(
          state.instanceId,
          state.portId,
          endpoint.kind,
          endpointValue(endpoint),
        )
      ) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = "link";
      }
      row.classList.add("connection-drop-active");
    });
    row.addEventListener("dragleave", () => row.classList.remove("connection-drop-active"));
    row.addEventListener("drop", (event) => {
      const state = this.#dragState;
      if (
        state?.source !== "board" ||
        !this.#canAssignEndpointValue(
          state.instanceId,
          state.portId,
          endpoint.kind,
          endpointValue(endpoint),
        )
      ) {
        return;
      }
      event.preventDefault();
      this.#assignEndpoint(state.instanceId, state.portId, endpoint);
    });
  }

  #configureDeviceDropTarget(
    socket: HTMLElement,
    device: EditableDevice,
    port: PortConnectionV1,
  ): void {
    socket.addEventListener("dragover", (event) => {
      const state = this.#dragState;
      if (
        state?.source !== "device" ||
        !this.#canSwapConnections(
          state.instanceId,
          state.portId,
          `${device.definition.instanceId}.${port.portId}`,
        )
      ) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = "link";
      }
      socket.classList.add("connection-drop-active");
    });
    socket.addEventListener("dragleave", () => socket.classList.remove("connection-drop-active"));
    socket.addEventListener("drop", (event) => {
      const state = this.#dragState;
      if (
        state?.source !== "device" ||
        !this.#canSwapConnections(
          state.instanceId,
          state.portId,
          `${device.definition.instanceId}.${port.portId}`,
        )
      ) {
        return;
      }
      event.preventDefault();
      this.#swapDeviceEndpoints(
        state.instanceId,
        state.portId,
        device.definition.instanceId,
        port.portId,
      );
    });
  }

  #assignEndpoint(
    instanceId: string,
    portId: string,
    endpoint: ConnectionEndpointV1,
  ): void {
    const device = this.#devices.get(instanceId);
    const index = device?.ports.findIndex((candidate) => candidate.portId === portId) ?? -1;
    const current = device?.ports[index];
    if (
      device === undefined ||
      current === undefined ||
      !this.#canAssignEndpointValue(
        instanceId,
        portId,
        endpoint.kind,
        endpointValue(endpoint),
      )
    ) {
      this.#endDrag();
      return;
    }
    device.ports[index] = {
      portId,
      endpoint: updateEndpoint(current.endpoint, endpointValue(endpoint)),
    };
    this.#endDrag();
    this.#render(t("connection.dragChanged"));
  }

  #canSwapConnections(
    sourceInstanceId: string,
    sourcePortId: string,
    targetConnectionId: string,
  ): boolean {
    const sourceDevice = this.#devices.get(sourceInstanceId);
    const sourcePort = sourceDevice?.ports.find((candidate) => candidate.portId === sourcePortId);
    const separator = targetConnectionId.lastIndexOf(".");
    if (separator <= 0 || sourcePort === undefined || sourceDevice?.connected !== true) {
      return false;
    }
    const targetInstanceId = targetConnectionId.slice(0, separator);
    const targetPortId = targetConnectionId.slice(separator + 1);
    if (targetInstanceId === sourceInstanceId) {
      return false;
    }
    const targetDevice = this.#devices.get(targetInstanceId);
    const targetPort = targetDevice?.ports.find((candidate) => candidate.portId === targetPortId);
    if (
      targetPort === undefined ||
      targetDevice?.connected !== true ||
      sourcePort.endpoint.kind !== targetPort.endpoint.kind ||
      endpointValue(sourcePort.endpoint) === endpointValue(targetPort.endpoint)
    ) {
      return false;
    }
    return (
      this.#canAssignEndpointValue(
        sourceInstanceId,
        sourcePortId,
        targetPort.endpoint.kind,
        endpointValue(targetPort.endpoint),
      ) &&
      this.#canAssignEndpointValue(
        targetInstanceId,
        targetPortId,
        sourcePort.endpoint.kind,
        endpointValue(sourcePort.endpoint),
      )
    );
  }

  #swapDeviceEndpoints(
    sourceInstanceId: string,
    sourcePortId: string,
    targetInstanceId: string,
    targetPortId: string,
  ): void {
    const targetConnectionId = `${targetInstanceId}.${targetPortId}`;
    if (!this.#canSwapConnections(sourceInstanceId, sourcePortId, targetConnectionId)) {
      this.#endDrag();
      return;
    }
    const sourceDevice = this.#devices.get(sourceInstanceId)!;
    const targetDevice = this.#devices.get(targetInstanceId)!;
    const sourceIndex = sourceDevice.ports.findIndex((port) => port.portId === sourcePortId);
    const targetIndex = targetDevice.ports.findIndex((port) => port.portId === targetPortId);
    const sourcePort = sourceDevice.ports[sourceIndex]!;
    const targetPort = targetDevice.ports[targetIndex]!;
    const sourceValue = endpointValue(sourcePort.endpoint);
    const targetValue = endpointValue(targetPort.endpoint);
    sourceDevice.ports[sourceIndex] = {
      portId: sourcePort.portId,
      endpoint: updateEndpoint(sourcePort.endpoint, targetValue),
    };
    targetDevice.ports[targetIndex] = {
      portId: targetPort.portId,
      endpoint: updateEndpoint(targetPort.endpoint, sourceValue),
    };
    this.#endDrag();
    this.#render(t("connection.dragChanged"));
  }

  #canAssignEndpointValue(
    instanceId: string,
    portId: string,
    kind: ConnectionEndpointV1["kind"],
    value: string,
  ): boolean {
    const port = this.#devices
      .get(instanceId)
      ?.ports.find((candidate) => candidate.portId === portId);
    return (
      port?.endpoint.kind === kind &&
      endpointOptions(port.endpoint, this.#options.board).some((option) => option.value === value)
    );
  }

  #scheduleWires(canvas: HTMLElement, svg: SVGSVGElement): void {
    const panel = this.#root.closest<HTMLElement>(".virtual-board-panel");
    const board = this.#root.querySelector<HTMLElement>(".connection-board-node");
    const boardScrollTop = this.#boardScrollTop;
    let boardScrollRestored = false;
    let framePending = false;
    const draw = (): void => {
      if (framePending) {
        return;
      }
      framePending = true;
      requestAnimationFrame(() => {
        framePending = false;
        const toolbar = this.#root.querySelector<HTMLElement>(".connection-editor-toolbar");
        const stickyTop = (toolbar?.getBoundingClientRect().height ?? 0) + 16;
        const scrollportHeight = panel?.clientHeight ?? document.documentElement.clientHeight;
        this.#root.style.setProperty("--connection-board-sticky-top", `${stickyTop}px`);
        this.#root.style.setProperty(
          "--connection-board-sticky-max-height",
          `${Math.max(160, scrollportHeight - stickyTop - 16)}px`,
        );
        if (board !== null && !boardScrollRestored) {
          board.scrollTop = boardScrollTop;
          this.#boardScrollTop = board.scrollTop;
          boardScrollRestored = true;
        }
        drawWires(canvas, svg);
      });
    };
    draw();
    if (typeof ResizeObserver !== "undefined") {
      this.#resizeObserver = new ResizeObserver(draw);
      this.#resizeObserver.observe(canvas);
      const toolbar = this.#root.querySelector<HTMLElement>(".connection-editor-toolbar");
      if (toolbar !== null) {
        this.#resizeObserver.observe(toolbar);
      }
      if (panel !== null) {
        this.#resizeObserver.observe(panel);
      }
    }
    if (panel !== null) {
      this.#scrollContainer = panel;
      this.#scrollListener = draw;
      panel.addEventListener("scroll", draw, { passive: true });
    }
    if (board !== null) {
      this.#boardScrollContainer = board;
      this.#boardScrollListener = () => {
        this.#boardScrollTop = board.scrollTop;
        draw();
      };
      board.addEventListener("scroll", this.#boardScrollListener, { passive: true });
    }
  }

  #redrawWires(): void {
    requestAnimationFrame(() => {
      const canvas = this.#root.querySelector<HTMLElement>(".connection-editor-canvas");
      const svg = this.#root.querySelector<SVGSVGElement>(".connection-wires");
      if (canvas !== null && svg !== null) {
        drawWires(canvas, svg);
      }
    });
  }

  #applyFilters(): void {
    const query = this.#searchQuery.trim().toLocaleLowerCase();
    const nodes = [
      ...this.#root.querySelectorAll<HTMLElement>("[data-connection-device]"),
    ];
    let visible = 0;
    for (const node of nodes) {
      const matchesQuery = query.length === 0 || node.dataset.connectionSearch?.includes(query) === true;
      const matchesFilter =
        this.#filter === "all" ||
        (this.#filter === "connected" && node.dataset.connected === "true") ||
        node.dataset.connectionKinds?.split(" ").includes(this.#filter) === true;
      node.hidden = !(matchesQuery && matchesFilter);
      if (!node.hidden) {
        visible += 1;
      }
    }
    const empty = this.#root.querySelector<HTMLElement>(".connection-filter-empty");
    if (empty !== null) {
      empty.hidden = visible !== 0;
    }
    if (this.#filterSummary !== null) {
      this.#filterSummary.textContent = t("connection.filterCount", {
        visible: String(visible),
        total: String(nodes.length),
      });
    }
    this.#redrawWires();
  }

  #setAllCollapsed(collapsed: boolean): void {
    for (const node of this.#root.querySelectorAll<HTMLElement>("[data-connection-device]")) {
      if (node.hidden) {
        continue;
      }
      const instanceId = node.dataset.connectionDevice;
      const body = node.querySelector<HTMLElement>(".connection-device-body");
      const button = node.querySelector<HTMLButtonElement>(".connection-device-collapse");
      const name = node.querySelector("h4")?.textContent ?? instanceId ?? "";
      if (instanceId === undefined || body === null || button === null) {
        continue;
      }
      body.hidden = collapsed;
      node.dataset.collapsed = String(collapsed);
      button.textContent = collapsed ? "▸" : "▾";
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute(
        "aria-label",
        collapsed
          ? t("connection.expandDevice", { name })
          : t("connection.collapseDevice", { name }),
      );
      if (collapsed) {
        this.#collapsedDeviceIds.add(instanceId);
      } else {
        this.#collapsedDeviceIds.delete(instanceId);
      }
    }
    this.#redrawWires();
  }

  #setAllDevicesConnected(connected: boolean): void {
    if (this.#options.readOnly === true) {
      return;
    }
    for (const device of this.#devices.values()) {
      device.connected = connected;
    }
    this.#render(
      connected ? t("connection.selectedAll") : t("connection.deselectedAll"),
    );
  }

  #showStatus(message: string, state: "valid" | "saved" | "error"): void {
    if (this.#status !== null) {
      this.#status.textContent = message;
      this.#status.dataset.state = state;
    }
  }
}

function clonePorts(ports: readonly PortConnectionV1[]): PortConnectionV1[] {
  return ports.map((port) => ({ portId: port.portId, endpoint: { ...port.endpoint } }));
}

function cloneGraph(graph: ConnectionGraphV1): ConnectionGraphV1 {
  return validateConnectionGraph({
    schemaVersion: graph.schemaVersion,
    boardProfile: { ...graph.boardProfile },
    devices: graph.devices.map((device) => ({
      ...device,
      ports: clonePorts(device.ports),
    })),
  });
}

function connectionGraphsEqual(left: ConnectionGraphV1, right: ConnectionGraphV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findAffectedConnections(
  graph: ConnectionGraphV1,
  validationError: string,
  board: BoardProfile,
): Set<string> {
  const affected = new Set<string>();
  const resource = /Board resource (\S+) is already claimed/.exec(validationError)?.[1];
  if (resource !== undefined) {
    for (const device of graph.devices) {
      for (const port of device.ports) {
        if (connectionResourceIds(port.endpoint, board).includes(resource)) {
          affected.add(`${device.instanceId}.${port.portId}`);
        }
      }
    }
  }

  const owner = /already claimed by (.+)\.$/.exec(validationError)?.[1];
  if (owner !== undefined && !owner.startsWith("shared:")) {
    affected.add(owner);
  }

  const directConnection =
    /(?:Connection (?:port|endpoint)|SPI connection) ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(
      validationError,
    )?.[1];
  if (directConnection !== undefined) {
    affected.add(directConnection);
  }

  const uart = /^UART(\d+) has more than one peer\.$/.exec(validationError)?.[1];
  const spi = /^SPI(\d+) has more than one fallback target\.$/.exec(validationError)?.[1];
  for (const device of graph.devices) {
    for (const port of device.ports) {
      if (uart !== undefined && port.endpoint.kind === "uart" && port.endpoint.controller === Number(uart)) {
        affected.add(`${device.instanceId}.${port.portId}`);
      }
      if (
        spi !== undefined &&
        port.endpoint.kind === "spi" &&
        port.endpoint.controller === Number(spi) &&
        port.endpoint.fallback === true
      ) {
        affected.add(`${device.instanceId}.${port.portId}`);
      }
    }
  }
  return affected;
}

function connectionResourceIds(
  endpoint: ConnectionEndpointV1,
  board: BoardProfile,
): readonly string[] {
  switch (endpoint.kind) {
    case "gpio":
    case "pwm":
      return [board.resolvePin(endpoint.pin).resourceId];
    case "adc":
      return [board.resolveAdc(board.resolvePin(endpoint.pin)).pin.resourceId];
    case "i2c": {
      const controller = board.resolveI2c(endpoint.controller);
      return [
        controller.sda.resourceId,
        controller.scl.resourceId,
        `i2c:${controller.id}:${endpoint.address}`,
      ];
    }
    case "spi": {
      const controller = board.resolveSpi(endpoint.controller);
      return [controller.sck.resourceId, controller.mosi.resourceId, controller.miso.resourceId];
    }
    case "uart": {
      const controller = board.resolveUart(endpoint.controller);
      return [controller.tx.resourceId, controller.rx.resourceId, `bus:uart:${controller.id}`];
    }
  }
}

function localizeValidationError(
  message: string,
  graph: ConnectionGraphV1,
  board: BoardProfile,
  deviceNames: ReadonlyMap<string, string>,
): string {
  const resourceConflict = /^Board resource (\S+) is already claimed by (.+)\.$/.exec(message);
  if (resourceConflict !== null) {
    const resource = resourceConflict[1]!;
    const owners = describeResourceUsers(resource, graph, board, deviceNames);
    if (resource.startsWith("pin:")) {
      return t("connection.conflictPin", { pin: resource.slice(4), owners });
    }
    if (resource.startsWith("i2c:")) {
      const [, controller = "?", decimalAddress = "0"] = resource.split(":");
      const address = Number(decimalAddress).toString(16).padStart(2, "0");
      return t("connection.conflictI2cAddress", {
        controller,
        address,
        owners,
      });
    }
    return t("connection.conflictResource", { resource, owners });
  }
  const uart = /^UART(\d+) has more than one peer\.$/.exec(message)?.[1];
  if (uart !== undefined) {
    return t("connection.conflictUart", { controller: uart });
  }
  const spi = /^SPI(\d+) has more than one fallback target\.$/.exec(message)?.[1];
  if (spi !== undefined) {
    return t("connection.conflictSpiFallback", { controller: spi });
  }
  return t("connection.invalidDetail", { message });
}

function describeResourceUsers(
  resource: string,
  graph: ConnectionGraphV1,
  board: BoardProfile,
  deviceNames: ReadonlyMap<string, string>,
): string {
  const users = new Set<string>();
  for (const device of graph.devices) {
    for (const port of device.ports) {
      if (!connectionResourceIds(port.endpoint, board).includes(resource)) {
        continue;
      }
      if (
        port.endpoint.kind === "i2c" ||
        port.endpoint.kind === "spi" ||
        port.endpoint.kind === "uart"
      ) {
        users.add(`${port.endpoint.kind.toUpperCase()}${port.endpoint.controller}`);
      } else {
        users.add(deviceNames.get(device.instanceId) ?? device.instanceId);
      }
    }
  }
  return [...users].join(" / ");
}

function endpointKey(endpoint: ConnectionEndpointV1): string {
  switch (endpoint.kind) {
    case "gpio":
    case "adc":
    case "pwm":
      return `${endpoint.kind}:${endpoint.pin}`;
    case "i2c":
    case "spi":
    case "uart":
      return `${endpoint.kind}:${endpoint.controller}`;
  }
}

function endpointValue(endpoint: ConnectionEndpointV1): string {
  switch (endpoint.kind) {
    case "gpio":
    case "adc":
    case "pwm":
      return endpoint.pin;
    case "i2c":
    case "spi":
    case "uart":
      return String(endpoint.controller);
  }
}

function endpointOptions(
  endpoint: ConnectionEndpointV1,
  board: BoardProfile,
): readonly { readonly value: string; readonly label: string }[] {
  switch (endpoint.kind) {
    case "gpio": {
      const pins = endpoint.pin === "LED" ? ["LED", ...GPIO_PINS] : GPIO_PINS;
      return pins.map((pin) => ({ value: pin, label: board.resolvePin(pin).displayName }));
    }
    case "adc":
      return [{ value: "GP26", label: "ADC0 · GP26" }];
    case "i2c":
      return [{ value: "0", label: "I2C0 · SDA=GP8 · SCL=GP9" }];
    case "spi":
      return [{ value: "0", label: "SPI0 · SCK=GP6 · MOSI=GP7 · MISO=GP4" }];
    case "uart":
      return [{ value: "0", label: "UART0 · TX=GP0 · RX=GP1" }];
    case "pwm":
      return GPIO_PINS.map((pin) => ({ value: pin, label: `PWM · ${pin}` }));
  }
}

function updateEndpoint(endpoint: ConnectionEndpointV1, value: string): ConnectionEndpointV1 {
  switch (endpoint.kind) {
    case "gpio":
    case "adc":
    case "pwm":
      return { ...endpoint, pin: value };
    case "i2c":
    case "spi":
    case "uart":
      return { ...endpoint, controller: Number(value) };
  }
}

function describeEndpoint(endpoint: ConnectionEndpointV1, board: BoardProfile): string {
  switch (endpoint.kind) {
    case "gpio":
      return board.resolvePin(endpoint.pin).displayName;
    case "adc":
      return `ADC${board.resolveAdc(board.resolvePin(endpoint.pin)).channel} · ${endpoint.pin}`;
    case "i2c": {
      const bus = board.resolveI2c(endpoint.controller);
      return `I2C${bus.id} · SDA=${bus.sda.displayName} · SCL=${bus.scl.displayName}`;
    }
    case "spi": {
      const bus = board.resolveSpi(endpoint.controller);
      return `SPI${bus.id} · SCK=${bus.sck.displayName}`;
    }
    case "uart": {
      const bus = board.resolveUart(endpoint.controller);
      return `UART${bus.id} · TX=${bus.tx.displayName} · RX=${bus.rx.displayName}`;
    }
    case "pwm":
      return `PWM · ${board.resolvePin(endpoint.pin).displayName}`;
  }
}

function endpointDetail(endpoint: ConnectionEndpointV1): string {
  if (endpoint.kind === "i2c") {
    return `7-bit address 0x${endpoint.address.toString(16).padStart(2, "0")}`;
  }
  if (endpoint.kind === "spi") {
    return endpoint.fallback === true
      ? t("connection.defaultTarget")
      : t("connection.spiSelect", {
          port: endpoint.selectPort ?? t("connection.notSet"),
          level: endpoint.activeLevel === 1 ? "High" : "Low",
        });
  }
  return endpoint.kind.toUpperCase();
}

function portLabel(portId: string): string {
  const labels: Readonly<Record<string, string>> = {
    input: t("connection.port.input"),
    output: t("connection.port.output"),
    i2c: "I2C",
    spi: "SPI",
    uart: "UART",
    cs: "CS",
    dc: "D/C",
    reset: "RESET",
    pps: "PPS",
    red: t("connection.port.red"),
    green: t("connection.port.green"),
    blue: t("connection.port.blue"),
  };
  return labels[portId] ?? portId;
}

function drawWires(canvas: HTMLElement, svg: SVGSVGElement): void {
  const bounds = canvas.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  svg.replaceChildren();
  for (const target of canvas.querySelectorAll<HTMLElement>("[data-connection-target]")) {
    if (target.closest<HTMLElement>("[hidden]") !== null || target.getClientRects().length === 0) {
      continue;
    }
    const key = target.dataset.connectionEndpointKey;
    if (key === undefined) {
      continue;
    }
    const connectionId = target.dataset.connectionTarget;
    const source =
      connectionId === undefined
        ? null
        : canvas.querySelector<HTMLElement>(
            `[data-connection-source-for="${CSS.escape(connectionId)}"]`,
          );
    if (source === null) {
      continue;
    }
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const x1 = from.left + from.width / 2 - bounds.left;
    const sourceCenterY = from.top + from.height / 2;
    const board = source.closest<HTMLElement>(".connection-board-node");
    const boardBounds = board?.getBoundingClientRect();
    let clampedSourceY = sourceCenterY;
    let sourceVisibility = "visible";
    if (boardBounds !== undefined) {
      const boardInset = 10;
      const panelBounds = board
        ?.closest<HTMLElement>(".virtual-board-panel")
        ?.getBoundingClientRect();
      const visibleBoardTop = Math.max(boardBounds.top, panelBounds?.top ?? 0, 0);
      const visibleBoardBottom = Math.min(
        boardBounds.bottom,
        panelBounds?.bottom ?? document.documentElement.clientHeight,
        document.documentElement.clientHeight,
      );
      const minimumSourceY = visibleBoardTop + boardInset;
      const maximumSourceY = Math.max(minimumSourceY, visibleBoardBottom - boardInset);
      clampedSourceY = Math.min(Math.max(sourceCenterY, minimumSourceY), maximumSourceY);
      sourceVisibility =
        sourceCenterY < minimumSourceY
          ? "before"
          : sourceCenterY > maximumSourceY
            ? "after"
            : "visible";
    }
    const y1 = clampedSourceY - bounds.top;
    const x2 = to.left + to.width / 2 - bounds.left;
    const y2 = to.top + to.height / 2 - bounds.top;
    const bend = Math.max(36, Math.abs(x2 - x1) * 0.45);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    path.dataset.kind = key.split(":", 1)[0];
    path.dataset.sourceEndpoint = key;
    path.dataset.sourceVisibility = sourceVisibility;
    path.dataset.targetConnection = connectionId ?? "";
    path.dataset.conflict =
      target.closest<HTMLElement>("[data-conflict='true']") === null ? "false" : "true";
    svg.append(path);
  }
}
