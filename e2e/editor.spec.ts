import { expect, test } from "./workspace-test";
import { test as firstUseTest } from "@playwright/test";

firstUseTest("matches editor decorations to the narrow first-experiment screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-app-screen", "experiment");
  await page.locator("#code-editor").fill("from machine import Pin\npass");
  await expect(page.locator("#editor-highlighted-code .python-keyword")).toHaveText(["from", "import", "pass"]);
  expect(await page.evaluate(() => {
    const input = getComputedStyle(document.querySelector("#code-editor")!);
    const highlight = getComputedStyle(document.querySelector("#editor-highlighted-code")!);
    const gutter = getComputedStyle(document.querySelector(".editor-gutter")!);
    return input.font === highlight.font && input.font === gutter.font;
  })).toBe(true);
});

test("highlights Python safely and follows the caret and trailing empty line", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator("#code-editor");
  const source = '# if <img src=x onerror="alert(1)">\nif True:\n    print("for return")\n';
  await editor.fill(source);
  const highlight = page.locator("#editor-highlighted-code");
  await expect(highlight.locator(".python-keyword")).toHaveText(["if", "True"]);
  await expect(highlight.locator(".python-string")).toHaveText('"for return"');
  await expect(highlight.locator("img")).toHaveCount(0);
  await expect(page.locator(".editor-line-number")).toHaveCount(4);
  await expect(page.locator('.editor-line-number[data-line="4"]')).toHaveText("●➜4");
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(element.value.indexOf("    print"), element.value.indexOf("    print"));
  });
  const caret = page.locator("#editor-cursor-line");
  await expect(caret).toBeVisible();
  await expect(caret).toHaveAttribute("data-line", "3");
  await editor.press("ArrowUp");
  await expect(caret).toHaveAttribute("data-line", "2");
  await editor.press("Tab");
  await expect(highlight.locator(".python-keyword")).toHaveText(["if", "True"]);
  await page.locator("#open-device-configuration").focus();
  await expect(caret).toBeHidden();
});

test("keeps highlighting and line numbers aligned while scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const editor = page.locator("#code-editor");
  await editor.fill(Array.from({ length: 100 }, (_, index) => `value_${index} = "${"x".repeat(180)}"`).join("\n"));
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 0);
    element.scrollTop = 400;
    element.scrollLeft = 300;
  });
  await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBe(400);
  await expect.poll(() => page.locator("#editor-line-numbers").evaluate((element) => element.style.transform))
    .toBe("translateY(-400px)");
  await expect.poll(() => page.locator("#editor-highlighted-code").evaluate((element) => element.style.transform))
    .toBe("translate(-300px, -400px)");
  const alignment = await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>("#code-editor")!;
    const pre = document.querySelector<HTMLElement>("#editor-highlighted-code")!;
    const row = document.querySelector<HTMLElement>('.editor-line-number[data-line="30"]')!;
    const style = getComputedStyle(input);
    const inputBox = input.getBoundingClientRect();
    const textTop = inputBox.top + parseFloat(style.paddingTop) + 29 * parseFloat(style.lineHeight) - input.scrollTop;
    const preBox = pre.getBoundingClientRect();
    return {
      lineDifference: Math.abs(row.getBoundingClientRect().top - textTop),
      horizontalDifference: Math.abs(preBox.left - (inputBox.left - input.scrollLeft)),
      fontMatches: getComputedStyle(pre).font === style.font,
    };
  });
  expect(alignment.lineDifference).toBeLessThan(1);
  expect(alignment.horizontalDifference).toBeLessThan(1);
  expect(alignment.fontMatches).toBe(true);
  await expect(page.locator(".editor-line-number")).toHaveCount(100);
});

test("refreshes editor decorations when switching tabs and restoring saved code", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  const editor = page.locator("#code-editor");
  await editor.fill("if True:\n    pass\n");
  await page.getByRole("button", { name: "新しいタブ", exact: true }).click();
  await expect(page.locator(".editor-line-number")).toHaveCount(1);
  await expect(page.locator("#editor-highlighted-code .python-keyword")).toHaveCount(0);
  await editor.fill("for value in range(3):\n    pass");
  await page.locator('[data-editor-tab="main"]').click();
  await expect(page.locator(".editor-line-number")).toHaveCount(3);
  await expect(page.locator("#editor-highlighted-code .python-keyword")).toHaveText(["if", "True", "pass"]);
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
  await page.reload();
  await expect(editor).toHaveValue("if True:\n    pass\n");
  await expect(page.locator(".editor-line-number")).toHaveCount(3);
  await expect(page.locator("#editor-highlighted-code .python-keyword")).toHaveText(["if", "True", "pass"]);
});

test("bounds the gutter for documents with many empty lines", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator("#code-editor");
  // Set the source as draft restoration does; this checks decoration capacity
  // independently of simulated typing for a maximum-sized document.
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.value = "\n".repeat(199_999);
    element.setSelectionRange(0, 0);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#editor-code-area")).toHaveAttribute("data-line-count", "200000");
  expect(await page.locator(".editor-line-number").count()).toBeLessThan(100);
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('.editor-line-number[data-line="200000"]')).toHaveCount(1);
  expect(await page.locator(".editor-line-number").count()).toBeLessThan(100);
});

test("shows actual pdb breakpoints, reveals the paused line, and clears decorations on exit", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  const editor = page.locator("#code-editor");
  const source = ["value = 1", ...Array.from({ length: 80 }, () => "value += 1"), 'print("done", value)'].join("\n");
  await editor.fill(source);
  await page.getByRole("button", { name: "デバッグ実行", exact: true }).click();
  await expect(page.locator('.editor-line-number[data-current="true"]')).toHaveAttribute("data-line", "1");
  const input = page.getByLabel("pdbコマンド");
  const send = async (command: string) => {
    await input.fill(command);
    await input.press("Enter");
  };
  await send("break 75");
  await expect(page.locator('.editor-line-number[data-breakpoint="true"]')).toHaveAttribute("data-line", "75");
  await send("break 999");
  await expect(page.locator("#terminal")).toContainText("行番号がソース範囲外");
  await expect(page.locator('.editor-line-number[data-breakpoint="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "続行", exact: true }).click();
  const row = page.locator('.editor-line-number[data-line="75"]');
  await expect(row).toHaveAttribute("data-current", "true");
  await expect(row).toHaveAttribute("data-breakpoint", "true");
  await expect(row.locator(".editor-breakpoint-marker")).toBeVisible();
  await expect(row.locator(".editor-execution-marker")).toBeVisible();
  await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator("#debug-current-line")).toHaveAttribute("data-line", "75");
  const rowBox = await row.boundingBox();
  const markerBox = await page.locator("#debug-current-line").boundingBox();
  expect(Math.abs(rowBox!.y - markerBox!.y)).toBeLessThan(1);
  await page.locator("#editor-debug-workspace").screenshot({ path: test.info().outputPath("debug-editor.png") });
  await send("clear 75");
  await expect(row).toHaveAttribute("data-breakpoint", "false");
  await send("b 80");
  await expect(page.locator('.editor-line-number[data-breakpoint="true"]')).toHaveAttribute("data-line", "80");
  await send("cl");
  await expect(page.locator('.editor-line-number[data-breakpoint="true"]')).toHaveCount(0);
  await send("b 81");
  await expect(page.locator('.editor-line-number[data-breakpoint="true"]')).toHaveAttribute("data-line", "81");
  await page.getByRole("button", { name: "続行", exact: true }).click();
  await expect(page.locator("#debug-current-line")).toHaveAttribute("data-line", "81");
  await page.getByRole("button", { name: "続行", exact: true }).click();
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await expect(page.locator('.editor-line-number[data-breakpoint="true"]')).toHaveCount(0);
  await expect(page.locator('.editor-line-number[data-current="true"]')).toHaveCount(0);
  await expect(page.locator("#debug-current-line")).toBeHidden();
  // Worker replacement also removes every old debugger decoration.
  await page.getByRole("button", { name: "デバッグ実行", exact: true }).click();
  await expect(page.getByText("デバッガ停止中", { exact: true })).toBeVisible();
  await send("b 2");
  await expect(page.locator('.editor-line-number[data-breakpoint="true"]')).toHaveCount(1);
  await send("quit");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await expect(page.locator('.editor-line-number[data-breakpoint="true"]')).toHaveCount(0);
  await expect(page.locator('.editor-line-number[data-current="true"]')).toHaveCount(0);
});

test("keeps the editor usable on a narrow screen and in forced colors", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const editor = page.locator("#code-editor");
  await editor.fill("from machine import Pin\nled = Pin('LED', Pin.OUT)\n");
  await expect(page.locator(".editor-line-number")).toHaveCount(3);
  const editorBox = await editor.boundingBox();
  expect(editorBox!.width).toBeGreaterThan(200);
  expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(390);
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.locator(".editor-highlight-viewport")).toBeHidden();
  await expect(editor).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("pass");
  await expect(editor).toHaveValue("from machine import Pin\nled = Pin('LED', Pin.OUT)\npass");
});
