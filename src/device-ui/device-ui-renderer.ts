import type { DeviceAction, DeviceStateEvent } from "../device-api/types";
import { t } from "../i18n/i18n";
import { devicePanelSize, devicePanelSpan } from "./device-panel-layout";
import {
  loadDevicePanelOrder,
  reconcileDevicePanelOrder,
  saveDevicePanelOrder,
  updateVisibleDevicePanelOrder,
  type DevicePanelOrderStorage,
} from "./device-panel-order";
import {
  createDeviceAction,
  createDeviceUiStateViews,
  type DeviceUiComponent,
  type DeviceUiDefinition,
  type DeviceUiStateView,
} from "./device-ui";

const MIN_MOMENTARY_PRESS_MS = 180;

export interface DeviceUiEntry {
  readonly instanceId: string;
  readonly definition: DeviceUiDefinition;
}

export type DeviceUiActionHandler = (instanceId: string, action: DeviceAction) => void;

export interface DeviceUiRendererOptions {
  readonly exampleInstanceIds?: ReadonlySet<string>;
  readonly orderStorage?: DevicePanelOrderStorage | null;
  openExample?(instanceId: string): void;
}

interface RenderedDevice {
  readonly definition: DeviceUiDefinition;
  readonly card: HTMLElement;
  readonly moveHandle: HTMLButtonElement;
  readonly actionStatus: HTMLElement;
  readonly stateElements: ReadonlyMap<string, HTMLElement>;
  readonly pixelDisplayElements: ReadonlyMap<string, HTMLCanvasElement>;
  readonly sliderElements: ReadonlyMap<string, HTMLInputElement>;
  readonly controls: readonly (HTMLButtonElement | HTMLInputElement)[];
}

interface DevicePanelPointerDrag {
  readonly pointerId: number;
  readonly sourceInstanceId: string;
  readonly captureElement: HTMLElement;
  targetInstanceId: string | null;
  position: "before" | "after";
  readonly preview: HTMLElement;
  readonly offsetX: number;
  readonly offsetY: number;
}

export class DeviceUiRenderer {
  readonly #root: HTMLElement;
  readonly #onAction: DeviceUiActionHandler;
  readonly #options: DeviceUiRendererOptions;
  readonly #devices = new Map<string, RenderedDevice>();
  readonly #lastSequences = new Map<string, number>();
  #panelOrder: string[];
  #pointerDrag: DevicePanelPointerDrag | null = null;
  #reorderStatus: HTMLElement | null = null;
  #interactive: boolean;

  constructor(
    root: HTMLElement,
    entries: readonly DeviceUiEntry[],
    onAction: DeviceUiActionHandler,
    interactive: boolean,
    options: DeviceUiRendererOptions = {},
  ) {
    this.#root = root;
    this.#onAction = onAction;
    this.#interactive = interactive;
    this.#options = options;
    this.#panelOrder = loadDevicePanelOrder(options.orderStorage ?? null);
    this.#render(entries);
  }

  update(event: DeviceStateEvent): void {
    const device = this.#devices.get(event.instanceId);
    if (device === undefined || event.sequence <= (this.#lastSequences.get(event.instanceId) ?? 0)) {
      return;
    }
    this.#lastSequences.set(event.instanceId, event.sequence);
    for (const view of createDeviceUiStateViews(device.definition, event.state)) {
      this.#applyStateView(device, view);
    }
    device.card.dataset.state = "ready";
  }

  reset(): void {
    this.#lastSequences.clear();
    for (const device of this.#devices.values()) {
      device.card.dataset.state = "waiting";
      for (const stateElement of device.stateElements.values()) {
        stateElement.textContent = t("device.waiting");
        stateElement.dataset.state = "waiting";
        stateElement.removeAttribute("data-active");
      }
      for (const canvas of device.pixelDisplayElements.values()) {
        clearPixelDisplay(canvas);
        canvas.dataset.state = "waiting";
        canvas.removeAttribute("title");
      }
      for (const control of device.controls) {
        if (control instanceof HTMLButtonElement) {
          control.dataset.pressed = "false";
        }
      }
      device.actionStatus.textContent = "";
      device.actionStatus.dataset.state = "idle";
    }
  }

  setInteractive(interactive: boolean): void {
    this.#interactive = interactive;
    for (const device of this.#devices.values()) {
      for (const control of device.controls) {
        control.disabled = !interactive;
      }
    }
  }

  replace(entries: readonly DeviceUiEntry[]): void {
    this.#clearDragState();
    this.#devices.clear();
    this.#lastSequences.clear();
    this.#render(entries);
  }

  #render(entries: readonly DeviceUiEntry[]): void {
    this.#panelOrder = reconcileDevicePanelOrder(
      this.#panelOrder,
      entries.map((entry) => entry.instanceId),
    );
    const orderRanks = new Map(this.#panelOrder.map((instanceId, index) => [instanceId, index]));
    const orderedEntries = [...entries].sort(
      (left, right) =>
        (orderRanks.get(left.instanceId) ?? Number.MAX_SAFE_INTEGER) -
        (orderRanks.get(right.instanceId) ?? Number.MAX_SAFE_INTEGER),
    );
    const instanceIds = new Set<string>();
    const cards: HTMLElement[] = [];
    for (const entry of orderedEntries) {
      if (instanceIds.has(entry.instanceId)) {
        throw new Error(`Duplicate Device UI instance: ${entry.instanceId}`);
      }
      instanceIds.add(entry.instanceId);
      const device = this.#createDevice(entry);
      this.#devices.set(entry.instanceId, device);
      cards.push(device.card);
    }
    const reorderStatus = document.createElement("p");
    reorderStatus.className = "device-ui-reorder-status";
    reorderStatus.setAttribute("aria-live", "polite");
    this.#reorderStatus = reorderStatus;
    this.#root.replaceChildren(...cards, reorderStatus);
    this.#updateMoveHandleLabels();
  }

  #createDevice(entry: DeviceUiEntry): RenderedDevice {
    const card = document.createElement("article");
    card.className = "device-ui-card";
    card.dataset.deviceInstance = entry.instanceId;
    card.dataset.state = "waiting";
    const panelSize = devicePanelSize(entry.definition);
    const panelSpan = devicePanelSpan(panelSize);
    card.dataset.panelSize = panelSize;
    card.dataset.panelColumns = String(panelSpan.columns);
    card.dataset.panelRows = String(panelSpan.rows);

    const headingRow = document.createElement("div");
    headingRow.className = "device-ui-card-heading";
    const headingCopy = document.createElement("div");
    headingCopy.className = "device-ui-card-heading-copy";
    const heading = document.createElement("h3");
    const headingId = `device-ui-${entry.instanceId}-title`;
    heading.id = headingId;
    heading.textContent = entry.definition.title;
    card.setAttribute("aria-labelledby", headingId);
    headingCopy.append(heading);
    headingRow.append(headingCopy);

    const headingActions = document.createElement("div");
    headingActions.className = "device-ui-card-heading-actions";
    const moveHandle = document.createElement("button");
    moveHandle.type = "button";
    moveHandle.className = "device-ui-move-handle quiet";
    moveHandle.dataset.deviceMoveHandle = entry.instanceId;
    moveHandle.textContent = `⠿ ${t("device.movePanel")}`;
    moveHandle.title = t("device.movePanelTitle");
    moveHandle.setAttribute(
      "aria-keyshortcuts",
      "ArrowUp ArrowDown ArrowLeft ArrowRight Home End",
    );
    moveHandle.addEventListener("pointerdown", (event) => {
      this.#beginPointerDrag(event, entry.instanceId, card, moveHandle);
    });
    headingRow.addEventListener("pointerdown", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("button, input, textarea, select, a") !== null
      ) {
        return;
      }
      this.#beginPointerDrag(event, entry.instanceId, card, headingRow);
    });
    const updatePointerDrag = (event: PointerEvent): void => this.#updatePointerDrag(event);
    const finishPointerDrag = (event: PointerEvent): void => this.#finishPointerDrag(event);
    const recoverLostPointer = (event: PointerEvent): void => {
      if (this.#pointerDrag?.pointerId === event.pointerId) {
        this.#clearDragState();
      }
    };
    const dragSurfaces: HTMLElement[] = [moveHandle, headingRow];
    for (const dragSurface of dragSurfaces) {
      dragSurface.addEventListener("pointermove", updatePointerDrag);
      dragSurface.addEventListener("pointerup", finishPointerDrag);
      dragSurface.addEventListener("pointercancel", finishPointerDrag);
      dragSurface.addEventListener("lostpointercapture", recoverLostPointer);
    }
    moveHandle.addEventListener("keydown", (event) => {
      this.#movePanelByKey(entry.instanceId, event);
    });
    headingActions.append(moveHandle);
    if (
      this.#options.openExample !== undefined &&
      this.#options.exampleInstanceIds?.has(entry.instanceId) === true
    ) {
      const sample = document.createElement("button");
      sample.type = "button";
      sample.className = "device-ui-example-button quiet";
      sample.dataset.deviceExample = entry.instanceId;
      sample.textContent = t("device.openSample");
      sample.setAttribute(
        "aria-label",
        t("device.openSampleAria", { device: entry.definition.title }),
      );
      sample.addEventListener("click", () => this.#options.openExample?.(entry.instanceId));
      headingActions.append(sample);
    }
    headingRow.append(headingActions);
    card.append(headingRow);

    if (entry.definition.description !== undefined) {
      const description = document.createElement("p");
      description.className = "device-ui-description";
      description.textContent = entry.definition.description;
      card.append(description);
    }

    const components = document.createElement("div");
    components.className = "device-ui-components";
    const stateElements = new Map<string, HTMLElement>();
    const pixelDisplayElements = new Map<string, HTMLCanvasElement>();
    const sliderElements = new Map<string, HTMLInputElement>();
    const controls: Array<HTMLButtonElement | HTMLInputElement> = [];
    for (const component of entry.definition.components) {
      const rendered = this.#createComponent(entry, component);
      components.append(rendered.element);
      if (rendered.stateElement !== undefined) {
        stateElements.set(component.id, rendered.stateElement);
      }
      if (rendered.pixelDisplayElement !== undefined) {
        pixelDisplayElements.set(component.id, rendered.pixelDisplayElement);
      }
      if (rendered.sliderElement !== undefined) {
        sliderElements.set(component.id, rendered.sliderElement);
      }
      controls.push(...rendered.controls);
    }
    card.append(components);

    const actionStatus = document.createElement("p");
    actionStatus.className = "device-ui-action-status";
    actionStatus.dataset.state = "idle";
    actionStatus.setAttribute("aria-live", "polite");
    card.append(actionStatus);
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "device-ui-collapse quiet";
    collapse.textContent = "▾";
    collapse.setAttribute("aria-label", t("device.collapse", { device: entry.definition.title }));
    collapse.setAttribute("aria-expanded", "true");
    components.id = `device-ui-${entry.instanceId}-components`;
    collapse.setAttribute("aria-controls", components.id);
    collapse.addEventListener("click", () => {
      const collapsed = collapse.getAttribute("aria-expanded") === "true";
      collapse.setAttribute("aria-expanded", String(!collapsed));
      collapse.textContent = collapsed ? "▸" : "▾";
      components.hidden = collapsed;
      actionStatus.hidden = collapsed;
      const description = card.querySelector<HTMLElement>(".device-ui-description");
      if (description !== null) description.hidden = collapsed;
    });
    headingActions.append(collapse);

    return {
      definition: entry.definition,
      card,
      moveHandle,
      actionStatus,
      stateElements,
      pixelDisplayElements,
      sliderElements,
      controls,
    };
  }

  #beginPointerDrag(
    event: PointerEvent,
    instanceId: string,
    card: HTMLElement,
    captureElement: HTMLElement,
  ): void {
    if (event.button !== 0 || this.#pointerDrag !== null) {
      return;
    }
    event.preventDefault();
    const bounds = card.getBoundingClientRect();
    const preview = card.cloneNode(true) as HTMLElement;
    preview.classList.add("device-ui-drag-preview");
    delete preview.dataset.deviceInstance;
    preview.dataset.dragPreviewFor = instanceId;
    preview.setAttribute("aria-hidden", "true");
    preview.querySelectorAll<HTMLElement>("[id]").forEach((element) => element.removeAttribute("id"));
    preview.querySelectorAll<HTMLElement>("button, input, textarea, select, a").forEach((element) => {
      element.setAttribute("tabindex", "-1");
    });
    preview.style.width = `${bounds.width}px`;
    preview.style.height = `${bounds.height}px`;
    document.body.append(preview);
    this.#pointerDrag = {
      pointerId: event.pointerId,
      sourceInstanceId: instanceId,
      captureElement,
      targetInstanceId: null,
      position: "after",
      preview,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    this.#positionDragPreview(this.#pointerDrag, event.clientX, event.clientY);
    card.dataset.dragging = "true";
    this.#root.dataset.reordering = "true";
    document.documentElement.dataset.devicePanelDragging = "true";
    captureElement.setPointerCapture(event.pointerId);
  }

  #updatePointerDrag(event: PointerEvent): void {
    const drag = this.#pointerDrag;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    this.#positionDragPreview(drag, event.clientX, event.clientY);
    this.#clearDropTargets();
    const hovered = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-device-instance]");
    const hoveredInstanceId = hovered?.dataset.deviceInstance;
    if (
      hovered === null ||
      hovered === undefined ||
      hoveredInstanceId === undefined ||
      hoveredInstanceId === drag.sourceInstanceId ||
      !this.#root.contains(hovered)
    ) {
      drag.targetInstanceId = null;
      return;
    }
    drag.targetInstanceId = hoveredInstanceId;
    drag.position = this.#dropPosition(hovered, event.clientX, event.clientY);
    hovered.dataset.dropPosition = drag.position;
  }

  #finishPointerDrag(event: PointerEvent): void {
    const drag = this.#pointerDrag;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.type === "pointerup" && drag.targetInstanceId !== null) {
      this.#movePanel(drag.sourceInstanceId, drag.targetInstanceId, drag.position);
    }
    if (drag.captureElement.hasPointerCapture(event.pointerId)) {
      drag.captureElement.releasePointerCapture(event.pointerId);
    }
    this.#clearDragState();
  }

  #positionDragPreview(
    drag: DevicePanelPointerDrag,
    clientX: number,
    clientY: number,
  ): void {
    drag.preview.style.left = `${clientX - drag.offsetX}px`;
    drag.preview.style.top = `${clientY - drag.offsetY}px`;
  }

  #dropPosition(card: HTMLElement, clientX: number, clientY: number): "before" | "after" {
    const bounds = card.getBoundingClientRect();
    const verticalDistance = Math.abs(clientY - (bounds.top + bounds.height / 2));
    if (verticalDistance < bounds.height / 4) {
      return clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    }
    return clientY < bounds.top + bounds.height / 2 ? "before" : "after";
  }

  #movePanel(
    sourceInstanceId: string,
    targetInstanceId: string,
    position: "before" | "after",
  ): void {
    const source = this.#devices.get(sourceInstanceId)?.card;
    const target = this.#devices.get(targetInstanceId)?.card;
    if (source === undefined || target === undefined || source === target) {
      return;
    }
    this.#root.insertBefore(
      source,
      position === "before" ? target : target.nextSibling,
    );
    this.#persistVisibleOrder(sourceInstanceId);
  }

  #movePanelByKey(instanceId: string, event: KeyboardEvent): void {
    const cards = this.#visibleCards();
    const currentIndex = cards.findIndex((card) => card.dataset.deviceInstance === instanceId);
    if (currentIndex < 0) {
      return;
    }
    let targetIndex = currentIndex;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") targetIndex -= 1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") targetIndex += 1;
    else if (event.key === "Home") targetIndex = 0;
    else if (event.key === "End") targetIndex = cards.length - 1;
    else return;
    event.preventDefault();
    targetIndex = Math.max(0, Math.min(cards.length - 1, targetIndex));
    if (targetIndex === currentIndex) {
      return;
    }
    const source = cards[currentIndex]!;
    const target = cards[targetIndex]!;
    this.#root.insertBefore(
      source,
      targetIndex < currentIndex ? target : target.nextSibling,
    );
    this.#persistVisibleOrder(instanceId);
    this.#devices.get(instanceId)?.moveHandle.focus();
  }

  #persistVisibleOrder(movedInstanceId: string): void {
    const visibleOrder = this.#visibleCards().map((card) => card.dataset.deviceInstance!);
    this.#panelOrder = updateVisibleDevicePanelOrder(this.#panelOrder, visibleOrder);
    saveDevicePanelOrder(this.#options.orderStorage ?? null, this.#panelOrder);
    this.#updateMoveHandleLabels();
    const movedIndex = visibleOrder.indexOf(movedInstanceId);
    const moved = this.#devices.get(movedInstanceId);
    if (movedIndex >= 0 && moved !== undefined && this.#reorderStatus !== null) {
      this.#reorderStatus.textContent = t("device.panelMoved", {
        device: moved.definition.title,
        position: movedIndex + 1,
        total: visibleOrder.length,
      });
    }
  }

  #updateMoveHandleLabels(): void {
    const cards = this.#visibleCards();
    cards.forEach((card, index) => {
      card.dataset.panelPosition = String(index + 1);
      const instanceId = card.dataset.deviceInstance;
      if (instanceId === undefined) {
        return;
      }
      const device = this.#devices.get(instanceId);
      if (device !== undefined) {
        device.moveHandle.setAttribute(
          "aria-label",
          t("device.movePanelAria", {
            device: device.definition.title,
            position: index + 1,
            total: cards.length,
          }),
        );
      }
    });
  }

  #visibleCards(): HTMLElement[] {
    return Array.from(this.#root.querySelectorAll<HTMLElement>(":scope > [data-device-instance]"));
  }

  #clearDropTargets(): void {
    for (const card of this.#visibleCards()) {
      card.removeAttribute("data-drop-position");
    }
  }

  #clearDragState(): void {
    this.#pointerDrag?.preview.remove();
    this.#pointerDrag = null;
    delete this.#root.dataset.reordering;
    delete document.documentElement.dataset.devicePanelDragging;
    this.#clearDropTargets();
    for (const card of this.#visibleCards()) {
      card.removeAttribute("data-dragging");
    }
  }

  #createComponent(
    entry: DeviceUiEntry,
    component: DeviceUiComponent,
  ): {
    element: HTMLElement;
    stateElement?: HTMLElement;
    pixelDisplayElement?: HTMLCanvasElement;
    sliderElement?: HTMLInputElement;
    controls: Array<HTMLButtonElement | HTMLInputElement>;
  } {
    const container = document.createElement("div");
    container.className = `device-ui-component device-ui-${component.kind}`;
    container.dataset.deviceComponent = component.id;

    const label = document.createElement("span");
    label.className = "device-ui-label";
    label.textContent = component.label;

    if (component.kind === "pixel-display") {
      const canvas = document.createElement("canvas");
      canvas.className = "device-ui-pixel-canvas";
      canvas.width = component.width;
      canvas.height = component.height;
      canvas.dataset.state = "waiting";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", component.label);
      clearPixelDisplay(canvas);
      container.append(label, canvas);
      return { element: container, pixelDisplayElement: canvas, controls: [] };
    }

    if (component.kind === "momentary-button") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = component.label;
      button.disabled = !this.#interactive;
      let pressedAt = 0;
      let releaseTimer: ReturnType<typeof setTimeout> | null = null;
      const press = (): void => {
        if (releaseTimer !== null) {
          clearTimeout(releaseTimer);
          releaseTimer = null;
        }
        pressedAt = performance.now();
        if (button.dataset.pressed === "true") {
          return;
        }
        button.dataset.pressed = "true";
        this.#sendAction(entry, component.id, true);
      };
      const release = (): void => {
        if (button.dataset.pressed !== "true") {
          return;
        }
        if (releaseTimer !== null) {
          clearTimeout(releaseTimer);
        }
        const completeRelease = (): void => {
          releaseTimer = null;
          if (button.dataset.pressed !== "true") {
            return;
          }
          button.dataset.pressed = "false";
          this.#sendAction(entry, component.id, false);
        };
        const remaining = MIN_MOMENTARY_PRESS_MS - (performance.now() - pressedAt);
        if (remaining > 0) {
          releaseTimer = setTimeout(completeRelease, remaining);
        } else {
          completeRelease();
        }
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        press();
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("keydown", (event) => {
        if ((event.key !== " " && event.key !== "Enter") || event.repeat) {
          return;
        }
        event.preventDefault();
        press();
      });
      button.addEventListener("keyup", (event) => {
        if (event.key !== " " && event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        release();
      });
      container.append(button);
      return { element: container, controls: [button] };
    }

    if (component.kind === "number-slider") {
      const input = document.createElement("input");
      const value = createStateElement();
      input.type = "range";
      input.min = String(component.minimum);
      input.max = String(component.maximum);
      input.step = String(component.step);
      input.value = String(component.minimum);
      input.disabled = !this.#interactive;
      input.setAttribute("aria-label", component.label);
      input.addEventListener("input", () => {
        const nextValue = Number(input.value);
        if (this.#sendAction(entry, component.id, nextValue)) {
          value.textContent = String(nextValue);
          value.dataset.state = "ready";
          value.removeAttribute("title");
        }
      });
      container.append(label, input, value);
      return {
        element: container,
        stateElement: value,
        sliderElement: input,
        controls: [input],
      };
    }

    if (component.kind === "text-input") {
      const form = document.createElement("form");
      form.className = "device-ui-text-form";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = component.maximumLength;
      input.disabled = !this.#interactive;
      input.setAttribute("aria-label", component.label);
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = component.submitLabel;
      submit.disabled = !this.#interactive;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (this.#sendAction(entry, component.id, input.value)) {
          input.value = "";
        }
      });
      form.append(input, submit);
      container.append(label, form);
      return { element: container, controls: [input, submit] };
    }

    const stateElement = createStateElement();
    if (component.kind === "digital-indicator") {
      stateElement.classList.add("device-ui-indicator");
      stateElement.setAttribute("role", "status");
    }
    container.append(label, stateElement);
    return { element: container, stateElement, controls: [] };
  }

  #sendAction(entry: DeviceUiEntry, componentId: string, value: unknown): boolean {
    const device = this.#devices.get(entry.instanceId);
    if (device === undefined || !this.#interactive) {
      return false;
    }
    try {
      const action = createDeviceAction(entry.definition, componentId, value);
      this.#onAction(entry.instanceId, action);
      device.actionStatus.textContent = t("device.actionSent");
      device.actionStatus.dataset.state = "sent";
      return true;
    } catch (error) {
      device.actionStatus.textContent = error instanceof Error ? error.message : String(error);
      device.actionStatus.dataset.state = "error";
      return false;
    }
  }

  #applyStateView(device: RenderedDevice, view: DeviceUiStateView): void {
    if (view.kind === "pixel-display") {
      const canvas = device.pixelDisplayElements.get(view.componentId);
      if (canvas === undefined) {
        return;
      }
      if (view.error !== undefined || typeof view.value !== "string") {
        clearPixelDisplay(canvas);
        canvas.dataset.state = "error";
        canvas.title = view.error ?? t("device.pixelInvalid");
        return;
      }
      try {
        renderRgb332Base64(canvas, view.value);
        canvas.dataset.state = "ready";
        canvas.removeAttribute("title");
      } catch (error) {
        clearPixelDisplay(canvas);
        canvas.dataset.state = "error";
        canvas.title = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const stateElement = device.stateElements.get(view.componentId);
    if (stateElement === undefined) {
      return;
    }
    stateElement.textContent = view.displayValue;
    if (view.error !== undefined) {
      stateElement.dataset.state = "error";
      stateElement.title = view.error;
    } else {
      stateElement.dataset.state = "ready";
      stateElement.removeAttribute("title");
    }
    if (view.kind === "digital-indicator" && view.active !== undefined) {
      stateElement.dataset.active = String(view.active);
    }
    if (view.kind === "number-slider" && typeof view.value === "number") {
      const slider = device.sliderElements.get(view.componentId);
      if (slider !== undefined) {
        slider.value = String(view.value);
      }
    }
  }
}

function renderRgb332Base64(canvas: HTMLCanvasElement, encoded: string): void {
  const binary = atob(encoded);
  if (binary.length !== canvas.width * canvas.height) {
    throw new RangeError(t("device.pixelLength"));
  }
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error(t("device.canvasUnavailable"));
  }
  const image = context.createImageData(canvas.width, canvas.height);
  for (let pixelIndex = 0; pixelIndex < binary.length; pixelIndex += 1) {
    const rgb332 = binary.charCodeAt(pixelIndex);
    const outputIndex = pixelIndex * 4;
    image.data[outputIndex] = Math.round(((rgb332 >> 5) & 0x07) * (255 / 7));
    image.data[outputIndex + 1] = Math.round(((rgb332 >> 2) & 0x07) * (255 / 7));
    image.data[outputIndex + 2] = Math.round((rgb332 & 0x03) * (255 / 3));
    image.data[outputIndex + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function clearPixelDisplay(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (context === null) {
    return;
  }
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function createStateElement(): HTMLElement {
  const state = document.createElement("output");
  state.className = "device-ui-value";
  state.textContent = t("device.waiting");
  state.dataset.state = "waiting";
  state.setAttribute("aria-live", "polite");
  return state;
}
