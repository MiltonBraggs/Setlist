#include "PluginEditor.h"
#include "Link.h"

SetlistSyncEditor::SetlistSyncEditor (SetlistSyncProcessor& p)
    : AudioProcessorEditor (p), processor (p)
{
    setSize (380, 170);
    startTimerHz (10);
}

void SetlistSyncEditor::paint (juce::Graphics& g)
{
    const auto bg = juce::Colour (0xff0b0d10);
    const auto panel = juce::Colour (0xff14171c);
    const auto fg = juce::Colour (0xfff3f4f6);
    const auto muted = juce::Colour (0xff8b93a1);
    const auto ok = juce::Colour (0xff22c55e);
    const auto bad = juce::Colour (0xffef4444);
    const auto accent = juce::Colour (0xff3b82f6);

    g.fillAll (bg);
    auto area = getLocalBounds().reduced (12);

    g.setColour (fg);
    g.setFont (juce::FontOptions (18.0f, juce::Font::bold));
    g.drawText ("Setlist Sync", area.removeFromTop (24), juce::Justification::centredLeft);

    const bool connected = processor.getLink().isConnected();
    auto row = area.removeFromTop (22);
    g.setColour (connected ? ok : bad);
    g.fillEllipse (row.removeFromLeft (12).withSizeKeepingCentre (10, 10).toFloat());
    row.removeFromLeft (6);
    g.setColour (fg);
    g.setFont (juce::FontOptions (14.0f));
    g.drawText (connected ? "Connected to Setlist" : "Setlist app not found (is it running?)", row, juce::Justification::centredLeft);

    const auto s = processor.getStatus();
    area.removeFromTop (8);
    auto box = area.reduced (0, 2);
    g.setColour (panel);
    g.fillRoundedRectangle (box.toFloat(), 6.0f);
    box = box.reduced (10, 6);

    g.setFont (juce::FontOptions (13.0f));
    auto line = [&] (const juce::String& label, const juce::String& value, juce::Colour colour) {
        auto r = box.removeFromTop (20);
        g.setColour (muted);
        g.drawText (label, r.removeFromLeft (110), juce::Justification::centredLeft);
        g.setColour (colour);
        g.drawText (value, r, juce::Justification::centredLeft);
    };

    const auto beats = s.hasPosition ? juce::String (s.ppq, 2) + " beats" + (s.playing ? "  (playing)" : "  (stopped)") : juce::String ("no position from host");
    line ("Playhead", beats, fg);
    line ("Stop points", juce::String ((int) s.numPoints), fg);

    const auto state = (setlist::Gate::State) s.gateState;
    const bool silent = state == setlist::Gate::State::Closed || state == setlist::Gate::State::FadingOut;
    line ("Output", silent ? "silenced at beat " + juce::String (s.lastFired, 2) : "passing audio", silent ? accent : fg);
    if (s.safetyCount > 0)
        line ("Safety re-opens", juce::String ((int) s.safetyCount) + " (Live didn't stop in time)", bad);

    const auto track = processor.getTrackName();
    if (track.isNotEmpty())
    {
        g.setColour (muted);
        g.drawText ("on " + track, getLocalBounds().reduced (12).removeFromTop (24), juce::Justification::centredRight);
    }
}
