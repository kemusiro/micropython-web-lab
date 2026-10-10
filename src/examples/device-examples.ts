import { BME280_EXAMPLE_SOURCE } from "./bme280-example";
import { GT_502MGG_EXAMPLE_SOURCE } from "./gt-502mgg-example";
import { OSTAMC5A31A_VV_EXAMPLE_SOURCE } from "./ostamc5a31a-vv-example";
import { SSD1331_EXAMPLE_SOURCE } from "./ssd1331-example";

const BUILT_IN_LED_EXAMPLE = `from machine import Pin
from time import sleep_ms

led = Pin("LED", Pin.OUT)
for _ in range(3):
    led.on()
    sleep_ms(250)
    led.off()
    sleep_ms(250)
print("Virtual LED blink complete")`;

function buttonExampleSource(pin: number): string {
  return `from machine import Pin
from time import sleep_ms, ticks_diff, ticks_ms

button = Pin(${pin}, Pin.IN, Pin.PULL_UP)
print("Press and release GPIO ${pin} for 8 seconds")

previous = None
started = ticks_ms()
while ticks_diff(ticks_ms(), started) < 8000:
    current = button.value()
    if current != previous:
        print("Button:", "pressed" if current == 0 else "released")
        previous = current
    sleep_ms(20)

print("Button test complete")`;
}

const ANALOG_EXAMPLE = `from machine import ADC, Pin

analog = ADC(Pin(26))
print("ADC value:", analog.read_u16())`;

const I2C_REGISTER_EXAMPLE = `from machine import I2C, Pin

i2c = I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000)
print("I2C devices:", [hex(address) for address in i2c.scan()])
i2c.writeto_mem(0x50, 0x10, b"ABC")
print("Register:", i2c.readfrom_mem(0x50, 0x10, 3))`;

const SPI_REGISTER_EXAMPLE = `from machine import Pin, SPI

spi = SPI(0, baudrate=1_000_000, polarity=0, phase=0,
          sck=Pin(6), mosi=Pin(7), miso=Pin(4))
spi.write(bytes((0x10, 0x2A)))
print("SPI register write complete")`;

const PWM_INDICATOR_EXAMPLE = `from machine import Pin, PWM
from time import sleep_ms

pwm = PWM(Pin(16), freq=1_000, duty_u16=32_768)
sleep_ms(500)
print("PWM GP16 duty_u16: 32768")`;

const DEVICE_EXAMPLE_SOURCES = new Map<string, string>([
  ["built-in-led", BUILT_IN_LED_EXAMPLE],
  ["button-gp15", buttonExampleSource(15)],
  ["analog-gp26", ANALOG_EXAMPLE],
  ["i2c-register-0x50", I2C_REGISTER_EXAMPLE],
  ["ae-bme280-0x76", BME280_EXAMPLE_SOURCE],
  ["spi-register-0", SPI_REGISTER_EXAMPLE],
  ["qt095b-ssd1331", SSD1331_EXAMPLE_SOURCE],
  ["gt-502mgg-n", GT_502MGG_EXAMPLE_SOURCE],
  ["pwm-indicator-gp16", PWM_INDICATOR_EXAMPLE],
  ["ostamc5a31a-vv", OSTAMC5A31A_VV_EXAMPLE_SOURCE],
]);

export function deviceExampleSource(
  instanceId: string,
  options: { readonly buttonPin?: number } = {},
): string | null {
  if (instanceId === "button-gp15") {
    return buttonExampleSource(options.buttonPin ?? 15);
  }
  return DEVICE_EXAMPLE_SOURCES.get(instanceId) ?? null;
}

export function hasDeviceExample(instanceId: string): boolean {
  return DEVICE_EXAMPLE_SOURCES.has(instanceId);
}
