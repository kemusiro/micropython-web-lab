import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const forbiddenMarkers = [
  "org.example.i2c-register-template",
  "I2C Register Template",
  "templates/device/i2c-register",
  "WEB_LAB_LOCAL_DEVICE_ENTRYPOINT",
  "WEB_LAB_LOCAL_CONFIGURATION_PATH",
  "org.example.local-bme280",
  "org.example.local-ssd1331",
  "fixtures/local-devices",
  ["github.com/kemusiro/", "micropython-book"].join(""),
  ["book-lab-", "content-v1"].join(""),
  ["0fe1ea0e", "f95d2c86152e1891294d3e34d2af1c4d"].join(""),
  ["LED", "スイッチ"].join(""),
  "ys_ii_full_events",
  "ys_ii_full_test",
  "ys_ii_theme_test",
  "space_harrier_theme_test",
];

// Exact local test data also fails if someone renames the binary asset.
// These hashes identify test inputs; they do not grant redistribution rights.
const privateMusicHashes = new Set([
  "d32bfc04787eb9ee58349ba3efb32a6b872cfd2daf9f6adc6dcfdd3dcca35f96",
  "506fe42861eece45c7b675d53eaa16981dbef3ec067ef98f82f5c47d3b34628c",
]);

export async function verifyManagedBuild(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name, directory);
    if (entry.isSymbolicLink()) throw new Error(`Managed build contains a symlink: ${entry.name}`);
    if (entry.isDirectory()) {
      await verifyManagedBuild(new URL(`${entry.name}/`, directory));
      continue;
    }
    // Public Web Lab has no bundled project ZIPs or game-music dumps.
    // Importing a user's project at runtime is independent of this build check.
    if (/\.(?:zip|vgm|vgz)$/i.test(entry.name)) {
      throw new Error(`Managed build contains a project archive or music dump: ${entry.name}`);
    }
    const data = await readFile(url);
    if (data.subarray(0, 4).equals(Buffer.from("Vgm ")) ||
        privateMusicHashes.has(createHash("sha256").update(data).digest("hex"))) {
      throw new Error(`Managed build contains private music-test data: ${entry.name}`);
    }
    const content = /\.(?:html|css|js|mjs|json|py|txt)$/i.test(entry.name) ? data.toString("utf8") : "";
    for (const marker of forbiddenMarkers) {
      if (entry.name.includes(marker) || content.includes(marker)) {
        throw new Error(`Managed build contains excluded marker ${marker} in ${entry.name}`);
      }
    }
  }
}
