const manifest = Object.freeze({
  schemaVersion: 1,
  id: "org.example.local-bme280",
  version: "0.1.0",
  deviceApiVersion: 1,
  name: "Local BME280 Fixture",
  description: "Local multi-device I2C fixture modeled after a BME280",
  license: "MIT",
  entrypoint: "./src/device.js",
  requires: { boardCapabilities: ["i2c-controller-v1"] },
  ports: [{ id: "i2c", kind: "i2c-target", defaultAddress: 0x76 }],
});

export default {
  manifest,
  create(context) {
    const registers = new Uint8Array(256);
    let pointer = 0;
    let transactionCount = 0;
    const initialize = () => {
      registers.fill(0);
      registers[0xd0] = 0x60;
      pointer = 0;
    };
    const emit = () => context.emitState({ address: 0x76, transactionCount });
    const readMemory = (address, byteCount) => {
      const output = new Uint8Array(byteCount);
      for (let index = 0; index < byteCount; index += 1) {
        output[index] = registers[(address + index) & 0xff];
      }
      pointer = (address + byteCount) & 0xff;
      transactionCount += 1;
      emit();
      return output;
    };
    const writeMemory = (address, data) => {
      for (let index = 0; index < data.length; index += 1) {
        registers[(address + index) & 0xff] = data[index];
      }
      pointer = (address + data.length) & 0xff;
      transactionCount += 1;
      emit();
    };
    initialize();
    emit();
    return {
      ports: {
        i2c: {
          kind: "i2c-target",
          addresses: [0x76],
          read(byteCount) {
            return readMemory(pointer, byteCount);
          },
          write(data) {
            if (data.length === 0) {
              transactionCount += 1;
              emit();
              return;
            }
            pointer = data[0];
            if (data.length > 1) {
              writeMemory(pointer, data.subarray(1));
            } else {
              transactionCount += 1;
              emit();
            }
          },
          readMemory,
          writeMemory,
        },
      },
      reset() {
        initialize();
        transactionCount = 0;
        emit();
      },
    };
  },
};
