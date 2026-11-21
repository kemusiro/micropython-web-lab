const WIFI = `import network, time
wlan = network.WLAN()
wlan.active(True)
wlan.connect("WebLab-Demo", "demo-password")
started = time.ticks_ms()
while not wlan.isconnected():
    if time.ticks_diff(time.ticks_ms(), started) > 5000:
        raise OSError("WiFi timeout")
    time.sleep_ms(50)
print("virtual WiFi:", wlan.ifconfig())
`;
export const NETWORK_EXAMPLES: Record<string, string> = {
  "Virtual HTTP": WIFI + `import requests
with requests.get("http://weather.weblab.test/current", timeout=3) as response:
    print(response.status_code, response.json())
with requests.post("http://echo.weblab.test/post", json={"temperature": 22.5}) as response:
    print(response.json())
`,
  "Virtual HTTP server": WIFI + `import socket
from machine import Pin
led = Pin("LED", Pin.OUT)
server = socket.socket()
server.bind(("0.0.0.0", 8080))
server.listen(1)
print("Use the virtual HTTP client: port 8080, path /on or /off")
try:
    while True:
        client, address = server.accept()
        try:
            request = b""
            while b"\\r\\n\\r\\n" not in request:
                chunk = client.recv(256)
                if not chunk:
                    break
                request += chunk
                if len(request) > 4096:
                    raise OSError("Request too large")
            path = request.split(b" ")[1]
            led.value(1 if path == b"/on" else 0)
            body = b"LED on" if led.value() else b"LED off"
            client.sendall(b"HTTP/1.0 200 OK\\r\\nContent-Length: " + str(len(body)).encode() + b"\\r\\n\\r\\n" + body)
        finally:
            client.close()
finally:
    server.close()
`,
  "Virtual MQTT": WIFI + `from umqtt.simple import MQTTClient
client = MQTTClient("weblab-virtual", "mqtt.weblab.test")
client.set_callback(lambda topic, message: print(topic, message))
client.set_last_will(b"demo/status", b"offline", qos=1)
client.connect()
client.subscribe(b"demo/#", qos=1)
client.publish(b"demo/temperature", b"22.5", qos=1, retain=True)
client.check_msg()
print("Use the virtual MQTT panel to publish demo/control, or Stop to disconnect")
while True:
    client.wait_msg()
`,
  "shiftr.io MQTT": WIFI + `from umqtt.simple import MQTTClient
from weblab_network import topic_prefix
prefix = topic_prefix()
print("Public experiment topic:", prefix)
client = MQTTClient("wl-" + prefix.split("/")[1], "public.cloud.shiftr.io",
    port=8883, user="public", password="public", ssl=True)
client.set_callback(lambda topic, message: print(topic, message))
client.connect()
client.subscribe(prefix + "#", qos=1)
client.publish(prefix + "temperature", b"22.5", qos=1)
while True:
    client.wait_msg()
`,
  "Virtual NTP": WIFI + `import ntptime
from machine import RTC
before = time.ticks_ms()
ntptime.settime()
print("UTC:", time.gmtime())
print("Virtual RTC:", RTC().datetime())
print("Elapsed ms:", time.ticks_diff(time.ticks_ms(), before))
`,
  "HTTPS httpbin": WIFI + `import requests
# Grant httpbin in the Network panel after opening this example.
with requests.post("https://httpbin.org/post", json={"temperature": 22.5}) as response:
    print(response.status_code, response.json())
`,
  "HTTPS Open-Meteo": WIFI + `import requests
# Non-commercial use; display attribution with weather data.
url = "https://api.open-meteo.com/v1/forecast?latitude=35.68&longitude=139.76&current=temperature_2m&forecast_days=1&timezone=UTC"
with requests.get(url) as response:
    print("Weather data by Open-Meteo.com", response.json())
`,
};
