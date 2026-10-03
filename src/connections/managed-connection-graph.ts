import { validateConnectionGraph } from "./connection-model.ts";

export const MANAGED_CONNECTION_GRAPH = validateConnectionGraph({
  schemaVersion: 1,
  boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
  devices: [
    {
      instanceId: "built-in-led",
      deviceId: "org.micropython-web-lab.reference-led",
      deviceVersion: "0.1.0",
      ports: [{ portId: "output", endpoint: { kind: "gpio", pin: "LED" } }],
    },
    {
      instanceId: "button-gp15",
      deviceId: "org.micropython-web-lab.reference-button",
      deviceVersion: "0.1.0",
      ports: [{ portId: "input", endpoint: { kind: "gpio", pin: "GP15" } }],
    },
    {
      instanceId: "analog-gp26",
      deviceId: "org.micropython-web-lab.reference-analog-input",
      deviceVersion: "0.1.0",
      ports: [{ portId: "input", endpoint: { kind: "adc", pin: "GP26" } }],
    },
    {
      instanceId: "i2c-register-0x50",
      deviceId: "org.micropython-web-lab.reference-i2c-register",
      deviceVersion: "0.1.0",
      ports: [{ portId: "i2c", endpoint: { kind: "i2c", controller: 0, address: 0x50 } }],
    },
    {
      instanceId: "ae-bme280-0x76",
      deviceId: "org.micropython-web-lab.ae-bme280",
      deviceVersion: "0.1.0",
      ports: [{ portId: "i2c", endpoint: { kind: "i2c", controller: 0, address: 0x76 } }],
    },
    {
      instanceId: "spi-register-0",
      deviceId: "org.micropython-web-lab.reference-spi-register",
      deviceVersion: "0.1.0",
      ports: [{ portId: "spi", endpoint: { kind: "spi", controller: 0, fallback: true } }],
    },
    {
      instanceId: "qt095b-ssd1331",
      deviceId: "org.micropython-web-lab.qt095b-ssd1331",
      deviceVersion: "0.1.0",
      ports: [
        {
          portId: "spi",
          endpoint: { kind: "spi", controller: 0, selectPort: "cs", activeLevel: 0 },
        },
        { portId: "cs", endpoint: { kind: "gpio", pin: "GP5" } },
        { portId: "dc", endpoint: { kind: "gpio", pin: "GP2" } },
        { portId: "reset", endpoint: { kind: "gpio", pin: "GP3" } },
      ],
    },
    {
      instanceId: "gt-502mgg-n",
      deviceId: "org.micropython-web-lab.gt-502mgg-n",
      deviceVersion: "0.2.0",
      ports: [
        { portId: "uart", endpoint: { kind: "uart", controller: 0 } },
        { portId: "pps", endpoint: { kind: "gpio", pin: "GP14" } },
      ],
    },
    {
      instanceId: "pwm-indicator-gp16",
      deviceId: "org.micropython-web-lab.reference-pwm-indicator",
      deviceVersion: "0.1.0",
      ports: [{ portId: "input", endpoint: { kind: "pwm", pin: "GP16" } }],
    },
    {
      instanceId: "ostamc5a31a-vv",
      deviceId: "org.micropython-web-lab.ostamc5a31a-vv",
      deviceVersion: "0.1.0",
      ports: [
        { portId: "red", endpoint: { kind: "pwm", pin: "GP18" } },
        { portId: "green", endpoint: { kind: "pwm", pin: "GP20" } },
        { portId: "blue", endpoint: { kind: "pwm", pin: "GP22" } },
      ],
    },
  ],
});
