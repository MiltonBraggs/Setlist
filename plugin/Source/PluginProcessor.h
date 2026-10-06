#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <memory>
#include <vector>

#include "Gate.h"

class SetlistLink;

/**
 * Setlist Sync: put it on Master (and on any other output path, e.g. a click/IEM track
 * routed to its own interface outputs). It reports Live's sample-accurate playhead to
 * the Setlist app and silences audio exactly at STOP / +PAUSE points.
 */
class SetlistSyncProcessor final : public juce::AudioProcessor
{
public:
    SetlistSyncProcessor();
    ~SetlistSyncProcessor() override;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;

    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    void processBlock (juce::AudioBuffer<double>&, juce::MidiBuffer&) override;
    bool supportsDoublePrecisionProcessing() const override { return true; }

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override {}
    void setStateInformation (const void*, int) override {}

    void updateTrackProperties (const TrackProperties& properties) override;

    // ---- shared with the network thread / editor (lock-free reads) -------------------

    /** Called from the network thread. Points must be sorted. */
    void setGatePoints (std::vector<double> points);

    struct Status
    {
        double ppq = 0.0;
        double bpm = 120.0;
        bool playing = false;
        bool hasPosition = false;
        uint32_t firedCount = 0;
        uint32_t safetyCount = 0;
        double lastFired = -1.0;
        int gateState = 0;
        size_t numPoints = 0;
    };
    Status getStatus() const;

    juce::String getTrackName() const;
    SetlistLink& getLink() { return *link; }

private:
    template <typename Sample>
    void process (juce::AudioBuffer<Sample>& buffer);

    setlist::Gate gate;

    // Gate points handed over from the network thread; swapped in on the audio thread.
    juce::SpinLock pointsLock;
    std::vector<double> pendingPoints;
    bool pendingDirty = false;

    std::atomic<double> statusPpq { 0.0 }, statusBpm { 120.0 }, statusLastFired { -1.0 };
    std::atomic<bool> statusPlaying { false }, statusHasPosition { false };
    std::atomic<uint32_t> statusFired { 0 }, statusSafety { 0 };
    std::atomic<int> statusGateState { 0 };
    std::atomic<size_t> statusNumPoints { 0 };

    mutable juce::CriticalSection trackNameLock;
    juce::String trackName;

    std::unique_ptr<SetlistLink> link;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SetlistSyncProcessor)
};
