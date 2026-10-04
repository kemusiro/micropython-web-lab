import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHtaccess, deploymentUrl, verifyResponse } from "./sakura-deployment.mjs";

export function readDeploymentAuthorization(environment) {
  const user = environment.WEB_LAB_DEPLOY_USER;
  const password = environment.WEB_LAB_DEPLOY_PASSWORD;
  if (user === undefined && password === undefined) {
    return undefined;
  }
  assert(typeof user === "string" && user.length > 0 && !/[:\r\n]/.test(user)
    && typeof password === "string" && password.length > 0 && !/[\r\n]/.test(password),
  "Set both WEB_LAB_DEPLOY_USER and WEB_LAB_DEPLOY_PASSWORD (nonempty; no newline or colon in user)");
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

export async function verifyDeployment({
  url,
  dist,
  authorization,
  fetchImpl = fetch,
  log = console.log,
}) {
  const base = deploymentUrl(url);
  assert(await readFile(new URL(".htaccess", dist), "utf8") === createHtaccess(),
    "Rebuild with pnpm build:sakura: dist/.htaccess is stale");
  const files = await readdir(dist, { recursive: true, withFileTypes: true });
  const paths = files.filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => relative(fileURLToPath(dist), join(entry.parentPath, entry.name)).split("\\").join("/"));
  assert(paths.includes("index.html") && paths.some((file) => file.endsWith(".wasm")),
    "Build with pnpm build:sakura before verification");

  // Never send credentials over HTTP or follow a redirect with Authorization.
  const get = (target, authenticated = true) => fetchImpl(target, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    headers: authorization && authenticated && target.protocol === "https:"
      && target.origin === base.origin ? { Authorization: authorization } : {},
  });

  // Check HTTPS forwarding first, without credentials, even during a rehearsal.
  const http = new URL(base);
  http.protocol = "http:";
  const redirect = await get(http, false);
  await redirect.body?.cancel();
  assert([301, 302, 307, 308].includes(redirect.status), "HTTP must redirect to HTTPS before authentication");
  assert(new URL(redirect.headers.get("location"), http).href === base.href,
    "HTTP must redirect directly to the canonical HTTPS deployment URL");

  for (const file of ["", ...paths]) {
    const local = file || "index.html";
    const target = new URL(file, base);
    if (authorization) {
      const anonymous = await get(target, false);
      await anonymous.body?.cancel();
      assert.equal(anonymous.status, 401, `${local}: anonymous access must return 401`);
      assert(/^Basic\s/i.test(anonymous.headers.get("www-authenticate") ?? ""),
        `${local}: missing Basic authentication challenge`);
    }
    const response = await get(target);
    verifyResponse(response, local, await readFile(new URL(local, dist)),
      Buffer.from(await response.arrayBuffer()));
    log(`OK ${file || "(directory index)"}`);
  }
  const missing = await get(new URL(`missing-${randomUUID()}.wasm`, base));
  await missing.body?.cancel();
  assert.equal(missing.status, 404, "Missing assets must return 404, not an HTML fallback");
  const hidden = await get(new URL(".htaccess", base));
  await hidden.body?.cancel();
  assert([403, 404].includes(hidden.status), ".htaccess must not be downloadable");
  log("Deployment verified. Complete the browser checks in docs/deployment.md.");
}
