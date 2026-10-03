export const SSD1331_EXAMPLE_SOURCE = `from machine import Pin, SPI

WIDTH = 96
HEIGHT = 64

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


def rgb565(red, green, blue):
    return ((red & 0xF8) << 8) | ((green & 0xFC) << 3) | (blue >> 3)


def set_pixel(buffer, x, y, color):
    offset = (y * WIDTH + x) * 2
    buffer[offset] = color >> 8
    buffer[offset + 1] = color & 0xFF


reset.off()
reset.on()
write_command(0xAE)
write_command(0xA0, 0x72)
write_command(0x15, 0, WIDTH - 1)
write_command(0x75, 0, HEIGHT - 1)

pixels = bytearray(WIDTH * HEIGHT * 2)
red = rgb565(255, 0, 0)
green = rgb565(0, 255, 0)
blue = rgb565(0, 0, 255)
white = rgb565(255, 255, 255)

for y in range(HEIGHT):
    color = red if y < 21 else green if y < 42 else blue
    for x in range(WIDTH):
        if x == 0 or x == WIDTH - 1 or y == 0 or y == HEIGHT - 1:
            set_pixel(pixels, x, y, white)
        else:
            set_pixel(pixels, x, y, color)

dc.on()
cs.off()
for offset in range(0, len(pixels), 256):
    spi.write(pixels[offset:offset + 256])
cs.on()
write_command(0xAF)

print("SSD1331 display: 96x64 RGB OLED")
print("SPI0 SCK=GP6 MOSI=GP7 CS=GP5 DC=GP2 RESET=GP3")`;
