import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SECURITY_HEADERS } from "../../config/security-headers.mjs";

// Test-only, loopback-only server. Fault injection never changes deployed files.
export async function browserFixture(directory = "dist") {
  const root = path.resolve(directory);
  let fault = "none";
  const server = createServer(async (request, response) => {
    const headers = { ...SECURITY_HEADERS, "Cache-Control": "no-store" };
    if (fault === "isolation") {
      delete headers["Cross-Origin-Opener-Policy"];
      delete headers["Cross-Origin-Embedder-Policy"];
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!file.startsWith(`${root}${path.sep}`) || pathname.split("/").some((part) => part.startsWith("."))) {
        response.writeHead(404, headers).end();
        return;
      }
      if ((fault === "wasm" && file.endsWith(".wasm")) ||
          (fault === "worker" && /worker-[^/\\]+\.js$/.test(file))) {
        response.writeHead(503, headers).end("Injected test failure");
        return;
      }
      const body = await readFile(file);
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };
      response.writeHead(200, { ...headers, "Content-Type": mime[path.extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404, headers).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    setFault(value) {
      if (!["none", "isolation", "wasm", "worker"].includes(value)) throw new Error("Unknown fault");
      fault = value;
    },
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}
