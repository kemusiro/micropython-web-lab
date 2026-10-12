import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyManagedBuild } from "./lib/managed-build.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "web-lab-managed-build-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return pathToFileURL(`${directory}/`);
}

test("allows the public FM core, licensed original sample and deployment configuration", async t => {
  const directory = await fixture(t);
  await mkdir(new URL("assets/", directory));
  await writeFile(new URL("assets/ym2203.wasm", directory), Buffer.from([0, 97, 115, 109]));
  await writeFile(new URL("assets/main.js", directory), 'const song = "Pocket Signal";');
  await writeFile(new URL("pocket-signal-LICENSE.txt", directory), "CC0-1.0");
  await writeFile(new URL(".htaccess", directory), "Options -Indexes");
  await verifyManagedBuild(directory);
});

test("rejects private markers in nested text assets and filenames", async t => {
  for (const [name, data] of [
    ["assets/main.js", 'const module = "org.example.local-bme280";'],
    ["assets/main.mjs", 'const song = "ys_ii_full_events.bin";'],
    ["assets/space_harrier_theme_test.py", "# test only"],
  ]) {
    const directory = await fixture(t);
    await mkdir(new URL("assets/", directory));
    await writeFile(new URL(name, directory), data);
    await assert.rejects(verifyManagedBuild(directory), /excluded marker/);
  }
});

test("rejects copied project archives and music dumps including renamed VGM data", async t => {
  for (const [name, data] of [
    ["test.ZIP", "compressed project data"],
    ["song.vgz", "compressed music"],
    ["song.vgm", "music"],
    ["renamed.bin", "Vgm original music data"],
  ]) {
    const directory = await fixture(t);
    await writeFile(new URL(name, directory), data);
    await assert.rejects(verifyManagedBuild(directory), /archive or music dump|private music-test data/);
  }
});

test("rejects symlinks rather than following files outside the distribution", async t => {
  const directory = await fixture(t);
  await writeFile(new URL("main.js", directory), "public script");
  await symlink("main.js", new URL("copied.js", directory));
  await assert.rejects(verifyManagedBuild(directory), /symlink/);
});
