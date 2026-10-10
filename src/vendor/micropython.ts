import { loadMicroPython as loadRestrictedMicroPython } from "./micropython-build/micropython.mjs";
import wasmUrl from "./micropython-build/micropython.wasm?url";
import type { EmscriptenFs } from "../runtime/project-filesystem";

export const MICROPYTHON_SOURCE_VERSION = "1.28.0";
export const MICROPYTHON_SOURCE_COMMIT = "e0e9fbb17ed6fd06bb76e266ae554784c9c80804";
export const MICROPYTHON_BUILD_VARIANT = "web-lab-restricted";

export interface MicroPythonLoadOptions {
  heapsize?: number;
  linebuffer?: boolean;
  stdout?: (data: Uint8Array) => void;
  stderr?: (data: Uint8Array) => void;
}

export interface MicroPythonInstance {
  FS: EmscriptenFs;
  pyimport<T = unknown>(name: string): T;
  registerJsModule(name: string, module: object): void;
  runPython(code: string): unknown;
  runPythonAwaitable(code: string): Promise<unknown>;
  replProcessCharWithAsyncify(character: number): Promise<number>;
  replInit(): void;
  replProcessChar(character: number): number;
}

export async function loadMicroPython(
  options: MicroPythonLoadOptions,
): Promise<MicroPythonInstance> {
  return loadRestrictedMicroPython({ ...options, url: wasmUrl });
}
