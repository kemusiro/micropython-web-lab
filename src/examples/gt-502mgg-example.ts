export const GT_502MGG_EXAMPLE_SOURCE = `from machine import Pin, UART
from time import sleep_ms, ticks_diff, ticks_ms


def checksum_ok(sentence):
    if not sentence.startswith(b"$") or b"*" not in sentence:
        return False
    body, checksum = sentence[1:].split(b"*", 1)
    value = 0
    for byte in body:
        value ^= byte
    return value == int(checksum[:2], 16)


def coordinate(value, hemisphere):
    digits = 2 if hemisphere in ("N", "S") else 3
    degrees = int(value[:digits])
    minutes = float(value[digits:])
    result = degrees + minutes / 60
    return -result if hemisphere in ("S", "W") else result


def read_snapshot(uart):
    gga = uart.readline()
    if gga is None:
        return None
    rmc = uart.readline()
    if rmc is None:
        return None
    gga = gga.strip()
    rmc = rmc.strip()
    if not checksum_ok(gga) or not checksum_ok(rmc):
        raise RuntimeError("invalid NMEA checksum")
    return gga.decode().split(","), rmc.decode().split(",")


uart = UART(0, 9600, tx=Pin(0), rx=Pin(1), bits=8, parity=None, stop=1)
pps = Pin(14, Pin.IN)
started = ticks_ms()
snapshot = None
print("GPS acquisition: waiting")
while ticks_diff(ticks_ms(), started) < 8000:
    candidate = read_snapshot(uart)
    if candidate is not None and candidate[0][6] != "0" and candidate[1][2] == "A":
        snapshot = candidate
        break
    sleep_ms(20)

if snapshot is None:
    raise RuntimeError("GT-502MGG-N did not acquire satellites")

gga, rmc = snapshot
latitude = coordinate(gga[2], gga[3])
longitude = coordinate(gga[4], gga[5])
first_utc = gga[1]

next_utc = first_utc
started = ticks_ms()
while next_utc == first_utc and ticks_diff(ticks_ms(), started) < 2000:
    candidate = read_snapshot(uart)
    if candidate is not None:
        next_utc = candidate[0][1]
    sleep_ms(10)
if next_utc == first_utc:
    raise RuntimeError("1 Hz NMEA update was not observed")

saw_low = False
pps_detected = False
started = ticks_ms()
while ticks_diff(ticks_ms(), started) < 2000:
    level = pps.value()
    if level == 0:
        saw_low = True
    elif saw_low:
        pps_detected = True
        break
    sleep_ms(5)
if not pps_detected:
    raise RuntimeError("PPS pulse was not observed on GP14")

print("GPS model: GT-502MGG-N")
print("Acquisition: fixed")
print("Fix:", "valid")
print("Latitude: {:.6f}".format(latitude))
print("Longitude: {:.6f}".format(longitude))
print("Altitude: {:.1f} m".format(float(gga[9])))
print("NMEA rate: 1 Hz")
print("PPS GP14: detected")
print("NMEA checksums: OK")`;
