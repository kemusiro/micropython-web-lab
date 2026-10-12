import { verifyManagedBuild } from "./lib/managed-build.mjs";

await verifyManagedBuild(new URL("../dist/", import.meta.url));
console.log("Managed build verified: no local Device, private optional-content or music-test assets");
