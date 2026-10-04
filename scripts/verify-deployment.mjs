import assert from "node:assert/strict";

import { readDeploymentAuthorization, verifyDeployment } from "./lib/verify-deployment.mjs";

try {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  assert.equal(args.length, 1, "Usage: pnpm verify:deployment -- https://example.com/lab/");
  await verifyDeployment({
    url: args[0],
    dist: new URL("../dist/", import.meta.url),
    authorization: readDeploymentAuthorization(process.env),
  });
} catch (error) {
  // Do not dump request objects, response bodies, credentials, or fetch causes.
  console.error(error instanceof Error ? error.message : "Deployment verification failed");
  process.exitCode = 1;
}
