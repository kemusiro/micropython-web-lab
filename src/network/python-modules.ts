/** Original compatibility adapters, not vendored copies of micropython-lib. */
export const NETWORK_PYTHON_SOURCE = String.raw`
import sys as _sys
import json as _json
import time as _time
import machine as _machine
import binascii as _binascii
from _web_lab_network import request as _request

def _call(op, **args):
    result = _json.loads(_request(_json.dumps({'version': 1, 'op': op, 'args': args})))
    if not result['ok']:
        raise OSError(result['code'], result['message'])
    return result['value']

def _hex(value):
    if isinstance(value, str):
        value = value.encode()
    return _binascii.hexlify(value).decode()

def _str(value):
    return value.decode() if isinstance(value, bytes) else value

class _Module:
    pass

def _module(name, values):
    module = _Module()
    module.__name__ = name
    for key, value in values.items():
        setattr(module, key, value)
    _sys.modules[name] = module
    return module

class WLAN:
    IF_STA = 0
    IF_AP = 1
    def __init__(self, interface_id=0):
        if interface_id != 0:
            raise NotImplementedError('Only STA mode is supported')
    def active(self, value=None):
        return _call('wifi.active', **({} if value is None else {'value': value}))
    def scan(self):
        return [(ssid.encode(), _binascii.unhexlify(mac), ch, rssi, sec, hidden)
                for ssid, mac, ch, rssi, sec, hidden in _call('wifi.scan')]
    def connect(self, ssid, key):
        _call('wifi.connect', ssid=_str(ssid), key=_str(key))
    def disconnect(self):
        _call('wifi.disconnect')
    def isconnected(self):
        return _call('wifi.connected')
    def status(self, param=None):
        if param is None:
            return _call('wifi.status')
        if param != 'rssi':
            raise NotImplementedError('Only status(rssi) is supported')
        return _call('wifi.config', key=param)
    def ifconfig(self):
        return tuple(_call('wifi.ip'))
    def ipconfig(self, param):
        if param != 'addr4':
            raise NotImplementedError('Only addr4 is supported')
        values = self.ifconfig()
        return values[0], values[1]
    def config(self, param):
        value = _call('wifi.config', key=param)
        return _binascii.unhexlify(value) if param == 'mac' else value

_module('network', {'WLAN': WLAN, 'STA_IF': 0, 'AP_IF': 1,
    'STAT_IDLE': 0, 'STAT_CONNECTING': 1, 'STAT_GOT_IP': 3,
    'STAT_WRONG_PASSWORD': -3, 'STAT_NO_AP_FOUND': -2, 'STAT_CONNECT_FAIL': -1})

class Response:
    def __init__(self, result):
        self.status_code = result['status']
        self.headers = result['headers']
        self.content = _binascii.unhexlify(result['data'])
    @property
    def text(self):
        return self.content.decode('utf-8')
    def json(self):
        return _json.loads(self.content)
    def close(self):
        self.content = b''
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.close()

def request(method, url, data=None, json=None, headers=None, timeout=5):
    headers = {} if headers is None else dict(headers)
    if json is not None:
        if data is not None:
            raise ValueError('data and json are mutually exclusive')
        data = _json.dumps(json)
        if not any(key.lower() == 'content-type' for key in headers):
            headers['Content-Type'] = 'application/json'
    return Response(_call('http', method=method, url=url, data=_hex(b'' if data is None else data), headers=headers, timeout=timeout))

def get(url, **kwargs):
    return request('GET', url, **kwargs)
def post(url, **kwargs):
    return request('POST', url, **kwargs)
_module('requests', {'request': request, 'get': get, 'post': post})

def getaddrinfo(host, port, af=0, type=0, proto=0, flags=0):
    if af not in (0, 2) or type not in (0, 1) or proto not in (0, 6) or flags != 0:
        raise NotImplementedError('Virtual IPv4 TCP only')
    return [(2, 1, 6, '', (_call('dns', host=_str(host)), port))]

class socket:
    def __init__(self, af=2, type=1, proto=0, _id=None):
        if af != 2 or type != 1 or proto not in (0, 6):
            raise NotImplementedError('Virtual IPv4 TCP only')
        self._id = _call('socket.open') if _id is None else _id
        self._timeout = None
    def bind(self, address):
        _call('socket.bind', id=self._id, host=address[0], port=address[1])
    def listen(self, backlog=1):
        if backlog not in (1, 2):
            raise ValueError('backlog must be 1 or 2')
        _call('socket.listen', id=self._id)
    def accept(self):
        ident, address = _call('socket.accept', id=self._id, timeout=self._timeout)
        result = socket(_id=ident)
        result._timeout = self._timeout
        return result, tuple(address)
    def connect(self, address):
        _call('socket.connect', id=self._id, host=address[0], port=address[1])
    def settimeout(self, value):
        if value is not None and (not isinstance(value, (int, float)) or value < 0 or value > 10):
            raise ValueError('timeout must be None or 0..10 seconds')
        self._timeout = value
    def setblocking(self, value):
        self.settimeout(None if value else 0)
    def send(self, data):
        if isinstance(data, str):
            data = data.encode()
        return _call('socket.send', id=self._id, data=_hex(data[:8192]), timeout=self._timeout)
    def sendall(self, data):
        if isinstance(data, str):
            data = data.encode()
        offset = 0
        while offset < len(data):
            offset += self.send(data[offset:offset+8192])
    def recv(self, size):
        if size < 0:
            raise ValueError('Invalid recv length')
        return _binascii.unhexlify(_call('socket.recv', id=self._id, size=min(size, 8192), timeout=self._timeout))
    def read(self, size=-1):
        result = bytearray()
        while size < 0 or len(result) < size:
            part = self.recv(8192 if size < 0 else min(size-len(result), 8192))
            if not part:
                break
            result.extend(part)
            if len(result) > 65536:
                raise OSError(105, 'Socket read limit')
        return bytes(result)
    def readinto(self, buf):
        data = self.recv(len(buf))
        buf[:len(data)] = data
        return len(data)
    def readline(self):
        result = bytearray()
        while len(result) < 8192:
            byte = self.recv(1)
            if not byte:
                break
            result.extend(byte)
            if byte == b'\n':
                break
        return bytes(result)
    def write(self, data, size=None):
        if size is not None:
            data = data[:size]
        self.sendall(data)
        return len(data)
    def makefile(self, *args):
        return self
    def close(self):
        if self._id is not None:
            _call('socket.close', id=self._id)
            self._id = None
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.close()
_module('socket', {'socket': socket, 'getaddrinfo': getaddrinfo, 'AF_INET': 2,
    'SOCK_STREAM': 1, 'SOCK_DGRAM': 2, 'IPPROTO_TCP': 6})

class MQTTException(Exception):
    pass

class MQTTClient:
    def __init__(self, client_id, server, port=0, user=None, password=None, keepalive=60, ssl=False, ssl_params=None):
        if ssl_params:
            raise NotImplementedError('Custom TLS configuration is not supported')
        self._config = {'clientId': _str(client_id), 'server': _str(server), 'port': port,
            'user': _str(user), 'password': _str(password), 'keepalive': keepalive, 'ssl': ssl}
        self._id = None
        self._will = None
        self._callback = None
        self._timeout = 5
    def set_callback(self, callback):
        if not callable(callback):
            raise TypeError('Callback must be callable')
        self._callback = callback
    def set_last_will(self, topic, msg, retain=False, qos=0):
        if self._id is not None:
            raise ValueError('Set Last Will before connect')
        self._will = {'topic': _str(topic), 'data': _hex(msg), 'retain': retain, 'qos': qos}
    def connect(self, clean_session=True, timeout=5):
        if self._id is not None:
            self.disconnect()
        self._timeout = timeout
        self._id = _call('mqtt.connect', clean=clean_session, timeout=timeout, will=self._will, **self._config)
        return False
    def disconnect(self):
        if self._id is not None:
            _call('mqtt.close', id=self._id)
            self._id = None
    def publish(self, topic, msg, retain=False, qos=0):
        _call('mqtt.publish', id=self._id, topic=_str(topic), data=_hex(msg), retain=retain, qos=qos, timeout=self._timeout)
    def subscribe(self, topic, qos=0):
        if self._callback is None:
            raise ValueError('Set callback before subscribing')
        _call('mqtt.subscribe', id=self._id, topic=_str(topic), qos=qos, timeout=self._timeout)
    def _receive(self, wait):
        message = _call('mqtt.receive', id=self._id, wait=wait)
        if message is not None and self._callback is not None:
            self._callback(message['topic'].encode(), _binascii.unhexlify(message['data']))
        return None
    def check_msg(self):
        return self._receive(False)
    def wait_msg(self):
        return self._receive(True)
    def ping(self):
        _call('mqtt.ping', id=self._id)

_umqtt = _module('umqtt', {'__path__': []})
_umqtt.simple = _module('umqtt.simple', {'MQTTClient': MQTTClient, 'MQTTException': MQTTException})

# Date/time is independent of ticks_ms/us and the device/timeout monotonic clocks.
_native_gmtime = _time.gmtime
_native_mktime = _time.mktime
_epoch_delta = 946684800 if _native_gmtime(0)[0] == 2000 else 0
def _clock_time():
    return int(_call('clock.get')) - _epoch_delta
def _clock_gmtime(seconds=None):
    return _native_gmtime(_clock_time() if seconds is None else seconds)
def _clock_time_ns():
    return int((_call('clock.get') - _epoch_delta) * 1000000000)
if globals().get('_network_available', True):
    _virtual_time = _module('time', {name: getattr(_time, name) for name in dir(_time) if not name.startswith('__')})
    _virtual_time.time = _clock_time
    _virtual_time.time_ns = _clock_time_ns
    _virtual_time.gmtime = _clock_gmtime
    _virtual_time.localtime = _clock_gmtime
    _sys.modules['utime'] = _virtual_time

class RTC:
    def __init__(self, id=0):
        if id != 0:
            raise ValueError('Only RTC 0 is supported')
    def datetime(self, value=None):
        if value is None:
            tm = _clock_gmtime()
            return tm[0], tm[1], tm[2], tm[6]+1, tm[3], tm[4], tm[5], 0
        if len(value) != 8:
            raise ValueError('RTC datetime requires 8 values')
        year, month, day, weekday, hour, minute, second, subsecond = value
        if not (1970 <= year <= 2200 and 1 <= month <= 12 and 1 <= day <= 31 and 1 <= weekday <= 7 and 0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59 and subsecond == 0):
            raise ValueError('Invalid RTC datetime')
        seconds = _native_mktime((year, month, day, hour, minute, second, 0, 0))
        tm = _native_gmtime(seconds)
        if tm[:6] != (year, month, day, hour, minute, second):
            raise ValueError('Invalid calendar date')
        _call('clock.set', unix=seconds + _epoch_delta)
_machine.RTC = RTC

_ntptime = _module('ntptime', {'host': 'pool.ntp.org', 'timeout': 1})
def _ntp_time():
    return _call('ntp', host=_ntptime.host, timeout=_ntptime.timeout) - _epoch_delta
def _ntp_settime():
    _call('clock.set', unix=_ntp_time() + _epoch_delta)
_ntptime.time = _ntp_time
_ntptime.settime = _ntp_settime
def _prefix():
    return _call('experiment.info')
_module('weblab_network', {'topic_prefix': _prefix})
`;
