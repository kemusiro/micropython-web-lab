import { readFile } from "node:fs/promises";

import {
  DEVELOPMENT_SECURITY_HEADERS,
  SECURITY_HEADERS,
} from "../config/security-headers.mjs";

const nginxConfiguration = await readFile(
  new URL("../deploy/nginx/security-headers.conf", import.meta.url),
  "utf8",
);

const configuredHeaders = new Map();
for (const line of nginxConfiguration.trim().split("\n")) {
  const match = /^add_header ([A-Za-z0-9-]+) "([^"]*)" always;$/.exec(line);
  if (match === null) {
    throw new Error(`Invalid Nginx security header directive: ${line}`);
  }
  configuredHeaders.set(match[1], match[2]);
}

for (const [name, expectedValue] of Object.entries(SECURITY_HEADERS)) {
  const actualValue = configuredHeaders.get(name);
  if (actualValue !== expectedValue) {
    throw new Error(
      `Nginx header did not match ${name}. Expected ${expectedValue}, received ${String(actualValue)}.`,
    );
  }
  configuredHeaders.delete(name);
}

if (configuredHeaders.size > 0) {
  throw new Error(
    `Nginx has untracked security headers: ${[...configuredHeaders.keys()].join(", ")}`,
  );
}

if (!SECURITY_HEADERS["Content-Security-Policy"].includes("'wasm-unsafe-eval'")) {
  throw new Error("CSP must explicitly allow WebAssembly compilation.");
}
if (SECURITY_HEADERS["Content-Security-Policy"].includes("'unsafe-eval'")) {
  throw new Error("CSP must not allow general JavaScript string evaluation.");
}
if (SECURITY_HEADERS["Content-Security-Policy"].includes("'unsafe-inline'")) {
  throw new Error("Production CSP must not allow inline scripts or styles.");
}
if (!DEVELOPMENT_SECURITY_HEADERS["Content-Security-Policy"].includes("connect-src 'self' ws:")) {
  throw new Error("Development CSP must allow Vite's WebSocket connection.");
}
if (
  !DEVELOPMENT_SECURITY_HEADERS["Content-Security-Policy"].includes(
    "style-src 'self' 'unsafe-inline'",
  )
) {
  throw new Error("Development CSP must allow Vite's injected style elements.");
}
if (!DEVELOPMENT_SECURITY_HEADERS["Content-Security-Policy"].includes("style-src-attr 'none'")) {
  throw new Error("Development CSP must continue to block inline style attributes.");
}

console.log(`Security headers verified: ${Object.keys(SECURITY_HEADERS).length} headers`);
