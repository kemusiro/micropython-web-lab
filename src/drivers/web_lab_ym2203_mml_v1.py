# SPDX-License-Identifier: MIT
# Small MML subset for original educational sequences, not a PMD/MUCOM decoder.
from web_lab_ym2203_v1 import YM2203 as _Base, _integer, _MAX_DURATION_MS

_PITCHES = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
_MAX_MML_EVENTS = 4096


def _notes(text, tempo):
    if type(text) is not str or not 1 <= len(text) <= 8192:
        raise ValueError("MML must contain 1..8192 characters")
    text = text.lower()
    at, octave, length, gate, elapsed, count = 0, 4, 4, 7, 0.0, 0
    while at < len(text):
        token = text[at]
        at += 1
        if token.isspace():
            continue
        if token in "><":
            octave = _integer(octave + (1 if token == ">" else -1), 0, 9, "Octave")
            continue
        accidental = 0
        if token in _PITCHES and at < len(text) and text[at] in "+#-":
            accidental = -1 if text[at] == "-" else 1
            at += 1
        start = at
        while at < len(text) and "0" <= text[at] <= "9":
            at += 1
        value = int(text[start:at]) if at > start else None
        if token in "tolq":
            if value is None:
                raise ValueError("MML command needs a number")
            if token == "t": tempo = _integer(value, 32, 400, "Tempo")
            elif token == "o": octave = _integer(value, 0, 9, "Octave")
            elif token == "l": length = _integer(value, 1, 64, "Length")
            else: gate = _integer(value, 1, 8, "Gate")
            continue
        if token not in _PITCHES and token != "r":
            raise ValueError("Unsupported MML token: " + token)
        denominator = length if value is None else _integer(value, 1, 64, "Length")
        duration = 240000 / tempo / denominator
        if at < len(text) and text[at] == ".":
            duration *= 1.5
            at += 1
        end = elapsed + duration
        if end > _MAX_DURATION_MS:
            raise ValueError("MML exceeds uint32 milliseconds")
        note = None if token == "r" else _integer(12 * (octave + 1) + _PITCHES[token] + accidental, 0, 127, "MIDI note")
        count += 1
        if count > 1024:
            raise ValueError("MML track exceeds 1024 notes/rests")
        yield round(elapsed), round(elapsed + duration * gate / 8), note
        elapsed = end
    if not count:
        raise ValueError("MML requires notes or rests")
    yield round(elapsed), None, None  # End marker, not a note.


class YM2203(_Base):
    def reserve_mml(self, tracks, tempo=120, tail_ms=300, repeat_ms=None):
        """Reserve up to three FM + three SSG tracks, each with its own MML text."""
        _integer(tempo, 32, 400, "Tempo")
        _integer(tail_ms, 0, _MAX_DURATION_MS, "Tail")
        events, channels, mask, end_ms = [], set(), 0, 0
        def add(ms, priority, register, value):
            if len(events) >= _MAX_MML_EVENTS:
                raise ValueError("Simple MML exceeds 4096 register events; use BIN")
            events.append((ms, priority, len(events), register, value))
        for track in tracks:
            if type(track) is not dict or set(track) - {"source", "channel", "ssg_volume", "mml"} or "mml" not in track:
                raise ValueError("Invalid MML track fields")
            source = track.get("source", "fm")
            if source not in ("fm", "ssg"):
                raise ValueError("Source must be fm or ssg")
            channel = _integer(track.get("channel", 0), 0, 2, "Channel")
            volume = _integer(track.get("ssg_volume", 11), 0, 15, "SSG volume")
            if (source, channel) in channels:
                raise ValueError("Duplicate MML channel")
            channels.add((source, channel))
            off = (0x28, channel) if source == "fm" else (8 + channel, 0)
            add(0, 0, *off)
            if source == "ssg": mask |= 1 << channel
            for ms, release, note in _notes(track["mml"], tempo):
                if release is None:
                    end_ms = max(end_ms, ms)
                    continue
                if note is None:
                    add(ms, 0, *off)
                    continue
                pairs = (self._fm_pitch(note, channel) + ((0x28, 0xF0 | channel),)
                         if source == "fm" else self._ssg_pitch(note, channel) + ((8 + channel, volume),))
                for register, value in pairs:
                    add(ms, 1, register, value)
                add(release, 0, *off)
        if not channels:
            raise ValueError("MML requires tracks")
        period = _integer(end_ms + tail_ms, 1, _MAX_DURATION_MS, "Period")
        duration = self._reservation_duration(period, repeat_ms)
        if self.status()["queued"]:
            raise ValueError("Module queue is not empty; call reset() first")
        events.sort()
        try:
            if mask: self.write_register(7, (self._mixer | 0x38) & ~mask)
            self._reserve_events([(ms, reg, value) for ms, _, _, reg, value in events],
                                 duration, period if repeat_ms is not None else None)
        except BaseException:
            try:
                self.reset()
            except Exception:
                pass
            raise
        return duration
