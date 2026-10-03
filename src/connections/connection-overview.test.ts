import { describe, expect, it } from "vitest";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { createConnectionOverviewRows } from "./connection-overview";
import { MANAGED_CONNECTION_GRAPH } from "./managed-connection-graph";

describe("connection overview", () => {
  it("describes the shared BME280 and SSD1331 wiring from the managed graph", () => {
    const rows = createConnectionOverviewRows(
      MANAGED_CONNECTION_GRAPH,
      RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
    );

    expect(rows.find((row) => row.instanceId === "ae-bme280-0x76")?.summary).toBe(
      "I2C0 · SDA=GP8 · SCL=GP9 · アドレス0x76",
    );
    expect(rows.find((row) => row.instanceId === "qt095b-ssd1331")?.summary).toBe(
      "SPI0 · SCK=GP6 · MOSI=GP7 · MISO=GP4 · CS=GP5 (Low選択) · D/C=GP2 · RESET=GP3",
    );
  });
});
