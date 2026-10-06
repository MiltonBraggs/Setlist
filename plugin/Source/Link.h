#pragma once

#include <juce_core/juce_core.h>

#include <atomic>

class SetlistSyncProcessor;

/**
 * Background thread talking to the Setlist server over localhost UDP (JSON datagrams).
 *   plugin -> server :39102   hello (1/s), time (~60/s while playing), gated
 *   server -> plugin          gates { points: [beats...] }
 * Never touches the audio thread directly: reads atomics, hands points over via a SpinLock.
 */
class SetlistLink final : public juce::Thread
{
public:
    static constexpr int serverPort = 39102;
    static constexpr const char* version = "0.1.0";

    explicit SetlistLink (SetlistSyncProcessor& processor);
    ~SetlistLink() override;

    void run() override;

    /** True if the server answered within the last few seconds. */
    bool isConnected() const;
    const juce::String& getInstanceId() const { return instanceId; }

private:
    void send (const juce::var& message);
    void sendHello();
    void handle (const juce::String& json);

    SetlistSyncProcessor& processor;
    juce::DatagramSocket socket { false };
    const juce::String instanceId = juce::Uuid().toString();
    std::atomic<juce::int64> lastServerContactMs { 0 };
    uint32_t lastReportedFired = 0;
};
