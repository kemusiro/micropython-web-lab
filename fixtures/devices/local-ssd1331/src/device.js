const manifest = Object.freeze({
  schemaVersion: 1,
  id: "org.example.local-ssd1331",
  version: "0.1.0",
  deviceApiVersion: 1,
  name: "Local SSD1331 Fixture",
  description: "Local multi-device SPI fixture modeled after an SSD1331",
  license: "MIT",
  entrypoint: "./src/device.js",
  requires: { boardCapabilities: ["spi-controller-v1", "digital-gpio-v1"] },
  ports: [
    { id: "spi", kind: "spi-target" },
    { id: "cs", kind: "gpio-observer" },
    { id: "dc", kind: "gpio-observer" },
    { id: "reset", kind: "gpio-observer" },
  ],
});

export default {
  manifest,
  create(context) {
    let cs = 1;
    let dc = 0;
    let reset = 1;
    let transferCount = 0;
    let baudrate = 0;
    const emit = () => context.emitState({ cs, dc, reset, transferCount, baudrate });
    const observe = (key) => ({
      kind: "gpio-observer",
      write(value) {
        if (key === "cs") cs = value;
        if (key === "dc") dc = value;
        if (key === "reset") reset = value;
        emit();
      },
    });
    emit();
    return {
      ports: {
        spi: {
          kind: "spi-target",
          configure(configuration) {
            baudrate = configuration.baudrate;
            emit();
          },
          transfer(data) {
            transferCount += 1;
            emit();
            return Uint8Array.from(data, (value) => value ^ 0xa5);
          },
        },
        cs: observe("cs"),
        dc: observe("dc"),
        reset: observe("reset"),
      },
      reset() {
        cs = 1;
        dc = 0;
        reset = 1;
        transferCount = 0;
        baudrate = 0;
        emit();
      },
    };
  },
};
