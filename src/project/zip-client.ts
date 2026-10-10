import { MAX_ZIP_BYTES, MAX_ZIP_PROCESSING_MS } from "./zip";
import { validateProjectSnapshot, type ProjectSnapshot } from "./filesystem";

export async function readProjectZip(file: File): Promise<ProjectSnapshot> {
  if (file.size > MAX_ZIP_BYTES) throw new Error("ZIP must be at most 8 MiB / ZIPは8 MiB以内にしてください");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./zip.worker.ts", import.meta.url), { type: "module" });
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { finish(); reject(new Error("ZIP processing timed out")); }, MAX_ZIP_PROCESSING_MS);
    worker.onerror = () => { finish(); reject(new Error("ZIP worker failed")); };
    worker.onmessage = event => {
      finish();
      try {
        if (!event.data?.ok) throw new Error(event.data?.error ?? "Invalid ZIP response");
        validateProjectSnapshot(event.data.project);
        resolve(event.data.project);
      } catch (error) { reject(error); }
    };
    worker.postMessage(bytes, [bytes.buffer]);
  });
}
