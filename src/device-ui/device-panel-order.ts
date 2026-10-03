export const DEVICE_PANEL_ORDER_STORAGE_KEY = "micropython-web-lab:device-panel-order:v1";

export interface DevicePanelOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredDevicePanelOrder {
  schemaVersion: 1;
  instanceIds: string[];
}

const MAX_PANEL_COUNT = 128;
const MAX_INSTANCE_ID_LENGTH = 128;

export function loadDevicePanelOrder(storage: DevicePanelOrderStorage | null): string[] {
  try {
    const value = storage?.getItem(DEVICE_PANEL_ORDER_STORAGE_KEY);
    if (value === null || value === undefined) {
      return [];
    }
    const parsed: unknown = JSON.parse(value);
    return isStoredDevicePanelOrder(parsed) ? [...parsed.instanceIds] : [];
  } catch {
    return [];
  }
}

export function saveDevicePanelOrder(
  storage: DevicePanelOrderStorage | null,
  instanceIds: readonly string[],
): void {
  if (!isValidInstanceIds(instanceIds)) {
    return;
  }
  try {
    storage?.setItem(
      DEVICE_PANEL_ORDER_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, instanceIds } satisfies StoredDevicePanelOrder),
    );
  } catch {
    // Reordering remains available for this page when browser storage is blocked.
  }
}

export function reconcileDevicePanelOrder(
  preferredOrder: readonly string[],
  availableInstanceIds: readonly string[],
): string[] {
  const next = [...preferredOrder];
  const known = new Set(next);
  for (const instanceId of availableInstanceIds) {
    if (!known.has(instanceId)) {
      known.add(instanceId);
      next.push(instanceId);
    }
  }
  return next;
}

export function updateVisibleDevicePanelOrder(
  preferredOrder: readonly string[],
  visibleInstanceIds: readonly string[],
): string[] {
  const visible = new Set(visibleInstanceIds);
  let visibleIndex = 0;
  const next = preferredOrder.map((instanceId) => {
    if (!visible.has(instanceId)) {
      return instanceId;
    }
    return visibleInstanceIds[visibleIndex++]!;
  });
  for (; visibleIndex < visibleInstanceIds.length; visibleIndex += 1) {
    next.push(visibleInstanceIds[visibleIndex]!);
  }
  return next;
}

function isStoredDevicePanelOrder(value: unknown): value is StoredDevicePanelOrder {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StoredDevicePanelOrder>;
  return candidate.schemaVersion === 1 && isValidInstanceIds(candidate.instanceIds);
}

function isValidInstanceIds(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_PANEL_COUNT) {
    return false;
  }
  const seen = new Set<string>();
  for (const instanceId of value) {
    if (
      typeof instanceId !== "string" ||
      instanceId.length === 0 ||
      instanceId.length > MAX_INSTANCE_ID_LENGTH ||
      seen.has(instanceId)
    ) {
      return false;
    }
    seen.add(instanceId);
  }
  return true;
}
