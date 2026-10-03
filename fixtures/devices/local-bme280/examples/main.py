from machine import I2C

i2c = I2C(0)
print(i2c.readfrom_mem(0x76, 0xD0, 1))
