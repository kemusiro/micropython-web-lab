import { readFile } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const packageJson = await readJson(new URL("package.json", repositoryRoot));
const notices = await readFile(new URL("THIRD_PARTY_NOTICES.md", repositoryRoot), "utf8");

const workspaceDependencies = {
  "@micropython-web-lab/device-api": "workspace:*",
  "@micropython-web-lab/device-testkit": "workspace:*",
};

const thirdPartyDependencies = {
  "@playwright/test": { version: "1.62.1", license: "Apache-2.0" },
  typescript: { version: "7.0.2", license: "Apache-2.0" },
  vite: { version: "8.2.2", license: "MIT" },
  vitest: { version: "4.1.11", license: "MIT" },
};

const runtimeDependencies = Object.keys(packageJson.dependencies ?? {});
if (runtimeDependencies.length > 0) {
  throw new Error(
    `Runtime npm dependencies require a publication review: ${runtimeDependencies.join(", ")}`,
  );
}

const expectedDevelopmentDependencies = {
  ...workspaceDependencies,
  ...Object.fromEntries(
    Object.entries(thirdPartyDependencies).map(([name, metadata]) => [name, metadata.version]),
  ),
};
const actualDevelopmentDependencies = packageJson.devDependencies ?? {};
assertExactRecord(
  actualDevelopmentDependencies,
  expectedDevelopmentDependencies,
  "direct development dependencies",
);

for (const [name, expected] of Object.entries(thirdPartyDependencies)) {
  const installed = await readJson(
    new URL(`node_modules/${name}/package.json`, repositoryRoot),
  );
  if (installed.version !== expected.version) {
    throw new Error(
      `${name} installed version is ${installed.version}; expected ${expected.version}`,
    );
  }
  if (installed.license !== expected.license) {
    throw new Error(
      `${name} license is ${installed.license}; expected ${expected.license}`,
    );
  }

  const noticeRow = `| \`${name}\` | ${expected.version} | ${expected.license} |`;
  if (!notices.includes(noticeRow)) {
    throw new Error(`THIRD_PARTY_NOTICES.md is missing the audited row for ${name}`);
  }
}

for (const requiredNotice of [
  "Raspberry Pi is a trademark of Raspberry Pi Ltd.",
  "docs/devices/ae-bme280.md",
  "docs/devices/qt095b-ssd1331.md",
  "docs/devices/gt-502mgg-n.md",
  "docs/devices/ostamc5a31a-vv.md",
]) {
  if (!notices.includes(requiredNotice)) {
    throw new Error(`THIRD_PARTY_NOTICES.md is missing required notice: ${requiredNotice}`);
  }
}

console.log(
  `Third-party notices verified: ${Object.keys(thirdPartyDependencies).length} direct tools; ` +
    "0 runtime npm dependencies; device sources and trademark acknowledgment present",
);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function assertExactRecord(actual, expected, label) {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      `Unexpected ${label}. Audit package.json and THIRD_PARTY_NOTICES.md before updating this check.`,
    );
  }
}
