#pragma once

// Sample-accurate "stop gate" for the Setlist Sync plugin.
//
// Live's API can only stop the transport on the Remote Script's ~100 ms tick. This gate
// runs on the audio thread: when the playhead crosses a stop point it starts a short fade
// on the exact sample, so the output is silent from the stop point on. The Remote Script
// then stops Live on its next tick.
//
// No JUCE or allocation here: it is called from the audio thread and unit-tested on its own
// (tests/GateTests.cpp).

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace setlist
{

struct BlockInfo
{
    bool playing = false;
    double ppq = 0.0;       // arrangement position (quarter notes) of the first sample
    double bpm = 120.0;
    double sampleRate = 44100.0;
    int numSamples = 0;
};

class Gate
{
public:
    enum class State { Open, FadingOut, Closed, FadingIn };

    struct Config
    {
        double fadeOutMs = 5.0;
        double fadeInMs = 5.0;
        /** Re-open slowly after the transport has been stopped this long (lets monitoring through again). */
        double reopenAfterStopMs = 1500.0;
        double reopenFadeMs = 300.0;
        /** Safety: if Live is still playing this long after a stop point, fade back in. */
        double safetyMs = 750.0;
    };

    Gate() = default;
    explicit Gate (Config c) : config (c) {}

    /** Points must be sorted. Swaps to avoid allocating/freeing on the audio thread. */
    void swapPoints (std::vector<double>& sortedPoints) { points.swap (sortedPoints); }
    const std::vector<double>& getPoints() const { return points; }

    State getState() const { return state; }
    float getGain() const { return gain; }
    uint32_t getFiredCount() const { return firedCount; }
    double getLastFiredPoint() const { return lastFiredPoint; }
    uint32_t getSafetyCount() const { return safetyCount; }

    /** Analyse the block's timing, then apply the gain to the audio in place. */
    template <typename Sample>
    void process (const BlockInfo& block, Sample* const* channels, int numChannels)
    {
        const int n = block.numSamples;
        if (n <= 0)
            return;
        const double sr = block.sampleRate > 0.0 ? block.sampleRate : 44100.0;
        const double beatsPerSample = (block.bpm > 0.0 ? block.bpm : 120.0) / 60.0 / sr;
        const double blockEnd = block.ppq + n * beatsPerSample;
        const double tolerance = std::max (1.0e-4, 4.0 * beatsPerSample);
        const bool continuous = wasPlaying && block.playing && std::abs (block.ppq - expectedPpq) <= tolerance;
        int fadeOutAt = -1;

        if (! block.playing)
        {
            playingClosedSamples = 0;
            if (state == State::Closed || state == State::FadingOut)
            {
                stoppedSamples += n;
                if (stoppedSamples >= msToSamples (config.reopenAfterStopMs, sr))
                    startFadeIn (config.reopenFadeMs, sr);
            }
        }
        else if (! wasPlaying)
        {
            // Playback (re)started: always open, with a tiny fade to avoid a click.
            stoppedSamples = 0;
            if (state != State::Open)
                startFadeIn (config.fadeInMs, sr);
        }
        else if (! continuous && state != State::Open && state != State::FadingIn)
        {
            // The playhead jumped while we were silent (loop wrap, user jump): open again.
            startFadeIn (config.fadeInMs, sr);
        }

        if (block.playing && (state == State::Open || state == State::FadingIn))
        {
            for (double p : points)
            {
                if (p >= blockEnd)
                    break;
                // Fire when the playhead crosses p. Starting playback exactly at p does not fire.
                const bool inBlock = p >= block.ppq - 1.0e-9 && (continuous || p > block.ppq + 1.0e-9);
                const int offset = std::max (0, (int) std::floor ((p - block.ppq) / beatsPerSample + 1.0e-6));
                if (offset >= n)
                    break; // rounding put it at the very end: the next block starts on it
                if (inBlock)
                {
                    fadeOutAt = offset;
                    ++firedCount;
                    lastFiredPoint = p;
                    playingClosedSamples = 0;
                    break;
                }
            }
        }

        const float fadeOutStep = (float) (1.0 / std::max (1.0, msToSamples (config.fadeOutMs, sr)));
        for (int i = 0; i < n; ++i)
        {
            if (i == fadeOutAt)
                state = State::FadingOut;

            switch (state)
            {
                case State::Open:
                    gain = 1.0f;
                    break;
                case State::FadingOut:
                    gain -= fadeOutStep;
                    if (gain <= 0.0f) { gain = 0.0f; state = State::Closed; }
                    break;
                case State::Closed:
                    gain = 0.0f;
                    break;
                case State::FadingIn:
                    gain += fadeInStep;
                    if (gain >= 1.0f) { gain = 1.0f; state = State::Open; }
                    break;
            }

            if (gain < 1.0f)
                for (int c = 0; c < numChannels; ++c)
                    channels[c][i] *= (Sample) gain;
        }

        if (block.playing && (state == State::Closed || state == State::FadingOut))
        {
            playingClosedSamples += n;
            if (playingClosedSamples >= msToSamples (config.safetyMs, sr))
            {
                ++safetyCount;
                startFadeIn (config.reopenFadeMs, sr);
            }
        }

        wasPlaying = block.playing;
        expectedPpq = blockEnd;
    }

private:
    static double msToSamples (double ms, double sr) { return ms * sr / 1000.0; }

    void startFadeIn (double ms, double sr)
    {
        state = State::FadingIn;
        fadeInStep = (float) (1.0 / std::max (1.0, msToSamples (ms, sr)));
        stoppedSamples = 0;
        playingClosedSamples = 0;
    }

    Config config;
    std::vector<double> points;
    State state = State::Open;
    float gain = 1.0f;
    float fadeInStep = 1.0f;
    bool wasPlaying = false;
    double expectedPpq = 0.0;
    double stoppedSamples = 0.0;
    double playingClosedSamples = 0.0;
    uint32_t firedCount = 0;
    uint32_t safetyCount = 0;
    double lastFiredPoint = -1.0;
};

} // namespace setlist
