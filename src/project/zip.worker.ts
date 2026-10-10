/// <reference lib="webworker" />
import { importProjectZip } from "./zip";
self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  try { self.postMessage({ ok: true, project: await importProjectZip(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
