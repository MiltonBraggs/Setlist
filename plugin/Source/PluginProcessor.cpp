#include "PluginProcessor.h"
#include "Link.h"
#include "PluginEditor.h"

SetlistSyncProcessor::SetlistSyncProcessor()
    : AudioProcessor (BusesProperties()
                          .withInput ("Input", juce::AudioChannelSet::stereo(), true)
                          .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
    link = std::make_unique<SetlistLink> (*this);
    link->startThread();
}

SetlistSyncProcessor::~SetlistSyncProcessor()
{
    link->stopThread (2000);
}

void SetlistSyncProcessor::prepareToPlay (double, int) {}

bool SetlistSyncProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto& out = layouts.getMainOutputChannelSet();
    if (out.isDisabled() || out.size() > 8)
        return false;
    return layouts.getMainInputChannelSet() == out;
}

void SetlistSyncProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) { process (buffer); }
void SetlistSyncProcessor::processBlock (juce::AudioBuffer<double>& buffer, juce::MidiBuffer&) { process (buffer); }

template <typename Sample>
void SetlistSyncProcessor::process (juce::AudioBuffer<Sample>& buffer)
{
    juce::ScopedNoDenormals noDenormals;

    // Pick up new gate points without blocking the audio thread.
    {
        const juce::SpinLock::ScopedTryLockType lock (pointsLock);
        if (lock.isLocked() && pendingDirty)
        {
            gate.swapPoints (pendingPoints); // old points are freed later on the network thread
            pendingDirty = false;
        }
    }

    setlist::BlockInfo info;
    info.numSamples = buffer.getNumSamples();
    info.sampleRate = getSampleRate();
    bool hasPosition = false;

    if (auto* playHead = getPlayHead())
    {
        if (const auto position = playHead->getPosition())
        {
            if (const auto ppq = position->getPpqPosition())
            {
                info.ppq = *ppq;
                hasPosition = true;
            }
            if (const auto bpm = position->getBpm())
                info.bpm = *bpm;
            info.playing = position->getIsPlaying();
        }
    }

    // Without a position we can't tell where we are: never silence in that case.
    if (! hasPosition)
        info.playing = false;

    gate.process (info, buffer.getArrayOfWritePointers(), buffer.getNumChannels());

    statusPpq.store (info.ppq, std::memory_order_relaxed);
    statusBpm.store (info.bpm, std::memory_order_relaxed);
    statusPlaying.store (info.playing, std::memory_order_relaxed);
    statusHasPosition.store (hasPosition, std::memory_order_relaxed);
    statusFired.store (gate.getFiredCount(), std::memory_order_relaxed);
    statusSafety.store (gate.getSafetyCount(), std::memory_order_relaxed);
    statusLastFired.store (gate.getLastFiredPoint(), std::memory_order_relaxed);
    statusGateState.store ((int) gate.getState(), std::memory_order_relaxed);
    statusNumPoints.store (gate.getPoints().size(), std::memory_order_relaxed);
}

void SetlistSyncProcessor::setGatePoints (std::vector<double> points)
{
    const juce::SpinLock::ScopedLockType lock (pointsLock);
    pendingPoints.swap (points);
    pendingDirty = true;
    // `points` now holds the previous pending vector and is freed here, off the audio thread.
}

SetlistSyncProcessor::Status SetlistSyncProcessor::getStatus() const
{
    Status s;
    s.ppq = statusPpq.load (std::memory_order_relaxed);
    s.bpm = statusBpm.load (std::memory_order_relaxed);
    s.playing = statusPlaying.load (std::memory_order_relaxed);
    s.hasPosition = statusHasPosition.load (std::memory_order_relaxed);
    s.firedCount = statusFired.load (std::memory_order_relaxed);
    s.safetyCount = statusSafety.load (std::memory_order_relaxed);
    s.lastFired = statusLastFired.load (std::memory_order_relaxed);
    s.gateState = statusGateState.load (std::memory_order_relaxed);
    s.numPoints = statusNumPoints.load (std::memory_order_relaxed);
    return s;
}

void SetlistSyncProcessor::updateTrackProperties (const TrackProperties& properties)
{
    const juce::ScopedLock lock (trackNameLock);
    trackName = properties.name.value_or (juce::String());
}

juce::String SetlistSyncProcessor::getTrackName() const
{
    const juce::ScopedLock lock (trackNameLock);
    return trackName;
}

juce::AudioProcessorEditor* SetlistSyncProcessor::createEditor()
{
    return new SetlistSyncEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SetlistSyncProcessor();
}
