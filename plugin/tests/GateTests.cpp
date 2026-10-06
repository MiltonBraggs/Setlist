// Unit tests for the stop gate. Built as the `GateTests` target; run with `ctest` or directly.

#include "Gate.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

using setlist::BlockInfo;
using setlist::Gate;

static int failures = 0;

#define CHECK(cond)                                                              \
    do {                                                                         \
        if (! (cond)) {                                                          \
            std::printf ("  FAILED %s:%d  %s\n", __FILE__, __LINE__, #cond);     \
            ++failures;                                                          \
        }                                                                        \
    } while (0)

namespace
{
constexpr double kSampleRate = 48000.0;
constexpr double kBpm = 120.0;
constexpr int kBlock = 512;
constexpr double kBeatsPerSample = kBpm / 60.0 / kSampleRate;

/** Simulated transport feeding ones through the gate; records the output. */
struct Sim
{
    Gate gate;
    double ppq = 0.0;
    bool playing = false;
    std::vector<float> out; // channel 0 of every processed block, concatenated
    std::vector<double> outPpq;

    explicit Sim (std::vector<double> points, Gate::Config cfg = {}) : gate (cfg) { gate.swapPoints (points); }

    void run (int blocks)
    {
        std::vector<float> l (kBlock), r (kBlock);
        for (int b = 0; b < blocks; ++b)
        {
            std::fill (l.begin(), l.end(), 1.0f);
            std::fill (r.begin(), r.end(), 1.0f);
            float* chans[] = { l.data(), r.data() };
            BlockInfo info { playing, ppq, kBpm, kSampleRate, kBlock };
            gate.process (info, chans, 2);
            for (int i = 0; i < kBlock; ++i)
            {
                out.push_back (l[(size_t) i]);
                outPpq.push_back (ppq + i * kBeatsPerSample);
            }
            if (playing)
                ppq += kBlock * kBeatsPerSample;
        }
    }

    /** Index of the first sample whose gain dropped below 1. */
    long firstAttenuated() const
    {
        for (size_t i = 0; i < out.size(); ++i)
            if (out[i] < 0.999f)
                return (long) i;
        return -1;
    }
};
} // namespace

static void silencesOnTheExactSample()
{
    std::puts ("silences on the exact sample");
    Sim sim ({ 4.1 }); // deliberately not on a block boundary (~192 blocks in)
    sim.playing = true;
    sim.run (220);
    const long first = sim.firstAttenuated();
    const long expected = (long) std::floor (4.1 / kBeatsPerSample);
    CHECK (first == expected);
    // 5 ms fade = 240 samples, then fully silent.
    CHECK (sim.out[(size_t) expected + 240] == 0.0f);
    CHECK (sim.out[(size_t) expected + 5000] == 0.0f);
    CHECK (sim.gate.getFiredCount() == 1);
}

static void doesNotFireWhenStartingAtThePoint()
{
    std::puts ("does not fire when playback starts exactly at the point");
    Sim sim ({ 8.0 });
    sim.ppq = 8.0;
    sim.run (2); // stopped at 8
    sim.playing = true;
    sim.run (20);
    CHECK (sim.firstAttenuated() == -1);
    CHECK (sim.gate.getFiredCount() == 0);
}

static void firesOnABlockBoundary()
{
    std::puts ("fires when the point is exactly on a block boundary");
    const double point = 10 * kBlock * kBeatsPerSample; // start of block 10
    Sim sim ({ point });
    sim.playing = true;
    sim.run (20);
    CHECK (sim.firstAttenuated() == 10 * kBlock);
}

static void reopensWhenPlaybackRestarts()
{
    std::puts ("re-opens when playback restarts");
    Sim sim ({ 2.0 });
    sim.playing = true;
    sim.run (100); // crosses 2.0 beats after ~94 blocks
    CHECK (sim.gate.getState() == Gate::State::Closed);
    sim.playing = false; // Remote Script stops Live
    sim.run (5);
    CHECK (sim.gate.getState() == Gate::State::Closed);
    sim.playing = true;
    sim.run (5);
    CHECK (sim.gate.getState() == Gate::State::Open);
    CHECK (sim.out.back() == 1.0f);
}

static void reopensAfterBeingStoppedForAWhile()
{
    std::puts ("re-opens slowly after the transport stayed stopped");
    Sim sim ({ 2.0 });
    sim.playing = true;
    sim.run (100);
    sim.playing = false;
    sim.run ((int) (1.9 * kSampleRate / kBlock)); // 1.5 s wait + 0.3 s fade
    CHECK (sim.gate.getState() == Gate::State::Open);
}

static void safetyReopensIfLiveKeepsPlaying()
{
    std::puts ("safety: fades back in if Live never stops");
    Sim sim ({ 2.0 });
    sim.playing = true;
    sim.run ((int) (2.5 * kSampleRate / kBlock)); // crosses at 1 s, safety at 1.75 s, open by ~2.05 s
    CHECK (sim.gate.getFiredCount() == 1);
    CHECK (sim.gate.getSafetyCount() == 1);
    CHECK (sim.gate.getState() == Gate::State::Open);
}

static void reopensOnJumpWhileSilent()
{
    std::puts ("re-opens when the playhead jumps while silent");
    Sim sim ({ 2.0 });
    sim.playing = true;
    sim.run (100);
    CHECK (sim.gate.getState() == Gate::State::Closed);
    sim.ppq = 32.0; // jump
    sim.run (3);
    CHECK (sim.gate.getState() == Gate::State::Open);
}

static void loopWrapDoesNotFire()
{
    std::puts ("landing exactly on a point by a jump is not a crossing");
    Sim sim ({ 4.0 });
    sim.playing = true;
    sim.run (20);           // up to ~1.7 beats
    sim.ppq = 4.0;          // discontinuous: lands exactly on the point (e.g. a jump target)
    sim.run (5);
    CHECK (sim.gate.getFiredCount() == 0);
}

int main()
{
    silencesOnTheExactSample();
    doesNotFireWhenStartingAtThePoint();
    firesOnABlockBoundary();
    reopensWhenPlaybackRestarts();
    reopensAfterBeingStoppedForAWhile();
    safetyReopensIfLiveKeepsPlaying();
    reopensOnJumpWhileSilent();
    loopWrapDoesNotFire();
    if (failures == 0)
        std::puts ("All gate tests passed.");
    else
        std::printf ("%d check(s) failed.\n", failures);
    return failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
