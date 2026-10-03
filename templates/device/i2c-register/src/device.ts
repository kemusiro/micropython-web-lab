import type {
  DeviceContext,
  DeviceDefinition,
  DeviceModel,
} from "@micropython-web-lab/device-api";

export const I2C_ADDRESS = 0x48;

const definition: DeviceDefinition = {
  manifest: {
    schemaVersion: 1,
    id: "org.example.i2c-register-template",
    version: "0.1.0",
    deviceApiVersion: 1,
    name: "I2C Register Template",
    description: "Minimal I2C register device for local Device API development",
    license: "MIT",
    entrypoint: "./dist/device.js",
    requires: { boardCapabilities: ["i2c-controller-v1"] },
    ports: [{ id: "i2c", kind: "i2c-target", defaultAddress: I2C_ADDRESS }],
  },
  create: createModel,
};

export default definition;

function createModel(context: DeviceContext): DeviceModel {
  const registers = new Uint8Array(256);
  let pointer = 0;
  let transactionCount = 0;

  const advance = (start: number, count: number): number => (start + count) & 0xff;
  const emit = (): void => {
    context.emitState({ address: I2C_ADDRESS, pointer, transactionCount });
  };
  const read = (start: number, count: number): Uint8Array => {
    const result = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      result[index] = registers[advance(start, index)]!;
    }
    pointer = advance(start, count);
    transactionCount += 1;
    emit();
    return result;
  };
  const write = (start: number, data: Uint8Array): void => {
    for (let index = 0; index < data.length; index += 1) {
      registers[advance(start, index)] = data[index]!;
    }
    pointer = advance(start, data.length);
    transactionCount += 1;
    emit();
  };

  emit();
  return {
    ports: {
      i2c: {
        kind: "i2c-target",
        addresses: [I2C_ADDRESS],
        read: (count) => read(pointer, count),
        write(data): void {
          if (data.length === 0) {
            transactionCount += 1;
            emit();
            return;
          }
          pointer = data[0]!;
          if (data.length === 1) {
            transactionCount += 1;
            emit();
            return;
          }
          write(pointer, data.subarray(1));
        },
        readMemory: read,
        writeMemory: write,
      },
    },
    reset(): void {
      registers.fill(0);
      pointer = 0;
      transactionCount = 0;
      emit();
    },
  };
}
