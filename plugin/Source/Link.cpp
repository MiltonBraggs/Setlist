#include "Link.h"
#include "PluginProcessor.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace
{
constexpr int helloIntervalMs = 1000;
constexpr int timeIntervalMs = 16;    // ~60 playhead updates per second
constexpr int idleTimeIntervalMs = 250;
constexpr int connectedTimeoutMs = 3500;

juce::int64 nowMs() { return juce::Time::currentTimeMillis(); }
} // namespace

SetlistLink::SetlistLink (SetlistSyncProcessor& p)
    : juce::Thread ("Setlist Sync link"), processor (p)
{
    socket.bindToPort (0, "127.0.0.1");
}

SetlistLink::~SetlistLink()
{
    stopThread (2000);
    socket.shutdown();
}

bool SetlistLink::isConnected() const
{
    return nowMs() - lastServerContactMs.load() < connectedTimeoutMs;
}

void SetlistLink::send (const juce::var& message)
{
    const auto text = juce::JSON::toString (message, true);
    socket.write ("127.0.0.1", serverPort, text.toRawUTF8(), (int) text.getNumBytesAsUTF8());
}

void SetlistLink::sendHello()
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty ("type", "hello");
    obj->setProperty ("id", instanceId);
    obj->setProperty ("version", version);
    const auto track = processor.getTrackName();
    if (track.isNotEmpty())
        obj->setProperty ("track", track);
    send (juce::var (obj));
}

void SetlistLink::handle (const juce::String& json)
{
    const auto message = juce::JSON::parse (json);
    if (! message.isObject())
        return;
    lastServerContactMs = nowMs();

    if (message["type"].toString() == "gates")
    {
        std::vector<double> points;
        if (const auto* array = message["points"].getArray())
        {
            points.reserve ((size_t) array->size());
            for (const auto& v : *array)
                points.push_back ((double) v);
        }
        std::sort (points.begin(), points.end());
        processor.setGatePoints (std::move (points));
    }
}

void SetlistLink::run()
{
    juce::int64 lastHello = 0, lastTime = 0;
    double lastSentPpq = -1.0;
    bool lastSentPlaying = false;
    char buffer[65536];

    while (! threadShouldExit())
    {
        // Receive (waits up to 5 ms, which also paces the loop).
        const int ready = socket.waitUntilReady (true, 5);
        if (ready == 1)
        {
            const int bytes = socket.read (buffer, (int) sizeof (buffer) - 1, false);
            if (bytes > 0)
                handle (juce::String::fromUTF8 (buffer, bytes));
        }
        else if (ready < 0)
        {
            wait (50); // socket error: don't spin
        }

        const auto now = nowMs();
        if (now - lastHello >= helloIntervalMs)
        {
            lastHello = now;
            sendHello();
        }

        const auto status = processor.getStatus();
        const int interval = status.playing ? timeIntervalMs : idleTimeIntervalMs;
        const bool changed = status.playing != lastSentPlaying || std::abs (status.ppq - lastSentPpq) > 1.0e-6;
        if (status.hasPosition && (now - lastTime >= interval) && (changed || now - lastTime >= idleTimeIntervalMs))
        {
            lastTime = now;
            lastSentPpq = status.ppq;
            lastSentPlaying = status.playing;
            auto* obj = new juce::DynamicObject();
            obj->setProperty ("type", "time");
            obj->setProperty ("id", instanceId);
            obj->setProperty ("time", status.ppq);
            obj->setProperty ("playing", status.playing);
            obj->setProperty ("tempo", status.bpm);
            send (juce::var (obj));
        }

        if (status.firedCount != lastReportedFired)
        {
            lastReportedFired = status.firedCount;
            auto* obj = new juce::DynamicObject();
            obj->setProperty ("type", "gated");
            obj->setProperty ("id", instanceId);
            obj->setProperty ("at", status.lastFired);
            send (juce::var (obj));
        }
    }
}
