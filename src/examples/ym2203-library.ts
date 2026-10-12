import driverSource from "../drivers/web_lab_ym2203_v1.py?raw";
import scoreSource from "../drivers/web_lab_ym2203_score_v1.py?raw";
import toneSource from "../drivers/web_lab_ym2203_tone_v1.py?raw";
import mmlSource from "../drivers/web_lab_ym2203_mml_v1.py?raw";
import binSource from "../drivers/web_lab_ym2203_bin_v1.py?raw";
import { ym2203DemoBin, YM2203_DEMO_BIN_PATH } from "./ym2203-samples";
import previousDriver from "../drivers/pre-long-playback/web_lab_ym2203_v1.py?raw";
import previousScore from "../drivers/pre-long-playback/web_lab_ym2203_score_v1.py?raw";
import smallQueueDriver from "../drivers/pre-large-reservations/web_lab_ym2203_v1.py?raw";
import smallQueueScore from "../drivers/pre-large-reservations/web_lab_ym2203_score_v1.py?raw";
import { ProjectFiles, type ProjectSnapshot } from "../project/filesystem";
import type { EditorWorkspaceTab } from "../project/editor-draft";

export const YM2203_DRIVER_SOURCE = driverSource;
export const YM2203_DRIVER_PATH = "lib/web_lab_ym2203_v1.py";
export const YM2203_SCORE_SOURCE = scoreSource;
export const YM2203_SCORE_PATH = "lib/web_lab_ym2203_score_v1.py";
export const YM2203_TONE_SOURCE = toneSource;
export const YM2203_TONE_PATH = "lib/web_lab_ym2203_tone_v1.py";

export const YM2203_MML_SOURCE = mmlSource;
export const YM2203_MML_PATH = "lib/web_lab_ym2203_mml_v1.py";
export const YM2203_BIN_SOURCE = binSource;
export const YM2203_BIN_PATH = "lib/web_lab_ym2203_bin_v1.py";

function libraryPaths(score: boolean, tone: boolean, player?: "mml" | "bin"): [string, string][] {
  return [[YM2203_DRIVER_PATH, driverSource],
    ...(score || tone ? [[YM2203_SCORE_PATH, scoreSource]] as [string, string][] : []),
    ...(tone ? [[YM2203_TONE_PATH, toneSource]] as [string, string][] : []),
    ...(player ? [[player === "mml" ? YM2203_MML_PATH : YM2203_BIN_PATH, player === "mml" ? mmlSource : binSource]] as [string, string][] : [])];
}

export class YmLibraryConflict extends Error {
  constructor(readonly paths: string[]) {
    super(`既存の音源ドライバーと競合しています。対象: ${paths.join(", ")}。バックアップして更新するか、ファイルを別名で保存してください。 / Existing sound driver conflicts: ${paths.join(", ")}. Back up and update, or rename the files.`);
  }
}

/** Prepare a copy first: quota failures and conflicts cannot overwrite user files. */
export function prepareYm2203Library(files: ProjectFiles, tabs: readonly EditorWorkspaceTab[], score = false, tone = false, player?: "mml" | "bin"): ProjectSnapshot {
  const next = new ProjectFiles(files.snapshot());
  const libraries = libraryPaths(score, tone, player);
  const conflicts = new Set<string>();
  for (const [path, source] of libraries) {
    const module = path.slice(4, -3);
    const rootModule = files.get(`${module}.py`) ?? files.get(module);
    const existing = files.get(path);
    const previous = path === YM2203_DRIVER_PATH ? [previousDriver, smallQueueDriver]
      : path === YM2203_SCORE_PATH ? [previousScore, smallQueueScore] : [];
    const stored = existing?.kind === "file" ? new TextDecoder().decode(existing.data) : undefined;
    const edited = tabs.some(tab => (tab.path === path && tab.source !== source && !(stored !== undefined && previous.includes(stored) && tab.source === stored)) ||
      tab.path === `${module}.py` || tab.path?.startsWith(`${module}/`) === true);
    if (rootModule || files.get(`lib/${module}`) || edited ||
        (existing && (existing.kind !== "file" || (stored !== source && !previous.includes(stored!))))) {
      if (rootModule) conflicts.add(rootModule.path);
      if (files.get(`lib/${module}`)) conflicts.add(`lib/${module}`);
      if (existing && (existing.kind !== "file" || (stored !== source && !previous.includes(stored!)))) conflicts.add(path);
      for (const tab of tabs) if (tab.path === path || tab.path === `${module}.py` || tab.path?.startsWith(`${module}/`)) conflicts.add(tab.path!);
      continue;
    }
    if (stored !== source) next.write(path, new TextEncoder().encode(source));
  }
  if (player === "bin") {
    const demo = ym2203DemoBin(), existing = files.get(YM2203_DEMO_BIN_PATH);
    if (existing && (existing.kind !== "file" || existing.data.length !== demo.length || !existing.data.every((v, i) => v === demo[i]))) conflicts.add(YM2203_DEMO_BIN_PATH);
    else if (!existing) next.write(YM2203_DEMO_BIN_PATH, demo);
  }
  if (conflicts.size) throw new YmLibraryConflict([...conflicts]);
  return next.snapshot();
}

/** Explicit recovery: preserve both stored bytes and unsaved drafts, then install. */
export function backupYm2203Library(files: ProjectFiles, tabs: readonly EditorWorkspaceTab[], score = false, tone = false, player?: "mml" | "bin") {
  const next = new ProjectFiles(files.snapshot());
  const roots = libraryPaths(score, tone, player).flatMap(([path]) => {
    const module = path.slice(4, -3);
    return [path, `lib/${module}`, `${module}.py`, module];
  });
  if (player === "bin") roots.push(YM2203_DEMO_BIN_PATH);
  let index = 1;
  while (next.get(`ym2203-backups/${index}`)) index++;
  const backupPath = `ym2203-backups/${index}`;
  next.mkdir(backupPath);
  for (const root of roots) if (next.get(root)) next.rename(root, `${backupPath}/files/${root}`);
  const movedTabs = tabs.map((tab, tabIndex) => {
    if (!tab.path || !roots.some(root => tab.path === root || tab.path!.startsWith(root + "/"))) return { ...tab };
    const stored = files.get(tab.path);
    const isSaved = stored?.kind === "file" && tab.source === new TextDecoder().decode(stored.data);
    const path = isSaved ? `${backupPath}/files/${tab.path}` : `${backupPath}/drafts/${tabIndex}/${tab.path}`;
    if (!isSaved) next.write(path, new TextEncoder().encode(tab.source));
    return { ...tab, path };
  });
  return { snapshot: prepareYm2203Library(next, movedTabs, score, tone, player), tabs: movedTabs, backupPath };
}
