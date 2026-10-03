import type {
  RuntimeDeviceState,
  RuntimeStatus,
  ScriptExecutionMode,
} from "../runtime/protocol";

export interface OptionalContentContext {
  readonly mountBefore: HTMLElement;
  readonly openEditorTab: (title: string, source: string) => void;
}

export interface OptionalContentIntegration {
  initialize(): void | Promise<void>;
  editorChanged(source: string): void;
  executionStarted(source: string, mode: ScriptExecutionMode): void;
  stdout(data: string): void;
  deviceState(state: RuntimeDeviceState): void;
  executionFinished(ok: boolean): void;
  runtimeStatusChanged(status: RuntimeStatus): void;
}

const NOOP_INTEGRATION: OptionalContentIntegration = Object.freeze({
  initialize() {},
  editorChanged() {},
  executionStarted() {},
  stdout() {},
  deviceState() {},
  executionFinished() {},
  runtimeStatusChanged() {},
});

export function createNoopOptionalContentIntegration(
  _context: OptionalContentContext,
): OptionalContentIntegration {
  return NOOP_INTEGRATION;
}
