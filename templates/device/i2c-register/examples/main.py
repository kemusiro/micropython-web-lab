from machine import I2C

i2c = I2C(0)
print("devices:", [hex(address) for address in i2c.scan()])
i2c.writeto_mem(0x48, 0x10, b"ABC")
print("register:", i2c.readfrom_mem(0x48, 0x10, 3))
