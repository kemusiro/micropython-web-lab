export const OSTAMC5A31A_VV_EXAMPLE_SOURCE = `from machine import Pin, PWM
from time import sleep_ms


red = PWM(Pin(18), freq=1000, duty_u16=0)
green = PWM(Pin(20), freq=1000, duty_u16=0)
blue = PWM(Pin(22), freq=1000, duty_u16=0)


def set_rgb(red_value, green_value, blue_value):
    red.duty_u16(red_value * 257)
    green.duty_u16(green_value * 257)
    blue.duty_u16(blue_value * 257)


for name, color in (
    ("red", (255, 0, 0)),
    ("green", (0, 255, 0)),
    ("blue", (0, 0, 255)),
    ("white", (255, 255, 255)),
):
    set_rgb(*color)
    print("RGB LED:", name, color)
    sleep_ms(200)

set_rgb(255, 64, 180)
print("RGB LED model: OSTAMC5A31A-VV")
print("PWM pins: R=GP18 G=GP20 B=GP22")
print("Final color: #ff40b4")`;
