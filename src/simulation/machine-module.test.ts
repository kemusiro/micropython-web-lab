import { describe, expect, it } from "vitest";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { DeviceHost, type DeviceStateEvent } from "../device-api/device-host";
import {
  createReferencePwmIndicatorDefinition,
  createReferenceSpiRegisterDefinition,
  createReferenceUartEchoDefinition,
} from "../device-api/reference-devices";
import {
  createMachineModule,
  MACHINE_PIN_IN,
  MACHINE_PIN_OUT,
  MACHINE_PIN_PULL_DOWN,
  MACHINE_PIN_PULL_UP,
  MACHINE_SPI_LSB,
  MACHINE_SPI_MSB,
} from "./machine-module";
import { VirtualGpioBoard, type VirtualDeviceState } from "./virtual-gpio";
import { VirtualI2cBus, VirtualRegisterI2cDevice } from "./virtual-i2c";

describe("machine module adapter", () => {
  it("implements the minimal output Pin API", () => {
    const events: VirtualDeviceState[] = [];
    const module = createMachineModule(new VirtualGpioBoard((state) => events.push(state)));
    const pin = module.Pin("LED", module.Pin.OUT);

    expect(module.Pin.IN).toBe(MACHINE_PIN_IN);
    expect(module.Pin.OUT).toBe(MACHINE_PIN_OUT);
    expect(module.Pin.PULL_UP).toBe(MACHINE_PIN_PULL_UP);
    expect(module.Pin.PULL_DOWN).toBe(MACHINE_PIN_PULL_DOWN);
    expect(pin.value()).toBe(0);
    pin.on();
    expect(pin.value()).toBe(1);
    pin.toggle();
    expect(pin.value()).toBe(0);
    pin.value(true);
    expect(pin.value()).toBe(1);
    expect(events.at(-1)).toEqual({
      kind: "gpio-pin",
      sequence: 4,
      pinId: "LED",
      mode: "output",
      value: 1,
    });
  });

  it("validates pin ids, modes, and values", () => {
    const module = createMachineModule(new VirtualGpioBoard(() => undefined));

    expect(() => module.Pin("", module.Pin.OUT)).toThrow("Pin id");
    expect(() => module.Pin(23, module.Pin.OUT)).toThrow("Unsupported Pico 2 W GPIO pin");
    expect(() => module.Pin("LED", 99)).toThrow("Unsupported Pin mode");
    expect(() => module.Pin("15", module.Pin.IN, 99)).toThrow("Unsupported Pin pull");
    expect(() => module.Pin("LED", module.Pin.OUT).value("on")).toThrow("Pin value");
  });

  it("reads an active-low virtual input through Pin", () => {
    let value: 0 | 1 = 1;
    const module = createMachineModule(
      new VirtualGpioBoard(
        () => undefined,
        (pinId) => (pinId === "15" ? value : null),
      ),
    );
    const button = module.Pin(15, module.Pin.IN, module.Pin.PULL_UP);

    expect(button.value()).toBe(1);
    value = 0;
    expect(button.value()).toBe(0);
  });

  it("reads the virtual ADC by GPIO, channel, or Pin object", () => {
    let value = 32_768;
    const module = createMachineModule(
      new VirtualGpioBoard(
        () => undefined,
        () => null,
        (pinId) => (pinId === "26" ? value : null),
      ),
    );

    expect(module.ADC(26).read_u16()).toBe(32_768);
    value = 65_535;
    expect(module.ADC(0).read_u16()).toBe(65_535);
    expect(module.ADC(module.Pin(26)).read_u16()).toBe(65_535);
  });

  it("rejects ADC sources without a virtual analog input", () => {
    const module = createMachineModule(new VirtualGpioBoard(() => undefined));

    expect(() => module.ADC(27)).toThrow("Unsupported ADC source: 27");
    expect(() => module.ADC(module.Pin(15))).toThrow("Unsupported ADC source: 15");
  });

  it("exposes scan and register transfers through machine.I2C", () => {
    const bus = new VirtualI2cBus();
    bus.attach(new VirtualRegisterI2cDevice());
    const module = createMachineModule(new VirtualGpioBoard(() => undefined), { i2cBus: bus });
    const i2c = module.I2C(0);

    expect(i2c.scan()).toEqual([0x50]);
    expect(i2c.writeto_mem(0x50, 0x10, Uint8Array.of(65, 66, 67))).toBeUndefined();
    expect(i2c.readfrom_mem(0x50, 0x10, 3)).toEqual(Uint8Array.of(65, 66, 67));
    expect(i2c.writeto(0x50, Uint8Array.of(0x10))).toBe(1);
    expect(i2c.readfrom(0x50, 3)).toEqual(Uint8Array.of(65, 66, 67));
  });

  it("accepts RP2-style I2C keyword options and injected Python converters", () => {
    const bus = new VirtualI2cBus();
    bus.attach(new VirtualRegisterI2cDevice());
    const module = createMachineModule(new VirtualGpioBoard(() => undefined), {
      i2cBus: bus,
      toPythonBytes: (bytes) => ({ pythonBytes: [...bytes] }),
      toPythonList: (values) => ({ pythonList: [...values] }),
    });
    const i2c = module.I2C(0, {
      scl: module.Pin(9),
      sda: module.Pin(8),
      freq: 400_000,
      timeout: 50_000,
    });

    expect(i2c.scan()).toEqual({ pythonList: [0x50] });
    expect(i2c.readfrom(0x50, 2)).toEqual({ pythonBytes: [0, 0] });
  });

  it("rejects unsupported I2C buses and invalid transfer arguments", () => {
    const bus = new VirtualI2cBus();
    bus.attach(new VirtualRegisterI2cDevice());
    const module = createMachineModule(new VirtualGpioBoard(() => undefined), { i2cBus: bus });

    expect(() => module.I2C(1)).toThrow("Unsupported I2C bus: 1");
    expect(() =>
      module.I2C(0, { scl: module.Pin(7), sda: module.Pin(8) }),
    ).toThrow("I2C0 SCL must use GP9");
    expect(() => module.I2C(0, { freq: 0 })).toThrow("positive integer");
    expect(() => module.I2C(0).readfrom(0x51, 1)).toThrow("No virtual I2C device");
    expect(() => module.I2C(0).writeto_mem(0x50, 0, [256])).toThrow(
      "integers from 0 to 255",
    );
    expect(() => module.I2C(0).readfrom_mem(0x50, 0, 1, 16)).toThrow("addrsize=8");
  });

  it("transfers full-duplex register data through machine.SPI", () => {
    const host = createPeripheralHost();
    host.create("spi", createReferenceSpiRegisterDefinition());
    const module = createMachineModule(new VirtualGpioBoard(() => undefined), {
      spiTarget: host.getPort("spi", "spi", "spi-target"),
    });
    const spi = module.SPI(0, {
      baudrate: 2_000_000,
      polarity: 1,
      phase: 0,
      firstbit: module.SPI.MSB,
      sck: module.Pin(6),
      mosi: module.Pin(7),
      miso: module.Pin(4),
    });

    expect(module.SPI.MSB).toBe(MACHINE_SPI_MSB);
    expect(module.SPI.LSB).toBe(MACHINE_SPI_LSB);
    expect(spi.write(Uint8Array.of(0x10, 0xaa, 0xbb))).toBeUndefined();
    const response = new Uint8Array(3);
    spi.write_readinto(Uint8Array.of(0x90, 0, 0), response);
    expect(response).toEqual(Uint8Array.of(0, 0xaa, 0xbb));

    const filled = new Uint8Array(2);
    spi.readinto(filled, 0xff);
    expect(filled).toHaveLength(2);
    spi.deinit();
    expect(() => spi.write(Uint8Array.of(1))).toThrow("deinitialized");
  });

  it("validates SPI bus pins, configuration, and transfer buffers", () => {
    const host = createPeripheralHost();
    host.create("spi", createReferenceSpiRegisterDefinition());
    const module = createMachineModule(new VirtualGpioBoard(() => undefined), {
      spiTarget: host.getPort("spi", "spi", "spi-target"),
    });

    expect(() => module.SPI(1)).toThrow("Unsupported SPI bus");
    expect(() => module.SPI(0, { sck: module.Pin(5) })).toThrow("SPI0 SCK must use GP6");
    expect(() => module.SPI(0, { bits: 16 })).toThrow("only 8 data bits");
    expect(() => module.SPI(0, { firstbit: 3 })).toThrow("SPI.MSB or SPI.LSB");
    expect(() =>
      module.SPI(0).write_readinto(Uint8Array.of(1), new Uint8Array(2)),
    ).toThrow("same length");
  });

  it("echoes ordered bytes through machine.UART", () => {
    const host = createPeripheralHost();
    host.create("uart", createReferenceUartEchoDefinition());
    const module = createMachineModule(new VirtualGpioBoard(() => undefined), {
      uartPeer: host.getPort("uart", "uart", "uart-peer"),
    });
    const uart = module.UART(0, 115_200, {
      tx: module.Pin(0),
      rx: module.Pin(1),
      bits: 8,
      parity: null,
      stop: 1,
    });

    expect(uart.write(Uint8Array.of(65, 66, 67, 10, 90))).toBe(5);
    expect(uart.any()).toBe(5);
    expect(uart.readline()).toEqual(Uint8Array.of(65, 66, 67, 10));
    expect(uart.read()).toEqual(Uint8Array.of(90));
    expect(uart.read()).toBeNull();

    uart.write(Uint8Array.of(1, 2, 3));
    const buffer = new Uint8Array(4);
    expect(uart.readinto(buffer, 2)).toBe(2);
    expect(buffer).toEqual(Uint8Array.of(1, 2, 0, 0));
    expect(uart.read(1)).toEqual(Uint8Array.of(3));
    uart.deinit();
    expect(() => uart.any()).toThrow("deinitialized");
  });

  it("validates UART bus pins and v1 framing", () => {
    const host = createPeripheralHost();
    host.create("uart", createReferenceUartEchoDefinition());
    const module = createMachineModule(new VirtualGpioBoard(() => undefined), {
      uartPeer: host.getPort("uart", "uart", "uart-peer"),
    });

    expect(() => module.UART(1)).toThrow("Unsupported UART bus");
    expect(() => module.UART(0, { tx: module.Pin(2) })).toThrow("UART0 TX must use GP0");
    expect(() => module.UART(0, { bits: 7 })).toThrow("only 8 data bits");
    expect(() => module.UART(0, { parity: 2 })).toThrow("parity");
    expect(() => module.UART(0, { invert: 1 })).toThrow("inversion");
  });

  it("normalizes machine.PWM frequency and duty values for a Device API observer", () => {
    const events: DeviceStateEvent[] = [];
    const host = createPeripheralHost((event) => events.push(event));
    host.create("pwm", createReferencePwmIndicatorDefinition());
    const pwmPort = host.getPort("pwm", "input", "pwm-observer");
    const module = createMachineModule(new VirtualGpioBoard(() => undefined), {
      pwmObserver: (pinId) => (pinId === "16" ? pwmPort : null),
    });
    const pwm = module.PWM(module.Pin(16), { freq: 1_000, duty_u16: 32_768 });

    expect(pwm.freq()).toBe(1_000);
    expect(pwm.duty_u16()).toBe(32_768);
    pwm.freq(2_000);
    pwm.duty_ns(250_000);
    expect(pwm.duty_ns()).toBe(250_004);
    expect(pwm.duty_u16()).toBe(32_768);
    pwm.deinit();
    expect(events.at(-1)?.state).toEqual({
      enabled: false,
      frequencyHz: 2_000,
      dutyU16: 32_768,
      inverted: false,
    });
  });

  it("validates PWM pins and value ranges", () => {
    const module = createMachineModule(new VirtualGpioBoard(() => undefined));

    expect(() => module.PWM(16)).toThrow("machine.Pin");
    expect(() => module.PWM(module.Pin("LED"))).toThrow("Unsupported PWM pin");
    expect(() => module.PWM(module.Pin(16), { duty_u16: 65_536 })).toThrow("65535");
    expect(() => module.PWM(module.Pin(16), { freq: 0 })).toThrow("positive finite");
    expect(() =>
      module.PWM(module.Pin(16), { freq: 1_000, duty_ns: 1_000_001 }),
    ).toThrow("period");
  });
});

function createPeripheralHost(
  onState: (event: DeviceStateEvent) => void = () => undefined,
): DeviceHost {
  const profile = RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
  return new DeviceHost(
    {
      profileId: profile.id,
      profileVersion: profile.version,
      capabilities: profile.capabilities,
    },
    onState,
  );
}
