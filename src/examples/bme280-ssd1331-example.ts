import { BME280_DRIVER_SOURCE } from "./bme280-example";

export const BME280_SSD1331_EXAMPLE_SOURCE = `${BME280_DRIVER_SOURCE}

from machine import SPI

WIDTH = 96
HEIGHT = 64

FONT = {
    "0": ("111", "101", "101", "101", "111"),
    "1": ("010", "110", "010", "010", "111"),
    "2": ("111", "001", "111", "100", "111"),
    "3": ("111", "001", "111", "001", "111"),
    "4": ("101", "101", "111", "001", "001"),
    "5": ("111", "100", "111", "001", "111"),
    "6": ("111", "100", "111", "101", "111"),
    "7": ("111", "001", "010", "010", "010"),
    "8": ("111", "101", "111", "101", "111"),
    "9": ("111", "101", "111", "001", "111"),
    ".": ("000", "000", "000", "000", "010"),
    "-": ("000", "000", "111", "000", "000"),
    "T": ("111", "010", "010", "010", "010"),
    "H": ("101", "101", "111", "101", "101"),
    "P": ("110", "101", "110", "100", "100"),
}


def rgb565(red, green, blue):
    return ((red & 0xF8) << 8) | ((green & 0xFC) << 3) | (blue >> 3)


def set_pixel(buffer, x, y, color):
    if 0 <= x < WIDTH and 0 <= y < HEIGHT:
        offset = (y * WIDTH + x) * 2
        buffer[offset] = color >> 8
        buffer[offset + 1] = color & 0xFF


def draw_text(buffer, text, x, y, color, scale=2):
    for character in text:
        glyph = FONT.get(character)
        if glyph is not None:
            for row, pattern in enumerate(glyph):
                for column, enabled in enumerate(pattern):
                    if enabled == "1":
                        for dy in range(scale):
                            for dx in range(scale):
                                set_pixel(
                                    buffer,
                                    x + column * scale + dx,
                                    y + row * scale + dy,
                                    color,
                                )
        x += 4 * scale


i2c = I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000)
sensor = BME280(i2c)
temperature, humidity, pressure = sensor.read()

spi = SPI(
    0,
    baudrate=8_000_000,
    polarity=0,
    phase=0,
    sck=Pin(6),
    mosi=Pin(7),
    miso=Pin(4),
)
cs = Pin(5, Pin.OUT)
dc = Pin(2, Pin.OUT)
reset = Pin(3, Pin.OUT)
cs.on()
dc.off()
reset.on()


def write_command(command, *parameters):
    dc.off()
    cs.off()
    spi.write(bytes((command,)) + bytes(parameters))
    cs.on()


reset.off()
reset.on()
write_command(0xAE)
write_command(0xA0, 0x72)
write_command(0x15, 0, WIDTH - 1)
write_command(0x75, 0, HEIGHT - 1)

pixels = bytearray(WIDTH * HEIGHT * 2)
draw_text(pixels, "T{:.1f}".format(temperature), 4, 4, rgb565(255, 64, 64))
draw_text(pixels, "H{:.1f}".format(humidity), 4, 25, rgb565(64, 255, 64))
draw_text(pixels, "P{:.1f}".format(pressure), 4, 46, rgb565(64, 128, 255), 1)

dc.on()
cs.off()
for offset in range(0, len(pixels), 256):
    spi.write(pixels[offset:offset + 256])
cs.on()
write_command(0xAF)

print(
    "Combined display: T={:.1f} C H={:.1f} %RH P={:.1f} hPa".format(
        temperature, humidity, pressure
    )
)`;
