#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "PluginProcessor.h"

/** Small status panel: connection, playhead, stop points. */
class SetlistSyncEditor final : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit SetlistSyncEditor (SetlistSyncProcessor&);
    ~SetlistSyncEditor() override = default;

    void paint (juce::Graphics&) override;

private:
    void timerCallback() override { repaint(); }

    SetlistSyncProcessor& processor;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SetlistSyncEditor)
};
