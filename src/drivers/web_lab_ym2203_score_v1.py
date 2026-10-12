# SPDX-License-Identifier: MIT
# Optional score API with bounded patterns and long native playback.
from web_lab_ym2203_v1 import YM2203 as _YM2203, _integer, _MAX_DURATION_MS, _MAX_EVENTS


class YM2203(_YM2203):
    def reserve_score(self, tracks, tail_ms=300, repeat_ms=None):
        """Reserve up to 3 FM + 3 SSG tracks on one timeline.

        Each track is a dict with source, channel and notes, plus optional
        start_ms, step_ms, gate_ms and ssg_volume. None is a rest.
        Configure FM patches before calling this method. All tracks are
        validated before I2C writes. Return the total duration in ms.
        repeat_ms repeats the complete pattern, including tail_ms, in the chip host.
        """
        _integer(tail_ms, 0, _MAX_DURATION_MS, "Tail")
        events = []
        channels = set()
        ssg_mask = 0
        end_ms = 0
        allowed = ("source", "channel", "notes", "start_ms", "step_ms",
                   "gate_ms", "ssg_volume")

        def at(ms, priority, register, value):
            if len(events) >= _MAX_EVENTS:
                raise ValueError("Score exceeds 131071 events")
            # Explicit serial order avoids reliance on sort stability and keeps
            # each FM high/low frequency-register pair adjacent at equal times.
            events.append((ms, priority, len(events), register, value))

        for track in tracks:
            if len(channels) >= 6:
                raise ValueError("Score exceeds six tracks")
            if type(track) is not dict:
                raise ValueError("Track must be a dict")
            if any(key not in allowed for key in track):
                raise ValueError("Unknown track option")
            if any(key not in track for key in ("source", "channel", "notes")):
                raise ValueError("Track requires source, channel and notes")
            source = track["source"]
            if source not in ("fm", "ssg"):
                raise ValueError("Source must be fm or ssg")
            channel = _integer(track["channel"], 0, 2, "Channel")
            identity = (source, channel)
            if identity in channels:
                raise ValueError("Duplicate score channel")
            channels.add(identity)
            start_ms = _integer(track.get("start_ms", 0), 0, _MAX_DURATION_MS - 1, "Start")
            step_ms = _integer(track.get("step_ms", 300), 1, _MAX_DURATION_MS, "Step")
            gate_ms = _integer(track.get("gate_ms", min(250, step_ms)), 1, step_ms, "Gate")
            volume = _integer(track.get("ssg_volume", 11), 0, 15, "SSG volume")
            off = (0x28, channel) if source == "fm" else (8 + channel, 0)
            at(0, 0, off[0], off[1])  # Silence this channel while awaiting its start.
            if source == "ssg":
                ssg_mask |= 1 << channel
            count = 0
            for index, note in enumerate(track["notes"]):
                count += 1
                ms = start_ms + index * step_ms
                track_end = ms + step_ms
                if track_end + tail_ms > _MAX_DURATION_MS:
                    raise ValueError("Score exceeds uint32 milliseconds")
                end_ms = max(end_ms, track_end)
                if note is None:
                    at(ms, 0, off[0], off[1])
                    continue
                if source == "fm":
                    pairs = self._fm_pitch(note, channel) + ((0x28, 0xF0 | channel),)
                else:
                    pairs = self._ssg_pitch(note, channel) + ((8 + channel, volume),)
                for register, value in pairs:
                    at(ms, 1, register, value)
                at(ms + gate_ms, 0, off[0], off[1])
            if not count:
                raise ValueError("Track requires at least one note or rest")
        if not channels:
            raise ValueError("Score requires at least one track")
        period = end_ms + tail_ms
        duration = self._reservation_duration(period, repeat_ms)
        if self.status()["queued"]:
            raise ValueError("Module queue is not empty; call reset() first")
        events.sort()
        try:
            if ssg_mask:
                self.write_register(7, (self._mixer | 0x38) & ~ssg_mask)
        except Exception:
            try:
                self.reset()
            except Exception:
                pass
            raise
        self._reserve_events([(ms, register, value) for ms, priority, serial, register, value in events], duration,
                             period if repeat_ms is not None else None)
        return duration
