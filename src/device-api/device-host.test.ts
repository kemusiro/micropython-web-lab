import { describe, expect, it, vi } from "vitest";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { DeviceHost, type DeviceStateEvent } from "./device-host";
import type {
  DeviceDefinition,
  DeviceClock,
  DeviceManifestV1,
  DeviceModel,
  DevicePortKind,
} from "./types";

const BOARD_CONTEXT = {
  profileId: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.id,
  profileVersion: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.version,
  capabilities: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.capabilities,
};

describe("DeviceHost", () => {
  it("validates, snapshots, and sequences state emitted during creation and actions", () => {
    const events: DeviceStateEvent[] = [];
    const source = { value: 0 };
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create(
      "led",
      definition("gpio-observer", ({ emitState }) => {
        emitState(source);
        return {
          ports: {
            port: {
              kind: "gpio-observer",
              write(value): void {
                source.value = value;
                emitState(source);
              },
            },
          },
          reset: () => undefined,
        };
      }),
    );

    source.value = 99;
    host.getPort("led", "port", "gpio-observer").write(1);

    expect(events).toEqual([
      { instanceId: "led", sequence: 1, state: { value: 0 } },
      { instanceId: "led", sequence: 2, state: { value: 1 } },
    ]);
    expect(Object.isFrozen(events[0]!.state)).toBe(true);
  });

  it("rejects nested, non-finite, and oversized device state", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    expect(() =>
      host.create(
        "nested",
        definition("gpio-driver", ({ emitState }) => {
          emitState({ nested: {} } as never);
          return emptyModel("gpio-driver");
        }),
      ),
    ).toThrow("must be a scalar");
    expect(() =>
      host.create(
        "infinite",
        definition("gpio-driver", ({ emitState }) => {
          emitState({ value: Number.POSITIVE_INFINITY });
          return emptyModel("gpio-driver");
        }),
      ),
    ).toThrow("must be finite");
    expect(() =>
      host.create(
        "large",
        definition("gpio-driver", ({ emitState }) => {
          emitState({ text: "x".repeat(16 * 1_024) });
          return emptyModel("gpio-driver");
        }),
      ),
    ).toThrow("16384-byte limit");
  });

  it("rejects mismatched manifests and unsupported board capabilities", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    const disposeAfterFailure = vi.fn();
    expect(() =>
      host.create("missing", {
        ...definition("gpio-driver", () => ({
          ports: {},
          reset: () => undefined,
          dispose: disposeAfterFailure,
        })),
      }),
    ).toThrow("did not return declared port");
    expect(disposeAfterFailure).toHaveBeenCalledOnce();

    const base = definition("gpio-driver", () => emptyModel("gpio-driver"));
    const unsupported: DeviceDefinition = {
      ...base,
      manifest: {
        ...base.manifest,
        requires: { boardCapabilities: ["unsupported-v1"] },
      },
    };
    expect(() => host.create("unsupported", unsupported)).toThrow("required capability");
  });

  it("uses the SDK manifest validator before running third-party model code", () => {
    const create = vi.fn(() => emptyModel("gpio-driver"));
    const base = definition("gpio-driver", create);
    const untrustedDefinition = {
      ...base,
      manifest: { ...base.manifest, approved: true },
    } as DeviceDefinition;

    expect(() => new DeviceHost(BOARD_CONTEXT).create("untrusted", untrustedDefinition)).toThrow(
      "device.json.approved",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("enforces port value ranges and transfer limits at the host boundary", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create(
      "ports",
      multiPortDefinition(() => ({
        ports: {
          gpio: { kind: "gpio-driver", read: () => 2 as 0 },
          adc: { kind: "adc-source", readU16: () => 65_536 },
          i2c: {
            kind: "i2c-target",
            addresses: [0x50],
            read: (count) => new Uint8Array(count),
            write: () => undefined,
            readMemory: (_address, count) => new Uint8Array(count),
            writeMemory: () => undefined,
          },
          spi: {
            kind: "spi-target",
            configure: () => undefined,
            transfer: (data) => new Uint8Array(Math.max(0, data.length - 1)),
          },
          uart: {
            kind: "uart-peer",
            configure: () => undefined,
            writeFromBoard: (data) => data.length + 1,
            availableToBoard: () => 4_097,
            readForBoard: (count) => new Uint8Array(count + 1),
          },
          pwm: { kind: "pwm-observer", update: () => undefined },
        },
        reset: () => undefined,
      })),
    );

    expect(() => host.getPort("ports", "gpio", "gpio-driver").read()).toThrow("0 or 1");
    expect(() => host.getPort("ports", "adc", "adc-source").readU16()).toThrow("65535");
    expect(() =>
      host.getPort("ports", "i2c", "i2c-target").read(257),
    ).toThrow("transfer length");
    expect(() =>
      host.getPort("ports", "spi", "spi-target").transfer(Uint8Array.of(1)),
    ).toThrow("response length");
    expect(() =>
      host.getPort("ports", "uart", "uart-peer").writeFromBoard(Uint8Array.of(1)),
    ).toThrow("accepted byte count");
    expect(() => host.getPort("ports", "uart", "uart-peer").availableToBoard()).toThrow(
      "available byte count",
    );
    expect(() =>
      host.getPort("ports", "pwm", "pwm-observer").update({
        enabled: true,
        frequencyHz: 0,
        dutyU16: 1,
        inverted: false,
      }),
    ).toThrow("positive finite");
  });

  it("copies transfer buffers before crossing the device boundary", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    let received: Uint8Array | null = null;
    host.create(
      "spi",
      definition("spi-target", () => ({
        ports: {
          port: {
            kind: "spi-target",
            configure: () => undefined,
            transfer(data): Uint8Array {
              received = data;
              data[0] = 99;
              return data;
            },
          },
        },
        reset: () => undefined,
      })),
    );
    const sent = Uint8Array.of(1, 2);
    const response = host.getPort("spi", "port", "spi-target").transfer(sent);
    response[0] = 42;

    expect(sent).toEqual(Uint8Array.of(1, 2));
    expect(received).toEqual(Uint8Array.of(99, 2));
  });

  it("resets and disposes instances without accepting late state", () => {
    const reset = vi.fn();
    const dispose = vi.fn();
    let emitLate: (() => void) | null = null;
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create(
      "lifecycle",
      definition("gpio-driver", ({ emitState }) => {
        emitLate = () => emitState({ ready: true });
        return {
          ports: { port: { kind: "gpio-driver", read: () => 1 } },
          reset,
          dispose,
        };
      }),
    );

    host.reset("lifecycle");
    host.dispose("lifecycle");

    expect(reset).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(() => emitLate?.()).toThrow("Disposed device instance");
    expect(() => host.getPort("lifecycle", "port", "gpio-driver")).toThrow(
      "Unknown device instance",
    );
  });

  it("resets every active instance in creation order", () => {
    const resets: string[] = [];
    const host = new DeviceHost(BOARD_CONTEXT);
    for (const instanceId of ["first", "second"]) {
      host.create(
        instanceId,
        definition("gpio-driver", () => ({
          ports: { port: { kind: "gpio-driver", read: () => 1 } },
          reset: () => {
            resets.push(instanceId);
          },
        })),
      );
    }

    host.resetAll();

    expect(resets).toEqual(["first", "second"]);
  });

  it("provides an injectable validated monotonic clock without requiring old devices to use it", () => {
    let now = 125;
    const clock: DeviceClock = { monotonicMilliseconds: () => now };
    const observed: number[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, () => undefined, undefined, clock);
    host.create(
      "clocked",
      definition("gpio-driver", (context) => ({
        ports: {
          port: {
            kind: "gpio-driver",
            read: () => {
              observed.push(context.clock!.monotonicMilliseconds());
              return 1;
            },
          },
        },
        reset: () => undefined,
      })),
    );

    host.getPort("clocked", "port", "gpio-driver").read();
    now = 250.5;
    host.getPort("clocked", "port", "gpio-driver").read();
    expect(observed).toEqual([125, 250.5]);

    now = 249;
    expect(() => host.getPort("clocked", "port", "gpio-driver").read()).toThrow(
      "must not move backwards",
    );
  });
});

function definition(
  kind: DevicePortKind,
  create: DeviceDefinition["create"],
): DeviceDefinition {
  return {
    manifest: manifest([{ id: "port", kind }]),
    create,
  };
}

function multiPortDefinition(create: DeviceDefinition["create"]): DeviceDefinition {
  return {
    manifest: manifest([
      { id: "gpio", kind: "gpio-driver" },
      { id: "adc", kind: "adc-source" },
      { id: "i2c", kind: "i2c-target" },
      { id: "spi", kind: "spi-target" },
      { id: "uart", kind: "uart-peer" },
      { id: "pwm", kind: "pwm-observer" },
    ]),
    create,
  };
}

function manifest(ports: DeviceManifestV1["ports"]): DeviceManifestV1 {
  return {
    schemaVersion: 1,
    id: "org.example.test-device",
    version: "1.0.0",
    deviceApiVersion: 1,
    name: "Test Device",
    description: "Test device",
    license: "MIT",
    entrypoint: "./device.js",
    requires: { boardCapabilities: ["digital-gpio-v1"] },
    ports,
  };
}

function emptyModel(kind: "gpio-driver"): DeviceModel {
  return { ports: { port: { kind, read: () => 1 } }, reset: () => undefined };
}
