from machine import Pin, SPI

cs = Pin(5, Pin.OUT)
cs.value(1)
spi = SPI(0)
cs.value(0)
received = bytearray(2)
spi.write_readinto(b"\x01\x02", received)
cs.value(1)
print(list(received))
