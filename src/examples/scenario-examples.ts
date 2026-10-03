import { BME280_SSD1331_EXAMPLE_SOURCE } from "./bme280-ssd1331-example";
import { GT_502MGG_EXAMPLE_SOURCE } from "./gt-502mgg-example";

function buttonRgbControllerSource(buttonPin: number): string {
  return `from machine import Pin, PWM
from time import sleep_ms, ticks_diff, ticks_ms

button = Pin(${buttonPin}, Pin.IN, Pin.PULL_UP)
onboard_led = Pin("LED", Pin.OUT)
red = PWM(Pin(18), freq=1000, duty_u16=0)
green = PWM(Pin(20), freq=1000, duty_u16=0)
blue = PWM(Pin(22), freq=1000, duty_u16=0)

colors = (
    ("red", 65535, 0, 0),
    ("green", 0, 65535, 0),
    ("blue", 0, 0, 65535),
    ("off", 0, 0, 0),
)


def set_color(color):
    red.duty_u16(color[1])
    green.duty_u16(color[2])
    blue.duty_u16(color[3])


print("Interactive lamp: press GPIO ${buttonPin} to change color")
previous = button.value()
color_index = -1
started = ticks_ms()
while ticks_diff(ticks_ms(), started) < 6000:
    current = button.value()
    if current == 0:
        onboard_led.on()
    else:
        onboard_led.off()
    if previous == 1 and current == 0:
        color_index = (color_index + 1) % len(colors)
        set_color(colors[color_index])
        print("Color:", colors[color_index][0])
    previous = current
    sleep_ms(20)

onboard_led.off()
print("Interactive lamp complete")`;
}

const ANALOG_RGB_MIXER_SOURCE = `from machine import ADC, Pin, PWM
from time import sleep_ms, ticks_diff, ticks_ms

analog = ADC(Pin(26))
red = PWM(Pin(18), freq=1000, duty_u16=0)
green = PWM(Pin(20), freq=1000, duty_u16=0)
blue = PWM(Pin(22), freq=1000, duty_u16=0)
level_indicator = PWM(Pin(16), freq=1000, duty_u16=0)

print("Color mixer: move the ADC value slider")
previous_zone = -1
started = ticks_ms()
while ticks_diff(ticks_ms(), started) < 6000:
    value = analog.read_u16()
    red_value = value
    blue_value = 65535 - value
    green_value = 65535 - min(65535, abs(value - 32768) * 2)
    red.duty_u16(red_value)
    green.duty_u16(green_value)
    blue.duty_u16(blue_value)
    level_indicator.duty_u16(value)

    zone = min(3, value // 16384)
    if zone != previous_zone:
        print("ADC zone:", zone, "value:", value)
        previous_zone = zone
    sleep_ms(50)

print("Color mixer complete")`;

const GPS_RGB_BEACON_SOURCE = `${GT_502MGG_EXAMPLE_SOURCE}

from machine import PWM

red = PWM(Pin(18), freq=1000, duty_u16=0)
green = PWM(Pin(20), freq=1000, duty_u16=65535)
blue = PWM(Pin(22), freq=1000, duty_u16=0)
print("GPS beacon: green (valid fix)")`;

const SCENARIO_EXAMPLE_SOURCES = new Map<string, string>([
  ["button-rgb-controller", buttonRgbControllerSource(15)],
  ["analog-rgb-mixer", ANALOG_RGB_MIXER_SOURCE],
  ["environment-dashboard", BME280_SSD1331_EXAMPLE_SOURCE],
  ["gps-rgb-beacon", GPS_RGB_BEACON_SOURCE],
]);

export function scenarioExampleSource(
  id: string,
  options: { readonly buttonPin?: number } = {},
): string | null {
  if (id === "button-rgb-controller") {
    return buttonRgbControllerSource(options.buttonPin ?? 15);
  }
  return SCENARIO_EXAMPLE_SOURCES.get(id) ?? null;
}
