import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const distributionDirectory = new URL("../dist/", import.meta.url);
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
];

for (const filePath of await listTextAssets(distributionDirectory)) {
  const content = await readFile(filePath, "utf8");
  for (const marker of forbiddenMarkers) {
    if (content.includes(marker)) {
      throw new Error(`Managed build contains local Device marker ${marker} in ${filePath}.`);
    }
  }
}

console.log("Managed build verified: no local Device or private optional-content markers");

async function listTextAssets(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      result.push(...(await listTextAssets(new URL(`${entry.name}/`, directory))));
    } else if (/\.(?:html|css|js|json)$/.test(entry.name)) {
      result.push(fileURLToPath(entryPath));
    }
  }
  return result;
}
