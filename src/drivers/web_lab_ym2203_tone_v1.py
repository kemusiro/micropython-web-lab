# SPDX-License-Identifier: MIT
# Optional patch API; existing base and score libraries remain unchanged.
from web_lab_ym2203_score_v1 import YM2203 as _YM2203
from web_lab_ym2203_v1 import _integer


def _boolean(value, name):
    if type(value) is not bool:
        raise ValueError(name + " must be a bool")
    return value


# Names use algorithm order OP1, OP2, OP3, OP4, not register address order.
_SLOTS = (0, 8, 4, 12)
_FIELDS = (
    ("detune", 0, 7), ("multiple", 1, 15), ("total_level", 32, 127),
    ("key_scale", 0, 3), ("attack", 31, 31), ("decay", 10, 31),
    ("sustain_rate", 2, 31), ("sustain_level", 4, 15),
    ("release", 7, 15), ("ssg_eg", 0, 15),
)


class YM2203(_YM2203):
    def fm_patch(self, operators, algorithm=4, feedback=0, channel=0):
        """Apply four operator dicts in OP1..OP4 order; validate before I2C.

        Values are chip register units, not milliseconds or percentages.
        Missing fields use defaults. Unknown fields and non-integers fail.
        The selected channel is keyed off before its complete patch is written.
        """
        _integer(channel, 0, 2, "FM channel")
        _integer(algorithm, 0, 7, "Algorithm")
        _integer(feedback, 0, 7, "Feedback")
        if type(operators) not in (tuple, list):
            raise ValueError("Patch requires four operator dicts")
        pairs = [(0x28, channel)]
        count = 0
        for operator in operators:
            if count >= 4 or type(operator) is not dict:
                raise ValueError("Patch requires four operator dicts")
            if any(key not in tuple(field[0] for field in _FIELDS) for key in operator):
                raise ValueError("Unknown operator field")
            values = {}
            for name, default, high in _FIELDS:
                values[name] = _integer(operator.get(name, default), 0, high, name)
            offset = channel + _SLOTS[count]
            pairs.extend((
                (0x30 + offset, values["detune"] << 4 | values["multiple"]),
                (0x40 + offset, values["total_level"]),
                (0x50 + offset, values["key_scale"] << 6 | values["attack"]),
                (0x60 + offset, values["decay"]),
                (0x70 + offset, values["sustain_rate"]),
                (0x80 + offset, values["sustain_level"] << 4 | values["release"]),
                (0x90 + offset, values["ssg_eg"]),
            ))
            count += 1
        if count != 4:
            raise ValueError("Patch requires four operator dicts")
        pairs.append((0xB0 + channel, feedback << 3 | algorithm))
        self._write_pairs(pairs)

    def fm_tone(self, preset="soft", channel=0):
        super().fm_tone(preset, channel)
        # Legacy presets predate custom SSG-EG settings. Clear that extension
        # when returning to a preset so it does not inherit the previous patch.
        self._write_pairs(tuple((0x90 + channel + slot, 0) for slot in _SLOTS))

    def ssg_noise(self, period):
        """Set the one shared noise generator's period (1..31)."""
        self.write_register(6, _integer(period, 1, 31, "Noise period"))

    def ssg_envelope(self, period, shape):
        """Set/retrigger the shared envelope; period 1..65535, shape 0..15.

        Rewriting the shape retriggers every SSG channel using the envelope.
        """
        _integer(period, 1, 65535, "Envelope period")
        _integer(shape, 0, 15, "Envelope shape")
        self._write_pairs(((11, period & 255), (12, period >> 8), (13, shape)))

    def ssg_mixer(self, channel=0, tone=True, noise=False):
        """Select tone/noise for one channel without altering the others."""
        _integer(channel, 0, 2, "SSG channel")
        _boolean(tone, "Tone")
        _boolean(noise, "Noise")
        mask = (1 << channel) | (1 << (channel + 3))
        disabled = (0 if tone else 1 << channel) | (0 if noise else 1 << (channel + 3))
        self.write_register(7, (self._mixer & ~mask) | disabled)

    def ssg_sound(self, note=None, channel=0, volume=11, tone=True,
                  noise=False, envelope=False):
        """Start tone, noise, or both; envelope=True selects shared envelope.

        Tone needs a MIDI note. Noise-only may omit it. Volume 0..15 applies
        only to fixed-volume playback. Envelope phase is not retriggered here.
        """
        _integer(channel, 0, 2, "SSG channel")
        _integer(volume, 0, 15, "SSG volume")
        _boolean(tone, "Tone")
        _boolean(noise, "Noise")
        _boolean(envelope, "Envelope")
        pitch = self._ssg_pitch(note, channel) if note is not None or tone else ()
        mask = (1 << channel) | (1 << (channel + 3))
        disabled = (0 if tone else 1 << channel) | (0 if noise else 1 << (channel + 3))
        mixer = (self._mixer & ~mask) | disabled
        self._write_pairs(((8 + channel, 0),) + pitch + ((7, mixer), (8 + channel, 16 if envelope else volume)))
        self._mixer = mixer
