import type { EmscriptenFs } from "../../runtime/project-filesystem";
export interface MicroPythonLoadOptions {
  url?: string;
  pystack?: number;
  heapsize?: number;
  linebuffer?: boolean;
  stdin?: () => number | null;
  stdout?: (data: Uint8Array) => void;
  stderr?: (data: Uint8Array) => void;
}

export interface BuiltMicroPythonInstance {
  FS: EmscriptenFs;
  pyimport<T = unknown>(name: string): T;
  registerJsModule(name: string, module: object): void;
  runPython(code: string): unknown;
  runPythonAwaitable(code: string): Promise<unknown>;
  replProcessCharWithAsyncify(character: number): Promise<number>;
  replInit(): void;
  replProcessChar(character: number): number;
}

export function loadMicroPython(
  options?: MicroPythonLoadOptions,
): Promise<BuiltMicroPythonInstance>;
