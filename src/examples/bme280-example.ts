export const BME280_DRIVER_SOURCE = `from machine import I2C, Pin

BME280_ADDRESS = 0x76


def u16_le(data, offset):
    return data[offset] | (data[offset + 1] << 8)


def s16_le(data, offset):
    value = u16_le(data, offset)
    return value - 65536 if value & 0x8000 else value


def signed(value, bits):
    sign = 1 << (bits - 1)
    return value - (1 << bits) if value & sign else value


class BME280:
    def __init__(self, i2c, address=BME280_ADDRESS):
        self.i2c = i2c
        self.address = address
        chip_id = i2c.readfrom_mem(address, 0xD0, 1)[0]
        if chip_id != 0x60:
            raise RuntimeError("BME280 not found: 0x{:02x}".format(chip_id))

        calibration = i2c.readfrom_mem(address, 0x88, 26)
        self.t1 = u16_le(calibration, 0)
        self.t2 = s16_le(calibration, 2)
        self.t3 = s16_le(calibration, 4)
        self.p = [
            u16_le(calibration, 6),
            s16_le(calibration, 8),
            s16_le(calibration, 10),
            s16_le(calibration, 12),
            s16_le(calibration, 14),
            s16_le(calibration, 16),
            s16_le(calibration, 18),
            s16_le(calibration, 20),
            s16_le(calibration, 22),
        ]
        humidity = i2c.readfrom_mem(address, 0xE1, 7)
        self.h1 = calibration[25]
        self.h2 = s16_le(humidity, 0)
        self.h3 = humidity[2]
        self.h4 = signed((humidity[3] << 4) | (humidity[4] & 0x0F), 12)
        self.h5 = signed((humidity[5] << 4) | (humidity[4] >> 4), 12)
        self.h6 = signed(humidity[6], 8)

        i2c.writeto_mem(address, 0xF2, bytes((1,)))
        i2c.writeto_mem(address, 0xF4, bytes((0x27,)))

    def read(self):
        data = self.i2c.readfrom_mem(self.address, 0xF7, 8)
        adc_p = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4)
        adc_t = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4)
        adc_h = (data[6] << 8) | data[7]

        var1 = (((adc_t >> 3) - (self.t1 << 1)) * self.t2) >> 11
        var2 = (((((adc_t >> 4) - self.t1) ** 2) >> 12) * self.t3) >> 14
        t_fine = var1 + var2
        temperature = ((t_fine * 5 + 128) >> 8) / 100

        var1 = t_fine - 128000
        var2 = var1 * var1 * self.p[5]
        var2 += (var1 * self.p[4]) << 17
        var2 += self.p[3] << 35
        var1 = ((var1 * var1 * self.p[2]) >> 8) + ((var1 * self.p[1]) << 12)
        var1 = (((1 << 47) + var1) * self.p[0]) >> 33
        if var1 == 0:
            raise RuntimeError("invalid pressure calibration")
        pressure = 1048576 - adc_p
        pressure = (((pressure << 31) - var2) * 3125) // var1
        var1 = (self.p[8] * (pressure >> 13) * (pressure >> 13)) >> 25
        var2 = (self.p[7] * pressure) >> 19
        pressure = ((pressure + var1 + var2) >> 8) + (self.p[6] << 4)

        humidity = t_fine - 76800
        humidity = (((((adc_h << 14) - (self.h4 << 20) -
                      (self.h5 * humidity)) + 16384) >> 15) *
                    (((((((humidity * self.h6) >> 10) *
                         (((humidity * self.h3) >> 11) + 32768)) >> 10) +
                       2097152) * self.h2 + 8192) >> 14))
        humidity -= (((((humidity >> 15) * (humidity >> 15)) >> 7) * self.h1) >> 4)
        humidity = max(0, min(humidity, 419430400))

        return temperature, (humidity >> 12) / 1024, pressure / 25600`;

export const BME280_EXAMPLE_SOURCE = `${BME280_DRIVER_SOURCE}

i2c = I2C(0, scl=Pin(9), sda=Pin(8), freq=400_000)
sensor = BME280(i2c)
temperature, humidity, pressure = sensor.read()
print("BME280 chip: 0x60")
print("Temperature: {:.1f} C".format(temperature))
print("Humidity: {:.1f} %RH".format(humidity))
print("Pressure: {:.1f} hPa".format(pressure))`;
