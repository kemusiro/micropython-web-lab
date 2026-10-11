// Project-owned adapter. Upstream ymfm is downloaded unchanged by the build script.
#include "ymfm_opn.h"
#include <algorithm>
#include <cmath>

namespace {
ymfm::ymfm_interface host; // Prototype deliberately excludes timers, BUSY and IRQ.
ymfm::ym2203 chip(host);
ymfm::ym2203::output_data sample;
constexpr uint32_t clock_hz = 4000000;
constexpr int capacity = 128;
float output[capacity * 2]; // Separate FM and SSG planes for analysis and mixing.
double remaining = 0;
double ratio = 0;
}

extern "C" {
void fm_init(int rate) {
    chip.reset();
    chip.set_fidelity(ymfm::OPN_FIDELITY_MIN);
    ratio = double(chip.sample_rate(clock_hz)) / std::max(8000, std::min(rate, 192000));
    remaining = 0;
    sample.clear();
}
void fm_write(int reg, int value) {
    chip.write_address(uint8_t(reg));
    chip.write_data(uint8_t(value));
}
float *fm_buffer() { return output; }
void fm_render(int count) {
    count = std::max(0, std::min(count, capacity));
    for (int i = 0; i < count; ++i) {
        double left = ratio, fm = 0, ssg = 0;
        // Area averaging preserves fractional resampling position between blocks.
        while (left > 1e-9) {
            if (remaining <= 1e-9) { chip.generate(&sample); remaining = 1; }
            const double weight = std::min(left, remaining);
            fm += sample.data[0] * weight;
            ssg += (sample.data[1] + sample.data[2] + sample.data[3]) * weight;
            remaining -= weight;
            left -= weight;
        }
        output[i] = float(fm / ratio / 32768.0);
        output[capacity + i] = float(ssg / ratio / 32768.0);
    }
}
}
