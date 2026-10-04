import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readDeploymentAuthorization, verifyDeployment } from "./lib/verify-deployment.mjs";
import { SECURITY_HEADERS } from "../config/security-headers.mjs";
import { createHtaccess, deploymentUrl, verifyResponse } from "./lib/sakura-deployment.mjs";

test("Apache configuration preserves every production header without silent fallback", () => {
  const config = createHtaccess();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert(config.includes(`Header onsuccess unset ${name}\nHeader always set ${name} "${value}"`));
  }
  assert(config.includes("AddType application/wasm .wasm"));
  assert(config.includes("Options -Indexes -MultiViews"));
  assert(config.includes('<FilesMatch "^\\.">\n  Require all denied'));
  assert(!config.includes("IfModule"));
  assert(!config.includes("RewriteRule"));
  assert(!config.includes("Require all granted"));
});

test("deployment URL supports root and subdirectory but rejects ambiguous inputs", () => {
  for (const url of ["https://example.com/", "https://example.com/lab/"]) {
    assert.equal(deploymentUrl(url).href, url);
  }
  for (const url of ["http://example.com/", "https://example.com/lab", "https://u:p@example.com/",
    "https://example.com/?q=1", "https://example.com/#x"]) {
    assert.throws(() => deploymentUrl(url));
  }
});

test("verification catches incorrect MIME, missing or duplicate isolation headers, stale content and HTTP errors", () => {
  const body = Buffer.from([0, 97, 115, 109]);
  const headers = { ...SECURITY_HEADERS, "Content-Type": "application/wasm", "Cache-Control": "no-cache" };
  const verify = (changes = {}, status = 200, actual = body) => verifyResponse(
    new Response(null, { status, headers: { ...headers, ...changes } }), "runtime.wasm", body, actual);
  verify();
  assert.throws(() => verify({ "Content-Type": "text/html" }));
  assert.throws(() => verify({ "Cross-Origin-Embedder-Policy": "" }));
  assert.throws(() => verify({ "Cross-Origin-Opener-Policy": "same-origin, same-origin" }));
  assert.throws(() => verify({}, 404));
  assert.throws(() => verify({}, 200, Buffer.from("stale")));
  assert.throws(() => verify({ "Cache-Control": "public" }));
});

test("Basic credentials must be supplied together and never appear in validation errors", () => {
  assert.equal(readDeploymentAuthorization({}), undefined);
  assert.equal(readDeploymentAuthorization({ WEB_LAB_DEPLOY_USER: "example-user", WEB_LAB_DEPLOY_PASSWORD: "example:password" }),
    `Basic ${Buffer.from("example-user:example:password").toString("base64")}`);
  for (const environment of [
    { WEB_LAB_DEPLOY_USER: "example-secret" },
    { WEB_LAB_DEPLOY_PASSWORD: "example-secret" },
    { WEB_LAB_DEPLOY_USER: "", WEB_LAB_DEPLOY_PASSWORD: "example-secret" },
    { WEB_LAB_DEPLOY_USER: "bad:user", WEB_LAB_DEPLOY_PASSWORD: "example-secret" },
    { WEB_LAB_DEPLOY_USER: "example-user", WEB_LAB_DEPLOY_PASSWORD: "example-secret\n" },
  ]) {
    assert.throws(() => readDeploymentAuthorization(environment), (error) => {
      assert(!error.message.includes("example-secret"));
      return true;
    });
  }
  assert.throws(() => deploymentUrl("https://example-secret@"), (error) => {
    assert(!error.message.includes("example-secret"));
    return true;
  });
});

async function fixture(t, { restricted = false, failure, prefix = "/lab/" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "web-lab-deployment-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = pathToFileURL(`${directory}/`);
  await mkdir(new URL("assets/", dist));
  const files = new Map([
    ["index.html", "<!doctype html><html></html>"],
    ["assets/worker.js", "postMessage('ready')"],
    ["assets/runtime.wasm", "wasm-fixture"],
    ["assets/app.css", "body {}"],
  ]);
  await writeFile(new URL(".htaccess", dist), createHtaccess());
  for (const [name, body] of files) await writeFile(new URL(name, dist), body);
  const authorization = restricted ? readDeploymentAuthorization({
    WEB_LAB_DEPLOY_USER: "example-user", WEB_LAB_DEPLOY_PASSWORD: "example-password",
  }) : undefined;
  const calls = [];
  const log = [];
  const url = `https://example.com${prefix}`;
  const fetchImpl = async (target, options) => {
    calls.push({ target, options });
    assert.equal(options.redirect, "manual");
    assert(options.signal instanceof AbortSignal);
    if (options.headers.Authorization) assert.equal(options.headers.Authorization, authorization);
    const file = target.pathname.slice(prefix.length) || "index.html";
    if (target.protocol === "http:") {
      assert.equal(options.headers.Authorization, undefined);
      return new Response(null, { status: 302, headers: { Location: url } });
    }
    if (failure === "redirect" && options.headers.Authorization) {
      return new Response(null, { status: 302, headers: { Location: "https://other.example/" } });
    }
    if (restricted && !options.headers.Authorization
      && !(failure === "exposed-wasm" && file.endsWith(".wasm"))) {
      return new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="rehearsal"' } });
    }
    if (failure === "wrong-password" && options.headers.Authorization) {
      return new Response(null, { status: 401 });
    }
    if (file === ".htaccess") return new Response(null, { status: 403 });
    if (!files.has(file)) return new Response(null, { status: failure === "fallback" ? 200 : 404 });
    const mime = { html: "text/html", js: "text/javascript", wasm: "application/wasm", css: "text/css" };
    return new Response(failure === "stale" ? "old release" : files.get(file), {
      headers: { ...SECURITY_HEADERS, "Cache-Control": "no-cache", "Content-Type": mime[file.split(".").at(-1)] },
    });
  };
  return { options: { url, dist, authorization, fetchImpl, log: (message) => log.push(message) }, calls, log };
}

test("full verification supports public root and Basic-protected subdirectory", async (t) => {
  for (const options of [{ prefix: "/" }, { restricted: true }]) {
    const setup = await fixture(t, options);
    await verifyDeployment(setup.options);
    assert(setup.log.at(-1).startsWith("Deployment verified"));
    assert(!setup.log.join("\n").includes("example-password"));
    if (options.restricted) {
      const https = setup.calls.filter(({ target }) => target.protocol === "https:");
      assert.equal(https.filter(({ options }) => !options.headers.Authorization).length, 5);
      assert.equal(https.filter(({ options }) => options.headers.Authorization).length, 7);
      assert(https.every(({ target }) => target.origin === "https://example.com"));
    }
  }
});

test("verification fails for exposed assets, invalid credentials, redirects, stale releases and SPA fallbacks", async (t) => {
  for (const failure of ["exposed-wasm", "wrong-password", "redirect", "stale", "fallback"]) {
    const setup = await fixture(t, { restricted: true, failure });
    await assert.rejects(verifyDeployment(setup.options));
    assert(setup.calls.every(({ target }) => target.hostname === "example.com"));
    assert(!setup.log.some((line) => line.startsWith("Deployment verified")));
  }
});
