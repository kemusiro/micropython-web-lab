import { expect, test } from "./workspace-test";

test("does not mount private optional content in the managed build", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("[data-private-optional-content]")).toHaveCount(0);
});

test("switches the complete managed UI to English and remembers the locale", async ({ page }) => {
  await page.goto("/");

  const languageSelect = page.getByRole("combobox", { name: "言語 / Language", exact: true });
  await expect(languageSelect).toBeVisible();
  await expect(page.getByText("公開α", { exact: true })).toBeVisible();
  await expect(page.getByText("大切なコードは別の場所にも保存してください。", { exact: false })).toBeVisible();

  await languageSelect.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(languageSelect).toBeVisible();
  await expect(page.getByText("Public alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("Keep a separate copy of important code.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run script" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Virtual board and devices" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Built-in LED" })).toBeVisible();

  await page.getByText("Edit Pico 2 W connections", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply connections" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search devices" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Discard changes" })).toBeVisible();
  await expect(
    page.locator("#connection-editor-root").getByRole("heading", { name: "I2C register" }),
  ).toBeVisible();

  await page.reload();
  await expect(languageSelect).toHaveValue("en");
  await expect(page.getByRole("button", { name: "Run script" })).toBeVisible();
});

test("restores the editor draft after a page reload", async ({ page }) => {
  await page.goto("/");

  const editor = page.locator("#code-editor");
  const savedSource = 'print("restored draft")';
  await editor.fill(savedSource);
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");

  await page.reload();
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await expect(editor).toHaveValue(savedSource);
  await expect(page.locator("#draft-status")).toContainText("保存済みのコードを復元");
});

test("indents and outdents code with Tab and Shift+Tab", async ({ page }) => {
  await page.goto("/");

  const editor = page.locator("#code-editor");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await editor.fill("first\nsecond\nthird");
  await editor.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(0, 13);
  });

  await page.keyboard.press("Tab");
  await expect(editor).toHaveValue("    first\n    second\nthird");
  await expect(editor).toHaveJSProperty("selectionStart", 4);
  await expect(editor).toHaveJSProperty("selectionEnd", 21);

  await page.keyboard.press("Shift+Tab");
  await expect(editor).toHaveValue("first\nsecond\nthird");
  await expect(editor).toHaveJSProperty("selectionStart", 0);
  await expect(editor).toHaveJSProperty("selectionEnd", 13);
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");
});

test("accepts editing and history keys directly in the REPL terminal", async ({ page }) => {
  await page.goto("/");

  const status = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const terminalShell = page.locator("#terminal-shell");
  const directInput = page.getByLabel("REPLへ直接入力");

  await expect(status).toBeVisible();
  await terminalShell.click();
  await expect(directInput).toBeFocused();
  await expect(page.locator("#terminal-cursor")).toBeVisible();
  await expect(page.locator("#terminal-cursor")).toHaveCSS(
    "animation-name",
    "terminal-cursor-blink",
  );

  await page.keyboard.type("40 + 3");
  await page.keyboard.press("Backspace");
  await expect(terminal).not.toContainText("[K");
  await expect(terminal).toContainText("40 + ");
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("42");

  await page.getByRole("button", { name: "出力を消去" }).click();
  await terminalShell.click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("40 + 2");
  await expect(terminal).toContainText("42");
});

test("keeps the REPL usable after an unsupported machine pin", async ({ page }) => {
  await page.goto("/");

  const status = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const terminalShell = page.locator("#terminal-shell");
  const directInput = page.getByLabel("REPLへ直接入力");

  await expect(status).toBeVisible();
  await terminalShell.click();
  await page.keyboard.type("from machine import Pin");
  await page.keyboard.press("Enter");
  await page.keyboard.type("saved = 40");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Pin(25, Pin.OUT)");
  await page.keyboard.press("Enter");

  await expect(terminal).toContainText("ValueError: Unsupported Pico 2 W GPIO pin: 25");
  await expect(terminal).not.toContainText("[runtime error]");
  await expect(status).toBeVisible();
  await expect(directInput).toBeEnabled();

  await terminalShell.click();
  await page.keyboard.type("saved + 2");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText("42");
});

test("debugs a script with the GUI next and continue controls", async ({ page }) => {
  await page.goto("/");

  const editor = page.locator("#code-editor");
  const terminal = page.locator("#terminal");
  const currentLine = page.locator("#debug-current-line");
  const variables = page.locator("#debug-variable-panel");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await editor.fill("value = 1\nvalue += 1\nprint('debug value', value)");
  await page.getByRole("button", { name: "デバッグ実行" }).click();

  await expect(page.getByText("デバッガ停止中", { exact: true })).toBeVisible();
  await expect(terminal).toContainText(/-> 1\s*value = 1/);
  await expect(editor).toHaveAttribute("readonly", "");
  await expect(currentLine).toBeVisible();
  await expect(currentLine).toHaveAttribute("data-line", "1");
  await expect(variables).toBeVisible();
  await expect(page.locator("#debugger-location")).toHaveText("main.py:1 · <module>");
  await expect(variables).toContainText("表示できるグローバル変数はありません");
  await page.getByRole("button", { name: "次へ", exact: true }).click();

  await expect(page.getByText("デバッガ停止中", { exact: true })).toBeVisible();
  await expect(terminal).toContainText(/-> 2\s*value \+= 1/);
  await expect(currentLine).toHaveAttribute("data-line", "2");
  await expect(page.locator("#debugger-location")).toHaveText("main.py:2 · <module>");
  await expect(variables.locator(".debug-variable-row")).toHaveCount(1);
  await expect(variables.locator(".debug-variable-name")).toHaveText("value");
  await expect(variables.locator(".debug-variable-value code")).toHaveText("1");
  await expect(variables.locator(".debug-variable-value small")).toHaveText("int");
  await page.getByRole("button", { name: "続行", exact: true }).click();

  await expect(terminal).toContainText("debug value 2");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await expect(currentLine).toBeHidden();
  await expect(variables).toBeHidden();
  await expect(editor).not.toHaveAttribute("readonly", "");
});

test("honors pdb.set_trace during debug execution", async ({ page }) => {
  await page.goto("/");

  const terminal = page.locator("#terminal");
  const debuggerInput = page.getByLabel("pdbコマンド");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator("#code-editor").fill(
    "import pdb\nvalue = 1\npdb.set_trace()\nvalue += 1\nprint('after trace', value)",
  );
  await page.getByRole("button", { name: "デバッグ実行" }).click();
  await expect(page.getByText("デバッガ停止中", { exact: true })).toBeVisible();

  await debuggerInput.fill("continue");
  await debuggerInput.press("Enter");
  await expect(page.getByText("デバッガ停止中", { exact: true })).toBeVisible();
  await expect(terminal).toContainText(/-> 4\s*value \+= 1/);

  await debuggerInput.fill("continue");
  await debuggerInput.press("Enter");
  await expect(terminal).toContainText("after trace 2");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
});

test("controls the virtual onboard LED through machine.Pin", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const run = page.getByRole("button", { name: "スクリプトを実行" });
  const ledStatus = page.locator(
    '[data-device-instance="built-in-led"] [data-device-component="output"] output',
  );

  await expect(runtimeReady).toBeVisible();
  await page
    .locator('[data-device-instance="built-in-led"]')
    .getByRole("button", { name: "内蔵LEDのサンプルを新しいエディタタブで開く" })
    .click();
  await run.click();
  await expect(page.locator("#terminal")).toContainText("Virtual LED blink complete");
  await expect(ledStatus).toHaveText("消灯");
  await expect(ledStatus).toHaveAttribute("data-active", "false");

  await page.locator("#code-editor").fill(
    'from machine import Pin\nled = Pin("LED", Pin.OUT)\nled.off()',
  );
  await run.click();
  await expect(ledStatus).toHaveText("消灯");
  await expect(ledStatus).toHaveAttribute("data-active", "false");

  await page.getByRole("button", { name: "再起動" }).click();
  await expect(runtimeReady).toBeVisible();
  await expect(ledStatus).toHaveText("消灯");
});

test("reads the momentary virtual button while MicroPython is running", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const buttonCard = page.locator('[data-device-instance="button-gp15"]');
  const button = buttonCard.getByRole("button", { name: "GP15" });
  const level = buttonCard.locator('[data-device-component="level"] output');

  await expect(runtimeReady).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("data-pressed", "false");
  await expect(level).toHaveText("HIGH");

  await page.locator("#code-editor").fill(
    "from machine import Pin\nbutton = Pin(15, Pin.IN, Pin.PULL_UP)\nprint('Waiting for button')\nwhile button.value():\n    pass\nprint('Button pressed')",
  );
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(terminal).toContainText("Waiting for button");
  await expect(page.getByText("スクリプト実行中", { exact: true })).toBeVisible();

  await button.focus();
  await page.keyboard.down("Space");
  await expect(button).toHaveAttribute("data-pressed", "true");
  await expect(level).toHaveText("LOW");
  await expect(terminal).toContainText("Button pressed");
  await expect(runtimeReady).toBeVisible();

  await page.keyboard.up("Space");
  await expect(button).toHaveAttribute("data-pressed", "false");
  await page.locator("#code-editor").fill(
    "from machine import Pin\nprint('Button released', Pin(15, Pin.IN, Pin.PULL_UP).value())",
  );
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(terminal).toContainText("Button released 1");
  await expect(level).toHaveText("HIGH");
});

test("reads a changing virtual analog input while MicroPython is running", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const analogCard = page.locator('[data-device-instance="analog-gp26"]');
  const potentiometer = analogCard.getByRole("slider", { name: "ADC値" });
  const analogValue = analogCard.locator('[data-device-component="value"] output');

  await expect(runtimeReady).toBeVisible();
  await expect(potentiometer).toBeEnabled();
  await expect(potentiometer).toHaveValue("32768");
  await expect(analogValue).toHaveText("32768");

  await page.locator("#code-editor").fill(
    "from machine import ADC, Pin\npot = ADC(Pin(26))\nprint('ADC start', pot.read_u16())\nwhile pot.read_u16() < 50000:\n    pass\nprint('ADC changed', pot.read_u16())",
  );
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(terminal).toContainText("ADC start 32768");
  await expect(page.getByText("スクリプト実行中", { exact: true })).toBeVisible();

  await potentiometer.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "60000";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(analogValue).toHaveText("60000");
  await expect(terminal).toContainText("ADC changed 60000");
  await expect(runtimeReady).toBeVisible();
});

test("scans and transfers bytes through the virtual I2C register device", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");

  await expect(runtimeReady).toBeVisible();
  await page
    .locator('[data-device-instance="i2c-register-0x50"]')
    .getByRole("button", { name: "I2Cレジスタのサンプルを新しいエディタタブで開く" })
    .click();
  await page.getByRole("button", { name: "スクリプトを実行" }).click();

  await expect(terminal).toContainText("I2C devices: ['0x50', '0x76']");
  await expect(terminal).toContainText("Register: b'ABC'");
  const i2cCard = page.locator('[data-device-instance="i2c-register-0x50"]');
  await expect(i2cCard.locator('[data-device-component="transactions"] output')).toHaveText("2");
  await expect(i2cCard.locator('[data-device-component="pointer"] output')).toHaveText("0x13");
  await expect(runtimeReady).toBeVisible();
});

test("reads adjustable AE-BME280 environmental measurements over I2C", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const card = page.locator('[data-device-instance="ae-bme280-0x76"]');
  await expect(runtimeReady).toBeVisible();
  await expect(card.getByRole("slider", { name: "温度 (°C)" })).toHaveValue("25");
  await expect(card.getByRole("slider", { name: "湿度 (%RH)" })).toHaveValue("50");
  await expect(card.getByRole("slider", { name: "気圧 (hPa)" })).toHaveValue("1013");

  await card
    .getByRole("button", { name: "BME280環境センサーのサンプルを新しいエディタタブで開く" })
    .click();
  await expect(page.locator("#code-editor")).toHaveValue(/class BME280:/);
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(terminal).toContainText("BME280 chip: 0x60");
  await expect(terminal).toContainText("Temperature: 25.0 C");
  await expect(terminal).toContainText("Humidity: 50.0 %RH");
  await expect(terminal).toContainText("Pressure: 1013.0 hPa");

  await card.getByRole("slider", { name: "温度 (°C)" }).fill("30");
  await card.getByRole("slider", { name: "湿度 (%RH)" }).fill("65");
  await card.getByRole("slider", { name: "気圧 (hPa)" }).fill("1000");
  await expect(card.locator('[data-device-component="temperature"] output')).toHaveText("30");
  await expect(card.locator('[data-device-component="humidity"] output')).toHaveText("65");
  await expect(card.locator('[data-device-component="pressure"] output')).toHaveText("1000");

  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(terminal).toContainText("Temperature: 30.0 C");
  await expect(terminal).toContainText("Humidity: 65.0 %RH");
  await expect(terminal).toContainText("Pressure: 1000.0 hPa");
  await expect(
    card.locator('[data-device-component="temperature"] output'),
  ).toHaveText("30");
});

test("uses SPI, UART, and PWM through Device API reference devices", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  await expect(runtimeReady).toBeVisible();

  await page.locator("#code-editor").fill(
    [
      "from machine import SPI, UART, PWM, Pin",
      "spi = SPI(0, baudrate=2000000, polarity=0, phase=0, bits=8, firstbit=SPI.MSB, sck=Pin(6), mosi=Pin(7), miso=Pin(4))",
      "spi.write(bytes([0x10, 0xaa, 0xbb]))",
      "spi_rx = bytearray(3)",
      "spi.write_readinto(bytes([0x90, 0, 0]), spi_rx)",
      "print('SPI result', list(spi_rx))",
      "uart = UART(0, 115200, tx=Pin(0), rx=Pin(1), bits=8, parity=None, stop=1)",
      "uart.write(b'echo')",
      "print('UART result', uart.any(), uart.read())",
      "pwm = PWM(Pin(16), freq=2000, duty_u16=32768)",
      "print('PWM result', pwm.freq(), pwm.duty_u16())",
      "pwm.deinit()",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "スクリプトを実行" }).click();

  await expect(terminal).toContainText("SPI result [0, 170, 187]");
  await expect(terminal).toContainText("UART result 4 b'echo'");
  await expect(terminal).toContainText("PWM result 2000 32768");
  await expect(runtimeReady).toBeVisible();
});

test("renders an SSD1331 RGB565 frame sent over SPI", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const card = page.locator('[data-device-instance="qt095b-ssd1331"]');
  const canvas = card.getByRole("img", { name: "96×64 RGB OLED" });
  await expect(runtimeReady).toBeVisible();
  await expect(canvas).toHaveAttribute("width", "96");
  await expect(canvas).toHaveAttribute("height", "64");

  await card
    .getByRole("button", { name: "SSD1331 RGB OLEDのサンプルを新しいエディタタブで開く" })
    .click();
  await expect(page.locator("#code-editor")).toHaveValue(/write_command\(0xA0, 0x72\)/);
  await page.getByRole("button", { name: "スクリプトを実行" }).click();

  await expect(terminal).toContainText("SSD1331 display: 96x64 RGB OLED");
  await expect(card.locator('[data-device-component="display-on"] output')).toHaveText("表示中");
  await expect(canvas).toHaveAttribute("data-state", "ready");
  expect(
    await canvas.evaluate((element) => {
      const context = (element as HTMLCanvasElement).getContext("2d");
      if (context === null) {
        throw new Error("Canvas 2D unavailable");
      }
      return [
        [...context.getImageData(0, 0, 1, 1).data],
        [...context.getImageData(10, 10, 1, 1).data],
        [...context.getImageData(10, 30, 1, 1).data],
        [...context.getImageData(10, 50, 1, 1).data],
      ];
    }),
  ).toEqual([
    [255, 255, 255, 255],
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
  ]);
  await expect(runtimeReady).toBeVisible();
});

test("reads BME280 measurements and draws them on the connected SSD1331", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const bme = page.locator('[data-device-instance="ae-bme280-0x76"]');
  const display = page.locator('[data-device-instance="qt095b-ssd1331"]');
  const canvas = display.getByRole("img", { name: "96×64 RGB OLED" });
  await expect(runtimeReady).toBeVisible();

  await expect(
    page.locator('[data-connection-device="ae-bme280-0x76"]'),
  ).toContainText("7-bit address 0x76");
  await expect(page.getByLabel("BME280環境センサー I2C 接続先")).toHaveValue("0");
  await expect(
    page.locator('[data-connection-device="qt095b-ssd1331"]'),
  ).toContainText("CS=cs · Low選択");
  await expect(page.getByLabel("SSD1331 RGB OLED SPI 接続先")).toHaveValue("0");
  await expect(page.getByLabel("SSD1331 RGB OLED CS 接続先")).toHaveValue("GP5");

  await bme.getByRole("slider", { name: "温度 (°C)" }).fill("30");
  await bme.getByRole("slider", { name: "湿度 (%RH)" }).fill("65");
  await bme.getByRole("slider", { name: "気圧 (hPa)" }).fill("1000");
  await page
    .locator('[data-scenario-example-card="environment-dashboard"]')
    .getByRole("button", { name: "環境センサー・ダッシュボードを新しいエディタタブで開く" })
    .click();
  await expect(page.locator("#code-editor")).toHaveValue(/draw_text\(pixels, "T/);
  await page.getByRole("button", { name: "スクリプトを実行" }).click();

  await expect(terminal).toContainText(
    "Combined display: T=30.0 C H=65.0 %RH P=1000.0 hPa",
  );
  await expect(display.locator('[data-device-component="display-on"] output')).toHaveText(
    "表示中",
  );
  await expect(canvas).toHaveAttribute("data-state", "ready");
  const colorCounts = await canvas.evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const data = canvasElement
      .getContext("2d")!
      .getImageData(0, 0, canvasElement.width, canvasElement.height).data;
    const counts = { red: 0, green: 0, blue: 0 };
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index]!;
      const g = data[index + 1]!;
      const b = data[index + 2]!;
      counts.red += r > g * 1.5 && r > b * 1.5 ? 1 : 0;
      counts.green += g > r * 1.5 && g > b * 1.5 ? 1 : 0;
      counts.blue += b > r * 1.5 && b > g * 1.5 ? 1 : 0;
    }
    return counts;
  });
  expect(colorCounts.red).toBeGreaterThan(0);
  expect(colorCounts.green).toBeGreaterThan(0);
  expect(colorCounts.blue).toBeGreaterThan(0);
  await expect(runtimeReady).toBeVisible();
});

test("renders and operates the declarative Device UI reference cards", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const cards = page.locator("[data-device-instance]");
  await expect(runtimeReady).toBeVisible();
  await expect(cards).toHaveCount(10);
  await expect(page.locator("[data-device-example]")).toHaveCount(10);

  const ledCard = page.locator('[data-device-instance="built-in-led"]');
  await expect(ledCard.getByRole("status")).toHaveText("消灯");

  const analogCard = page.locator('[data-device-instance="analog-gp26"]');
  await analogCard.getByRole("slider", { name: "ADC値" }).fill("60000");
  const uartCard = page.locator('[data-device-instance="gt-502mgg-n"]');
  await uartCard.getByRole("textbox", { name: "互換UART受信文字列" }).fill("from-ui");
  await uartCard.getByRole("button", { name: "UARTへ送信" }).click();

  await page.locator("#code-editor").fill(
    [
      "from machine import ADC, Pin, SPI, UART, PWM",
      "print('UI ADC', ADC(Pin(26)).read_u16())",
      "uart = UART(0, 115200, tx=Pin(0), rx=Pin(1))",
      "print('UI UART', uart.read())",
      "spi = SPI(0, sck=Pin(6), mosi=Pin(7), miso=Pin(4))",
      "spi.write(bytes([0x10, 0xaa]))",
      "pwm = PWM(Pin(16), freq=2000, duty_u16=32768)",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "スクリプトを実行" }).click();

  await expect(terminal).toContainText("UI ADC 60000");
  await expect(terminal).toContainText("UI UART b'from-ui'");
  await expect(
    analogCard.locator('[data-device-component="value"] output'),
  ).toHaveText("60000");
  await expect(
    page.locator('[data-device-instance="spi-register-0"] [data-device-component="transfers"] output'),
  ).toHaveText("1");
  await expect(
    page.locator('[data-device-instance="pwm-indicator-gp16"] [data-device-component="enabled"] output'),
  ).toHaveText("有効");
  await expect(runtimeReady).toBeVisible();

  await page.locator("#code-editor").fill(
    "from machine import Pin\nbutton = Pin(15, Pin.IN, Pin.PULL_UP)\nwhile button.value():\n    pass\nprint('UI button pressed')",
  );
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  const button = page
    .locator('[data-device-instance="button-gp15"]')
    .getByRole("button", { name: "GP15" });
  await button.hover();
  await page.mouse.down();
  await expect(terminal).toContainText("UI button pressed");
  await expect(
    page.locator('[data-device-instance="button-gp15"] [data-device-component="level"] output'),
  ).toHaveText("LOW");
  await page.mouse.up();
});

test("keeps device panel buttons inside narrow cards with long titles", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();

  for (const instanceId of ["ae-bme280-0x76", "gt-502mgg-n", "ostamc5a31a-vv"]) {
    const card = page.locator(`[data-device-instance="${instanceId}"]`);
    const actions = card.locator(".device-ui-card-heading-actions");
    await card.scrollIntoViewIfNeeded();
    await expect(actions.locator("button")).toHaveCount(2);
    await expect(actions.getByRole("button", { name: "サンプル" })).toBeVisible();

    const cardBox = await card.boundingBox();
    const actionsBox = await actions.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(actionsBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(
      cardBox!.x + cardBox!.width + 1,
    );
  }
});

test("places device panels on fixed grid units", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();

  const compact = page.locator('[data-device-instance="built-in-led"]');
  const tall = page.locator('[data-device-instance="ae-bme280-0x76"]');
  const large = page.locator('[data-device-instance="gt-502mgg-n"]');
  await expect(compact).toHaveAttribute("data-panel-size", "1x1");
  await expect(tall).toHaveAttribute("data-panel-size", "1x2");
  await expect(large).toHaveAttribute("data-panel-size", "2x2");

  const compactBox = await compact.boundingBox();
  const tallBox = await tall.boundingBox();
  const largeBox = await large.boundingBox();
  expect(compactBox).not.toBeNull();
  expect(tallBox).not.toBeNull();
  expect(largeBox).not.toBeNull();
  expect(tallBox!.height).toBeGreaterThan(compactBox!.height * 2);
  expect(largeBox!.height).toBeCloseTo(tallBox!.height, 0);
  expect(largeBox!.width).toBeGreaterThan(compactBox!.width * 2);
});

test("reorders device panels by drag and keyboard and restores the order", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();

  const cards = page.locator("#device-ui-root > [data-device-instance]");
  const cardOrder = async (): Promise<string[]> =>
    cards.evaluateAll((elements) =>
      elements.map((element) => (element as HTMLElement).dataset.deviceInstance!),
    );
  expect((await cardOrder()).slice(0, 3)).toEqual([
    "built-in-led",
    "button-gp15",
    "analog-gp26",
  ]);

  const dragHandle = page.locator('[data-device-move-handle="button-gp15"]');
  const draggedCard = page.locator('[data-device-instance="button-gp15"]');
  const dragTarget = page.locator('[data-device-instance="built-in-led"]');
  const handleBox = await dragHandle.boundingBox();
  const draggedBox = await draggedCard.boundingBox();
  const targetBox = await dragTarget.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(draggedBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await expect(draggedCard).toHaveAttribute("data-dragging", "true");
  const dragPreview = page.locator('[data-drag-preview-for="button-gp15"]');
  await expect(dragPreview).toBeVisible();
  await expect(dragPreview).toHaveAttribute("aria-hidden", "true");
  const previewBox = await dragPreview.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(previewBox!.width).toBeGreaterThan(draggedBox!.width);
  expect(previewBox!.width).toBeLessThan(draggedBox!.width * 1.1);
  await page.mouse.move(
    targetBox!.x + targetBox!.width * 0.25,
    targetBox!.y + targetBox!.height / 2,
    { steps: 8 },
  );
  await expect(dragTarget).toHaveAttribute("data-drop-position", "before");
  const movedPreviewBox = await dragPreview.boundingBox();
  expect(movedPreviewBox).not.toBeNull();
  expect(movedPreviewBox!.x).not.toBeCloseTo(previewBox!.x, 0);
  await page.mouse.up();
  await expect(dragPreview).toHaveCount(0);
  expect((await cardOrder()).slice(0, 3)).toEqual([
    "button-gp15",
    "built-in-led",
    "analog-gp26",
  ]);
  await expect(page.locator(".device-ui-reorder-status")).toContainText(
    "押しボタンを10件中1番目へ移動しました",
  );

  await page.reload();
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  expect((await cardOrder()).slice(0, 3)).toEqual([
    "button-gp15",
    "built-in-led",
    "analog-gp26",
  ]);

  const restoredHandle = page.locator('[data-device-move-handle="button-gp15"]');
  await expect(restoredHandle).toHaveAttribute("aria-label", /10件中1番目/);
  await restoredHandle.focus();
  await restoredHandle.press("ArrowDown");
  expect((await cardOrder()).slice(0, 3)).toEqual([
    "built-in-led",
    "button-gp15",
    "analog-gp26",
  ]);
  await expect(restoredHandle).toBeFocused();
});

test("can move a compact panel again after dropping it onto the middle of a tall panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1400 });
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();

  const source = page.locator('[data-device-instance="built-in-led"]');
  const sourceHeading = source.locator(".device-ui-card-heading-copy");
  const tallTarget = page.locator('[data-device-instance="ae-bme280-0x76"]');
  const secondTarget = page.locator('[data-device-instance="analog-gp26"]');
  const order = async (): Promise<string[]> =>
    page.locator("#device-ui-root > [data-device-instance]").evaluateAll((elements) =>
      elements.map((element) => (element as HTMLElement).dataset.deviceInstance!),
    );
  const dragHeadingToMiddle = async (target: typeof tallTarget): Promise<void> => {
    const headingBox = await sourceHeading.boundingBox();
    const targetBox = await target.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(
      headingBox!.x + headingBox!.width / 2,
      headingBox!.y + headingBox!.height / 2,
    );
    await page.mouse.down();
    await expect(source).toHaveAttribute("data-dragging", "true");
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(page.locator('[data-drag-preview-for="built-in-led"]')).toHaveCount(0);
    await expect(source).not.toHaveAttribute("data-dragging", "true");
  };

  await dragHeadingToMiddle(tallTarget);
  expect((await order()).indexOf("built-in-led")).toBe(4);
  const firstDropBox = await source.boundingBox();
  expect(firstDropBox).not.toBeNull();

  await dragHeadingToMiddle(secondTarget);
  expect((await order()).indexOf("built-in-led")).toBe(2);
  const secondDropBox = await source.boundingBox();
  expect(secondDropBox).not.toBeNull();
  expect(
    Math.abs(secondDropBox!.x - firstDropBox!.x) +
      Math.abs(secondDropBox!.y - firstDropBox!.y),
  ).toBeGreaterThan(100);
});

test("opens device samples in persistent editor tabs without replacing existing code", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();

  const editor = page.locator("#code-editor");
  const tabs = page.locator("#editor-tabs");
  await editor.fill('print("keep this program")');
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");

  const ledCard = page.locator('[data-device-instance="built-in-led"]');
  await ledCard
    .getByRole("button", { name: "内蔵LEDのサンプルを新しいエディタタブで開く" })
    .click();
  await expect(tabs.locator(".editor-tab")).toHaveCount(2);
  await expect(tabs.getByRole("tab", { name: "内蔵LED サンプル" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(editor).toHaveValue(/led = Pin\("LED", Pin\.OUT\)/);
  const panelBox = await page.locator(".editor-panel").boundingBox();
  const tabsBox = await tabs.boundingBox();
  const actionsBox = await page.locator(".editor-actions").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(tabsBox!.height).toBeGreaterThan(28);
  expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(
    panelBox!.y + panelBox!.height + 1,
  );

  // Windows fonts can increase toolbar line boxes; keep actions inside the panel.
  await page.locator(".editor-panel").evaluate((element: HTMLElement) => {
    element.style.lineHeight = "1.8";
  });
  // Height changes are measured by ResizeObserver on the next rendering update.
  await expect.poll(async () => {
    const tallerPanel = await page.locator(".editor-panel").boundingBox();
    const tallerActions = await page.locator(".editor-actions").boundingBox();
    return tallerActions!.y + tallerActions!.height - tallerPanel!.y - tallerPanel!.height;
  }).toBeLessThanOrEqual(1);
  await page.locator(".editor-panel").evaluate((element: HTMLElement) => {
    element.style.lineHeight = "";
  });

  await tabs.getByRole("tab", { name: "main.py" }).click();
  await expect(editor).toHaveValue('print("keep this program")');
  await tabs.getByRole("tab", { name: "内蔵LED サンプル" }).click();
  await expect(page.locator("#draft-status")).toContainText("このブラウザに保存済み");

  await page.reload();
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await expect(tabs.locator(".editor-tab")).toHaveCount(2);
  await expect(editor).toHaveValue(/led = Pin\("LED", Pin\.OUT\)/);
  await tabs.getByRole("tab", { name: "main.py" }).click();
  await expect(editor).toHaveValue('print("keep this program")');

  await ledCard
    .getByRole("button", { name: "内蔵LEDのサンプルを新しいエディタタブで開く" })
    .click();
  await expect(tabs.locator(".editor-tab")).toHaveCount(3);
});

test("runs a multi-device interactive example from the scenario gallery", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const gallery = page.locator(".scenario-example-grid");
  const exampleCard = gallery.locator('[data-scenario-example-card="button-rgb-controller"]');
  const buttonCard = page.locator('[data-device-instance="button-gp15"]');
  const onboardLedCard = page.locator('[data-device-instance="built-in-led"]');
  const rgbCard = page.locator('[data-device-instance="ostamc5a31a-vv"]');
  await expect(runtimeReady).toBeVisible();
  await expect(gallery.locator(".scenario-example-card")).toHaveCount(4);
  await expect(page.locator("[data-example], [data-script-example], [data-script-example-id]")).toHaveCount(0);

  await exampleCard
    .getByRole("button", { name: "ボタン連動RGBランプを新しいエディタタブで開く" })
    .click();
  await expect(page.locator("#code-editor")).toHaveValue(/Interactive lamp: press GPIO 15/);
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(terminal).toContainText("Interactive lamp: press GPIO 15 to change color");

  const button = buttonCard.getByRole("button", { name: "GP15" });
  // The example polls a momentary input. Hold it until sampled on slower hosts.
  await button.focus();
  await page.keyboard.down("Space");
  await expect(
    onboardLedCard.locator('[data-device-component="output"] output'),
  ).toHaveText("点灯");
  await expect(rgbCard.locator('[data-device-component="hex-color"] output')).toHaveText(
    "#ff0000",
  );
  await page.keyboard.up("Space");

  await expect(terminal).toContainText("Color: red");
  await expect(terminal).toContainText("Interactive lamp complete", { timeout: 10_000 });
  await expect(runtimeReady).toBeVisible();

  const analogCard = page.locator('[data-device-instance="analog-gp26"]');
  const pwmCard = page.locator('[data-device-instance="pwm-indicator-gp16"]');
  await gallery
    .locator('[data-scenario-example-card="analog-rgb-mixer"]')
    .getByRole("button", { name: "アナログ・カラーミキサーを新しいエディタタブで開く" })
    .click();
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(terminal).toContainText("Color mixer: move the ADC value slider");
  await analogCard.getByRole("slider", { name: "ADC値" }).fill("65535");
  await expect(terminal).toContainText("ADC zone: 3 value: 65535");
  await expect(rgbCard.locator('[data-device-component="hex-color"] output')).toHaveText(
    "#ff0000",
  );
  await expect(pwmCard.locator('[data-device-component="duty"] output')).toHaveText("65,535");
  await expect(terminal).toContainText("Color mixer complete", { timeout: 10_000 });
  await expect(runtimeReady).toBeVisible();
});

test("fills a wide viewport with a balanced editor, REPL, and device workbench", async ({
  page,
}) => {
  // Test viewport-driven growth above the working minimum on every OS/font stack.
  // Short-window clamping is covered separately in workspace-layout.spec.ts.
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto("/");

  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  const workspace = page.locator(".workspace");
  const editor = page.locator("#code-editor");
  const board = page.locator(".virtual-board-panel");
  const terminal = page.locator("#terminal-shell");
  const connectionOverview = page.locator(".connection-overview");

  expect(await workspace.evaluate((element) => getComputedStyle(element).display)).toBe("grid");
  expect(await board.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  expect(
    await board.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  expect(
    await connectionOverview.evaluate((element: HTMLDetailsElement) => element.open),
  ).toBe(false);

  const boardBox = await board.boundingBox();
  const editorBox = await editor.boundingBox();
  const terminalBox = await terminal.boundingBox();
  const workspaceBox = await workspace.boundingBox();
  expect(boardBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(terminalBox).not.toBeNull();
  expect(workspaceBox).not.toBeNull();
  expect(workspaceBox!.width).toBeGreaterThan(1800);
  expect(workspaceBox!.height).toBeLessThanOrEqual(1100);
  expect(editorBox!.height).toBeGreaterThan(240);
  expect(terminalBox!.height).toBeGreaterThan(150);
  expect(terminalBox!.y + terminalBox!.height).toBeLessThan(1200);
  expect(terminalBox!.y).toBeLessThan(boardBox!.y + boardBox!.height);
  expect(Math.abs(boardBox!.height - (workspaceBox!.height - 50))).toBeLessThan(24);

  await page.setViewportSize({ width: 1920, height: 1600 });
  await expect.poll(async () => (await workspace.boundingBox())!.height - workspaceBox!.height)
    .toBeCloseTo(400, 0);
  const tallWorkspaceBox = await workspace.boundingBox();
  const tallEditorBox = await editor.boundingBox();
  const tallTerminalBox = await terminal.boundingBox();
  const tallBoardBox = await board.boundingBox();
  expect(tallWorkspaceBox).not.toBeNull();
  expect(tallEditorBox).not.toBeNull();
  expect(tallTerminalBox).not.toBeNull();
  expect(tallBoardBox).not.toBeNull();
  expect(tallWorkspaceBox!.height - workspaceBox!.height).toBeCloseTo(400, 0);
  expect(tallEditorBox!.height).toBeGreaterThan(editorBox!.height + 250);
  expect(tallTerminalBox!.height).toBeGreaterThan(terminalBox!.height + 80);
  expect(tallBoardBox!.height - boardBox!.height).toBeCloseTo(400, 0);
});

test("resizes and restores the editor, REPL, and device panes", async ({ page }) => {
  // Leave room above the minimum working heights to exercise resizing in both directions.
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/");

  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  const editor = page.locator(".editor-panel");
  const terminal = page.locator("#terminal-shell");
  const board = page.locator(".virtual-board-panel");
  const columnResizer = page.locator("#workspace-column-resizer");
  const rowResizer = page.locator("#workspace-row-resizer");

  await expect(columnResizer).toBeVisible();
  await expect(rowResizer).toBeVisible();
  const initialEditorBox = await editor.boundingBox();
  const initialTerminalBox = await terminal.boundingBox();
  const initialBoardBox = await board.boundingBox();
  const columnBox = await columnResizer.boundingBox();
  const rowBox = await rowResizer.boundingBox();
  expect(initialEditorBox).not.toBeNull();
  expect(initialTerminalBox).not.toBeNull();
  expect(initialBoardBox).not.toBeNull();
  expect(columnBox).not.toBeNull();
  expect(rowBox).not.toBeNull();

  await page.mouse.move(columnBox!.x + columnBox!.width / 2, columnBox!.y + 100);
  await page.mouse.down();
  await page.mouse.move(columnBox!.x - 120, columnBox!.y + 100, { steps: 6 });
  await page.mouse.up();

  const resizedRowBox = await rowResizer.boundingBox();
  expect(resizedRowBox).not.toBeNull();
  await page.mouse.move(resizedRowBox!.x + 100, resizedRowBox!.y + resizedRowBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizedRowBox!.x + 100, resizedRowBox!.y - 80, { steps: 6 });
  await page.mouse.up();

  const resizedEditorBox = await editor.boundingBox();
  const resizedTerminalBox = await terminal.boundingBox();
  const resizedBoardBox = await board.boundingBox();
  expect(resizedEditorBox).not.toBeNull();
  expect(resizedTerminalBox).not.toBeNull();
  expect(resizedBoardBox).not.toBeNull();
  expect(resizedEditorBox!.width).toBeLessThan(initialEditorBox!.width - 80);
  expect(resizedBoardBox!.width).toBeGreaterThan(initialBoardBox!.width + 80);
  expect(resizedEditorBox!.height).toBeLessThan(initialEditorBox!.height - 50);
  expect(resizedTerminalBox!.height).toBeGreaterThan(initialTerminalBox!.height + 50);

  await page.reload();
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  const restoredEditorBox = await editor.boundingBox();
  const restoredTerminalBox = await terminal.boundingBox();
  const restoredBoardBox = await board.boundingBox();
  expect(restoredEditorBox).not.toBeNull();
  expect(restoredTerminalBox).not.toBeNull();
  expect(restoredBoardBox).not.toBeNull();
  expect(restoredEditorBox!.width).toBeCloseTo(resizedEditorBox!.width, 0);
  expect(restoredEditorBox!.height).toBeCloseTo(resizedEditorBox!.height, 0);
  expect(restoredTerminalBox!.height).toBeCloseTo(resizedTerminalBox!.height, 0);
  expect(restoredBoardBox!.width).toBeCloseTo(resizedBoardBox!.width, 0);

  await columnResizer.focus();
  await columnResizer.press("ArrowRight");
  const keyboardColumnEditorBox = await editor.boundingBox();
  expect(keyboardColumnEditorBox).not.toBeNull();
  expect(keyboardColumnEditorBox!.width).toBeGreaterThan(restoredEditorBox!.width + 20);

  await rowResizer.focus();
  await rowResizer.press("ArrowDown");
  const keyboardRowEditorBox = await editor.boundingBox();
  expect(keyboardRowEditorBox).not.toBeNull();
  expect(keyboardRowEditorBox!.height).toBeGreaterThan(restoredEditorBox!.height + 10);
});

test("returns the workbench to one column on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  const workspace = page.locator(".workspace");
  const editor = page.locator(".editor-panel");
  const board = page.locator(".virtual-board-panel");
  const terminal = page.locator("#terminal-shell");
  const workspaceBox = await workspace.boundingBox();
  const editorBox = await editor.boundingBox();
  const boardBox = await board.boundingBox();
  const terminalBox = await terminal.boundingBox();

  expect(await workspace.evaluate((element) => getComputedStyle(element).display)).not.toBe("grid");
  await expect(page.locator("#workspace-column-resizer")).toBeHidden();
  await expect(page.locator("#workspace-row-resizer")).toBeHidden();
  expect(workspaceBox).not.toBeNull();
  expect(editorBox).not.toBeNull();
  expect(boardBox).not.toBeNull();
  expect(terminalBox).not.toBeNull();
  expect(workspaceBox!.width).toBeGreaterThan(370);
  expect(boardBox!.y).toBeGreaterThanOrEqual(editorBox!.y + editorBox!.height);
  expect(terminalBox!.y).toBeGreaterThanOrEqual(boardBox!.y + boardBox!.height);
});

test("edits and restores a multi-device I2C connection graph", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();

  const editor = page.locator(".connection-editor-panel");
  await editor.locator("summary").click();
  const wires = editor.locator(".connection-wires");
  await expect(wires.locator('path[data-kind="i2c"]')).toHaveCount(2);
  await expect(editor.locator('[data-connection-endpoint="i2c:0"]')).toHaveCount(2);
  await expect(
    editor.locator('[data-connection-source-for="i2c-register-0x50.i2c"]'),
  ).toBeVisible();
  await expect(
    editor.locator('[data-connection-source-for="ae-bme280-0x76.i2c"]'),
  ).toBeVisible();
  const wireZIndex = await wires.evaluate((element) => Number(getComputedStyle(element).zIndex));
  const deviceZIndex = await editor
    .locator(".connection-device-node")
    .first()
    .evaluate((element) => Number(getComputedStyle(element).zIndex));
  const boardZIndex = await editor
    .locator(".connection-board-node")
    .evaluate((element) => Number(getComputedStyle(element).zIndex));
  expect(wireZIndex).toBeGreaterThan(deviceZIndex);
  expect(wireZIndex).toBeGreaterThan(boardZIndex);
  await expect(wires).toHaveCSS("pointer-events", "none");
  await expect(page.getByLabel("I2Cレジスタを接続")).toBeChecked();
  await expect(page.getByLabel("BME280環境センサーを接続")).toBeChecked();

  await page.getByLabel("BME280環境センサーを接続").uncheck();
  await page.getByRole("button", { name: "配線を適用" }).click();
  await expect(page.locator("#terminal")).toContainText("配線を適用し、Workerを再生成");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await expect(page.locator('[data-device-instance="ae-bme280-0x76"]')).toHaveCount(0);
  await page.locator("#code-editor").fill(
    "from machine import I2C\nprint([hex(address) for address in I2C(0).scan()])",
  );
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(page.locator("#terminal")).toContainText("['0x50']");

  await page.reload();
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();
  await expect(page.getByLabel("BME280環境センサーを接続")).not.toBeChecked();
  await expect(page.locator('[data-device-instance="ae-bme280-0x76"]')).toHaveCount(0);
});

test("rejects a GPIO edit that conflicts with the shared I2C bus", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();

  await page.getByLabel("押しボタン 入力 接続先").selectOption("GP8");
  await expect(page.locator(".connection-editor-status")).toContainText(
    "GP8の割り当てが重複しています（押しボタン / I2C0）",
  );
  await expect(page.locator('[data-connection-device="button-gp15"]')).toHaveAttribute(
    "data-conflict",
    "true",
  );
  await expect(
    page.locator('[data-connection-port="button-gp15.input"]'),
  ).toHaveAttribute("data-conflict", "true");
  await expect(page.locator('.connection-wires path[data-conflict="true"]')).not.toHaveCount(0);
  await expect(page.getByRole("button", { name: "配線を適用" })).toBeDisabled();
});

test("updates the push-button panel and samples after rewiring its GPIO", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();

  await page.getByLabel("押しボタン 入力 接続先").selectOption("GP13");
  await page.getByRole("button", { name: "配線を適用" }).click();
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();

  const buttonCard = page.locator('[data-device-instance="button-gp15"]');
  await expect(buttonCard.getByRole("button", { name: "GP13", exact: true })).toBeVisible();
  await expect(buttonCard.locator(".device-ui-description")).toContainText("GP13へ接続");

  await buttonCard
    .getByRole("button", { name: "押しボタンのサンプルを新しいエディタタブで開く" })
    .click();
  await expect(page.locator("#code-editor")).toHaveValue(/button = Pin\(13,/);
  await page
    .locator('[data-scenario-example-card="button-rgb-controller"]')
    .getByRole("button", { name: "ボタン連動RGBランプを新しいエディタタブで開く" })
    .click();
  await expect(page.locator("#code-editor")).toHaveValue(/button = Pin\(13,/);

  await page.reload();
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await expect(
    page
      .locator('[data-device-instance="button-gp15"]')
      .getByRole("button", { name: "GP13", exact: true }),
  ).toBeVisible();
});

test("filters, collapses, and discards connection editor changes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();

  const editor = page.locator("#connection-editor-root");
  const search = page.getByRole("searchbox", { name: "デバイスを検索" });
  const apply = page.getByRole("button", { name: "配線を適用" });
  const discard = page.getByRole("button", { name: "変更を取り消す" });
  await expect(editor.getByText("未適用の変更なし", { exact: true })).toBeVisible();
  await expect(apply).toBeDisabled();
  await expect(discard).toBeDisabled();
  await expect(editor.locator(".connection-editor-toolbar")).toHaveCSS("position", "sticky");

  await search.fill("BME280");
  await expect(editor.locator('[data-connection-device]:not([hidden])')).toHaveCount(1);
  await expect(editor.locator(".connection-filter-summary")).toHaveText("10件中1件を表示");
  await page.getByRole("button", { name: "表示中を折りたたむ" }).click();
  await expect(page.getByRole("button", { name: "BME280環境センサーを展開" })).toBeVisible();

  await page.getByRole("button", { name: "絞り込みを解除" }).click();
  await expect(editor.locator('[data-connection-device]:not([hidden])')).toHaveCount(10);
  await page.getByLabel("押しボタン 入力 接続先").selectOption("GP13");
  await expect(editor.getByText("未適用の変更あり", { exact: true })).toBeVisible();
  await expect(apply).toBeEnabled();
  await expect(discard).toBeEnabled();

  await discard.click();
  await expect(page.getByLabel("押しボタン 入力 接続先")).toHaveValue("GP15");
  await expect(editor.getByText("未適用の変更なし", { exact: true })).toBeVisible();
  await expect(apply).toBeDisabled();
  await expect(discard).toBeDisabled();
});

test("selects and deselects every device connection at once", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();

  const editor = page.locator("#connection-editor-root");
  const toggles = editor.locator("[data-connection-device-toggle]");
  const checkedToggles = editor.locator("[data-connection-device-toggle]:checked");
  const selectAll = editor.getByRole("button", { name: "すべて選択", exact: true });
  const deselectAll = editor.getByRole("button", { name: "すべて解除", exact: true });
  await expect(toggles).toHaveCount(10);
  await expect(checkedToggles).toHaveCount(10);
  await expect(selectAll).toBeDisabled();
  await expect(deselectAll).toBeEnabled();

  await deselectAll.click();
  await expect(checkedToggles).toHaveCount(0);
  await expect(editor.locator('[data-connection-device][data-connected="false"]')).toHaveCount(10);
  await expect(editor.locator(".connection-editor-status")).toContainText(
    "すべてのデバイスの選択を解除しました",
  );
  await expect(selectAll).toBeEnabled();
  await expect(deselectAll).toBeDisabled();
  await expect(editor.getByText("未適用の変更あり", { exact: true })).toBeVisible();

  await selectAll.click();
  await expect(checkedToggles).toHaveCount(10);
  await expect(editor.locator('[data-connection-device][data-connected="true"]')).toHaveCount(10);
  await expect(editor.locator(".connection-editor-status")).toContainText(
    "すべてのデバイスを選択しました",
  );
  await expect(selectAll).toBeDisabled();
  await expect(deselectAll).toBeEnabled();
  await expect(editor.getByText("未適用の変更なし", { exact: true })).toBeVisible();
});

test("rewires Pico ends and swaps compatible device ends by dragging", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();

  const editor = page.locator("#connection-editor-root");
  const buttonBoardSocket = editor.locator(
    '[data-connection-source-for="button-gp15.input"]',
  );
  const gp13BoardRow = editor.locator(
    '[data-connection-candidate-kind="gpio"][data-connection-endpoint-key="gpio:GP13"]',
  );
  await expect(gp13BoardRow).toHaveAttribute("data-connection-endpoint-used", "false");
  await expect(gp13BoardRow.locator(".connection-endpoint-usage")).toHaveText("未使用");

  const dragPicoEnd = await page.evaluateHandle(() => new DataTransfer());
  await buttonBoardSocket.dispatchEvent("dragstart", { dataTransfer: dragPicoEnd });
  await expect(editor.locator(".connection-drop-palette")).toBeVisible();
  await expect(gp13BoardRow).toHaveAttribute("data-drop-compatible", "true");
  await gp13BoardRow.dispatchEvent("dragover", { dataTransfer: dragPicoEnd });
  await gp13BoardRow.dispatchEvent("drop", { dataTransfer: dragPicoEnd });

  await expect(page.getByLabel("押しボタン 入力 接続先")).toHaveValue("GP13");
  await expect(editor.locator(".connection-editor-status")).toContainText(
    "ドラッグで配線を変更しました",
  );
  await expect(
    editor.locator(
      '[data-connection-candidate-kind="gpio"][data-connection-endpoint-key="gpio:GP13"]',
    ),
  ).toHaveAttribute("data-connection-endpoint-used", "true");

  const board = editor.locator(".connection-board-node");
  await board.evaluate((element) => {
    element.scrollTop = Math.min(240, element.scrollHeight - element.clientHeight);
    element.dispatchEvent(new Event("scroll"));
  });
  const picoScrollTopBeforeBoardDrop = await board.evaluate((element) => element.scrollTop);
  expect(picoScrollTopBeforeBoardDrop).toBeGreaterThan(0);

  const dragPicoEndToPalette = await page.evaluateHandle(() => new DataTransfer());
  await editor
    .locator('[data-connection-source-for="button-gp15.input"]')
    .dispatchEvent("dragstart", { dataTransfer: dragPicoEndToPalette });
  const gp12 = editor.locator('[data-connection-drop-endpoint="gpio:GP12"]');
  await expect(gp12).toBeVisible();
  await expect(gp12).toHaveAttribute("data-drop-compatible", "true");
  await expect(editor.locator(".connection-drop-palette")).toContainText("GPIOの接続先へドロップ");
  await expect(editor.locator('[data-connection-drop-endpoint^="adc:"]')).toHaveCount(0);
  await expect(editor.locator('[data-connection-drop-endpoint="gpio:LED"]')).toHaveCount(0);
  await gp12.dispatchEvent("dragover", { dataTransfer: dragPicoEndToPalette });
  await gp12.dispatchEvent("drop", { dataTransfer: dragPicoEndToPalette });

  await expect(page.getByLabel("押しボタン 入力 接続先")).toHaveValue("GP12");
  await expect
    .poll(() => board.evaluate((element) => element.scrollTop))
    .toBe(picoScrollTopBeforeBoardDrop);
  await expect(editor.locator(".connection-editor-status")).toContainText(
    "ドラッグで配線を変更しました",
  );
  await expect(
    editor.locator(
      '[data-connection-candidate-kind][data-connection-endpoint-key="gpio:GP12"]',
    ),
  ).toHaveAttribute("data-connection-endpoint-used", "true");
  await expect(editor.locator('[data-connection-target="button-gp15.input"]')).toHaveAttribute(
    "data-connection-endpoint-key",
    "gpio:GP12",
  );

  const buttonDeviceSocket = editor.locator(
    '[data-connection-port="button-gp15.input"] .connection-socket',
  );
  const displayDcSocket = editor.locator(
    '[data-connection-port="qt095b-ssd1331.dc"] .connection-socket',
  );
  const rgbRedSocket = editor.locator(
    '[data-connection-port="ostamc5a31a-vv.red"] .connection-socket',
  );
  const dragDeviceEnd = await page.evaluateHandle(() => new DataTransfer());
  await buttonDeviceSocket.dispatchEvent("dragstart", { dataTransfer: dragDeviceEnd });
  await expect(editor.locator(".connection-drop-palette")).toBeHidden();
  await expect(displayDcSocket).toHaveAttribute("data-drop-compatible", "true");
  await expect(rgbRedSocket).toHaveAttribute("data-drop-compatible", "false");
  await displayDcSocket.dispatchEvent("dragover", { dataTransfer: dragDeviceEnd });
  await displayDcSocket.dispatchEvent("drop", { dataTransfer: dragDeviceEnd });

  await expect(page.getByLabel("押しボタン 入力 接続先")).toHaveValue("GP2");
  await expect(page.getByLabel("SSD1331 RGB OLED D/C 接続先")).toHaveValue("GP12");
  await expect(
    editor.locator('[data-connection-source-for="button-gp15.input"]'),
  ).toHaveAttribute("data-connection-endpoint", "gpio:GP2");
  await expect(
    editor.locator('[data-connection-source-for="qt095b-ssd1331.dc"]'),
  ).toHaveAttribute("data-connection-endpoint", "gpio:GP12");

  const dragPicoEndToConflict = await page.evaluateHandle(() => new DataTransfer());
  await editor
    .locator('[data-connection-source-for="button-gp15.input"]')
    .dispatchEvent("dragstart", { dataTransfer: dragPicoEndToConflict });
  const gp14BoardRow = editor.locator(
    '[data-connection-candidate-kind="gpio"][data-connection-endpoint-key="gpio:GP14"]',
  );
  await gp14BoardRow.dispatchEvent("dragover", { dataTransfer: dragPicoEndToConflict });
  await gp14BoardRow.dispatchEvent("drop", { dataTransfer: dragPicoEndToConflict });

  await expect(page.getByLabel("押しボタン 入力 接続先")).toHaveValue("GP14");
  await expect(editor.locator(".connection-editor-status")).toContainText(
    "GP14の割り当てが重複しています",
  );
  await expect(page.getByRole("button", { name: "配線を適用" })).toBeDisabled();
});

test("keeps the board stable while dragging from the lower RGB LED", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();

  const editor = page.locator("#connection-editor-root");
  const panel = page.locator(".virtual-board-panel");
  const board = editor.locator(".connection-board-node");
  const redSocket = editor.locator(
    '[data-connection-port="ostamc5a31a-vv.red"] .connection-socket',
  );
  await redSocket.scrollIntoViewIfNeeded();
  const boardBox = await board.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(boardBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(boardBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
  expect(boardBox!.y + boardBox!.height).toBeLessThanOrEqual(
    panelBox!.y + panelBox!.height,
  );
  await expect(board).toHaveCSS("position", "sticky");
  await expect(board).toBeInViewport();
  await board.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  const picoScrollTopBefore = await board.evaluate((element) => element.scrollTop);
  expect(picoScrollTopBefore).toBeGreaterThan(0);
  const boardHeightBefore = await board.evaluate((element) => element.getBoundingClientRect().height);
  const scrollTopBefore = await panel.evaluate((element) => element.scrollTop);

  const dragFromLowerDevice = await page.evaluateHandle(() => new DataTransfer());
  await redSocket.dispatchEvent("dragstart", { dataTransfer: dragFromLowerDevice });

  const pwmIndicatorSocket = editor.locator(
    '[data-connection-port="pwm-indicator-gp16.input"] .connection-socket',
  );
  await expect(editor.locator(".connection-drop-palette")).toBeHidden();
  await expect(pwmIndicatorSocket).toHaveAttribute("data-drop-compatible", "true");
  await expect(
    editor.locator('[data-connection-port="ostamc5a31a-vv.green"] .connection-socket'),
  ).toHaveAttribute("data-drop-compatible", "false");
  const boardHeightDuringDrag = await board.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  const scrollTopDuringDrag = await panel.evaluate((element) => element.scrollTop);
  expect(Math.abs(boardHeightDuringDrag - boardHeightBefore)).toBeLessThan(1);
  expect(Math.abs(scrollTopDuringDrag - scrollTopBefore)).toBeLessThan(1);

  await pwmIndicatorSocket.dispatchEvent("dragover", { dataTransfer: dragFromLowerDevice });
  await pwmIndicatorSocket.dispatchEvent("drop", { dataTransfer: dragFromLowerDevice });

  await expect(page.getByLabel("OSTAMC5A31A-VV RGB LED 赤 接続先")).toHaveValue("GP16");
  await expect(page.getByLabel("PWMインジケーター 入力 接続先")).toHaveValue("GP18");
  await expect
    .poll(() => board.evaluate((element) => element.scrollTop))
    .toBe(picoScrollTopBefore);
  await expect(editor.locator(".connection-drop-palette")).toBeHidden();
  await expect(
    editor.locator('[data-connection-port="ostamc5a31a-vv.red"]'),
  ).toBeInViewport();
});

test("keeps the Pico inside the visible end of the wiring canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();
  const panel = page.locator(".virtual-board-panel");
  const board = page.locator(".connection-board-node");
  await page.locator('[data-connection-port="ostamc5a31a-vv.red"] .connection-socket').scrollIntoViewIfNeeded();
  await panel.evaluate(element => window.scrollBy(0, element.getBoundingClientRect().top + 56));
  // Scrolling near the last device leaves less canvas than panel in view.
  // Font metrics and native scrollbars make this happen naturally on Windows.
  await panel.evaluate(element => {
    const canvas = element.querySelector(".connection-editor-canvas")!;
    const top = Math.max(element.getBoundingClientRect().top, 0);
    element.scrollTop += canvas.getBoundingClientRect().bottom - (top + 360);
  });
  await expect.poll(() => page.evaluate(() => {
    const panel = document.querySelector(".virtual-board-panel")!.getBoundingClientRect();
    const canvas = document.querySelector(".connection-editor-canvas")!.getBoundingClientRect();
    const board = document.querySelector(".connection-board-node")!.getBoundingClientRect();
    return board.top >= Math.max(panel.top, 0) &&
      board.bottom <= Math.min(panel.bottom, canvas.bottom, document.documentElement.clientHeight);
  })).toBe(true);
  await expect(board).toBeInViewport();
});

test("anchors wires to the Pico edge when their pins are scrolled out of view", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("実行可能", { exact: true })).toBeVisible();
  await page.locator(".connection-editor-panel summary").click();

  const editor = page.locator("#connection-editor-root");
  const board = editor.locator(".connection-board-node");
  const redPort = editor.locator('[data-connection-port="ostamc5a31a-vv.red"]');
  const redSource = editor.locator('[data-connection-endpoint="pwm:GP18"]');
  const redWire = editor.locator(
    'path[data-source-endpoint="pwm:GP18"]' +
      '[data-target-connection="ostamc5a31a-vv.red"]',
  );

  await redPort.scrollIntoViewIfNeeded();
  await board.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(redWire).toHaveAttribute("data-source-visibility", "after");

  await expect
    .poll(async () =>
      redWire.evaluate((path) => {
        const match = /^M ([\d.-]+) ([\d.-]+)/.exec(path.getAttribute("d") ?? "");
        const board = document.querySelector<HTMLElement>(".connection-board-node");
        const panel = document.querySelector<HTMLElement>(".virtual-board-panel");
        const canvas = document.querySelector<HTMLElement>(".connection-editor-canvas");
        if (match === null || board === null || panel === null || canvas === null) {
          return Number.POSITIVE_INFINITY;
        }
        const boardBounds = board.getBoundingClientRect();
        const panelBounds = panel.getBoundingClientRect();
        const canvasBounds = canvas.getBoundingClientRect();
        const expected =
          Math.min(boardBounds.bottom, panelBounds.bottom, document.documentElement.clientHeight) -
          canvasBounds.top -
          10;
        return Math.abs(Number(match[2]) - expected);
      }),
    )
    .toBeLessThan(1);

  await board.evaluate((element, sourceSelector) => {
    const source = element.querySelector<HTMLElement>(sourceSelector);
    if (source === null) {
      throw new Error(`Missing board source: ${sourceSelector}`);
    }
    const sourceBounds = source.getBoundingClientRect();
    const boardBounds = element.getBoundingClientRect();
    element.scrollTop +=
      sourceBounds.top + sourceBounds.height / 2 -
      (boardBounds.top + boardBounds.height / 2);
    element.dispatchEvent(new Event("scroll"));
  }, '[data-connection-endpoint="pwm:GP18"]');
  await expect(redWire).toHaveAttribute("data-source-visibility", "visible");
  await expect(redSource).toBeInViewport();

  await board.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(redWire).toHaveAttribute("data-source-visibility", "after");
});

test("reads a checksummed GT-502MGG-N GPS position over UART", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const gpsCard = page.locator('[data-device-instance="gt-502mgg-n"]');
  await expect(runtimeReady).toBeVisible();
  await gpsCard
    .getByRole("textbox", { name: "測位位置（例: 35.681236,139.767125,40）" })
    .fill("43.06417,141.34694,18.5");
  await gpsCard.getByRole("button", { name: "NMEAを生成" }).click();
  await gpsCard
    .getByRole("button", { name: "GT-502MGG-N GPS受信機のサンプルを新しいエディタタブで開く" })
    .click();
  await page.getByRole("button", { name: "スクリプトを実行" }).click();

  await expect(terminal).toContainText("GPS acquisition: waiting");
  await expect(terminal).toContainText("GPS model: GT-502MGG-N", { timeout: 10_000 });
  await expect(terminal).toContainText("Acquisition: fixed");
  await expect(terminal).toContainText("Fix: valid");
  await expect(terminal).toContainText("Latitude: 43.064170");
  await expect(terminal).toContainText("Longitude: 141.346940");
  await expect(terminal).toContainText("Altitude: 18.5 m");
  await expect(terminal).toContainText("NMEA rate: 1 Hz");
  await expect(terminal).toContainText("PPS GP14: detected");
  await expect(terminal).toContainText("NMEA checksums: OK");
  await expect(
    gpsCard.locator('[data-device-component="latitude"] output'),
  ).toHaveText("43.06417");
  await expect(
    gpsCard.locator('[data-device-component="acquisition"] output'),
  ).toHaveText("fixed");
  await expect(gpsCard.locator('[data-device-component="pps"] output')).toHaveText("HIGH");
  await expect(runtimeReady).toBeVisible();
});

test("mixes three PWM channels on the OSTAMC5A31A-VV RGB LED", async ({ page }) => {
  await page.goto("/");

  const runtimeReady = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const rgbCard = page.locator('[data-device-instance="ostamc5a31a-vv"]');
  await expect(runtimeReady).toBeVisible();
  await rgbCard
    .getByRole("button", { name: "OSTAMC5A31A-VV RGB LEDのサンプルを新しいエディタタブで開く" })
    .click();
  await page.getByRole("button", { name: "スクリプトを実行" }).click();

  await expect(terminal).toContainText("RGB LED model: OSTAMC5A31A-VV");
  await expect(terminal).toContainText("PWM pins: R=GP18 G=GP20 B=GP22");
  await expect(terminal).toContainText("Final color: #ff40b4");
  await expect(rgbCard.locator('[data-device-component="hex-color"] output')).toHaveText(
    "#ff40b4",
  );
  await expect(rgbCard.locator('[data-device-component="red-duty"] output')).toHaveText(
    "65,535",
  );
  await expect(rgbCard.locator('[data-device-component="green-duty"] output')).toHaveText(
    "16,448",
  );
  await expect(rgbCard.locator('[data-device-component="blue-duty"] output')).toHaveText(
    "46,260",
  );
  const canvas = rgbCard.locator('[data-device-component="color"] canvas');
  await expect(canvas).toHaveAttribute("data-state", "ready");
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) =>
      Array.from(element.getContext("2d")!.getImageData(0, 0, 1, 1).data),
    ),
  ).toEqual([255, 73, 170, 255]);
  await expect(runtimeReady).toBeVisible();
});

test("runs a complete script and keeps the runtime usable after a Python error", async ({ page }) => {
  await page.goto("/");

  const status = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const editor = page.locator("#code-editor");
  const run = page.getByRole("button", { name: "スクリプトを実行" });

  await expect(status).toBeVisible();
  await editor.fill('print("script value", 6 * 7)');
  await run.click();
  await expect(terminal).toContainText("script value 42");
  await expect(terminal).toContainText("[script] 実行が完了しました。");
  await expect(status).toBeVisible();

  await editor.fill('raise ValueError("script failed")');
  await run.click();
  await expect(terminal).toContainText("ValueError: script failed");
  await expect(terminal).toContainText("[script error]");
  await expect(status).toBeVisible();

  await page.locator("#repl-input").fill("40 + 2");
  await page.getByRole("button", { name: "REPLへ送信" }).click();
  await expect(terminal).toContainText("42");
});

test("runs MicroPython and recovers by replacing an unresponsive worker", async ({ page }) => {
  await page.goto("/");

  const status = page.getByText("実行可能", { exact: true });
  const version = page.locator("#runtime-version");
  const terminal = page.locator("#terminal");
  const input = page.locator("#repl-input");
  const send = page.getByRole("button", { name: "REPLへ送信" });

  await expect(status).toBeVisible();
  await expect(version).toContainText("MicroPython v1.28.0");
  await expect(version).toContainText("restricted · e0e9fbb");
  await expect(terminal).toContainText(">>>");

  await input.fill("1 + 2");
  await send.click();
  await expect(terminal).toContainText("3");

  await input.fill("def add(a, b):\n    return a + b\n\nadd(20, 22)");
  await send.click();
  await expect(terminal).toContainText("42");

  await input.fill("1 / 0");
  await send.click();
  await expect(terminal).toContainText("ZeroDivisionError");

  await input.fill("while True:\n    pass");
  await send.click();
  await expect(terminal).toContainText("while True:");

  await page.keyboard.press("Meta+c");
  await expect(terminal).toContainText("実行中のコードを強制停止");
  await expect(status).toBeVisible();
  await expect(terminal).toContainText(">>>");

  await input.fill("while True:\n    pass");
  await send.click();
  await expect(terminal).toContainText("while True:");

  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByText("停止中", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "再起動" }).click();
  await expect(status).toBeVisible();
  await expect(version).toContainText("MicroPython v1.28.0");
  await expect(terminal).toContainText("Workerを再生成しています");
});

test("blocks unrestricted JavaScript and network modules", async ({ page }) => {
  await page.goto("/");

  const status = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  const editor = page.locator("#code-editor");
  const run = page.getByRole("button", { name: "スクリプトを実行" });

  await expect(status).toBeVisible();

  for (const moduleName of ["js", "jsffi", "socket", "network"]) {
    await editor.fill(`import ${moduleName}`);
    await run.click();
    await expect(terminal).toContainText(`ImportError: no module named '${moduleName}'`);
    await expect(status).toBeVisible();
  }

  await editor.fill(
    'from machine import Pin\nled = Pin("LED", Pin.OUT)\nled.on()\nprint(led.value())',
  );
  await run.click();
  await expect(
    page.locator('[data-device-instance="built-in-led"] [data-device-component="output"] output'),
  ).toHaveText("点灯");
  await expect(terminal).toContainText("1");
});

test("automatically replaces a worker after the execution time limit", async ({ page }) => {
  await page.goto("/");

  const status = page.getByText("実行可能", { exact: true });
  const terminal = page.locator("#terminal");
  await expect(status).toBeVisible();
  await expect(page.getByText("実動時間は最大10秒・出力100,000文字です")).toBeVisible();

  await page.locator("#code-editor").fill("while True:\n    pass");
  await page.getByRole("button", { name: "スクリプトを実行" }).click();
  await expect(page.getByText("スクリプト実行中", { exact: true })).toBeVisible();

  await expect(terminal).toContainText("実行時間が10秒の上限を超えた", {
    timeout: 15_000,
  });
  await expect(status).toBeVisible();
  await expect(terminal).toContainText(">>>");
});
