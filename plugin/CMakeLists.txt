cmake_minimum_required(VERSION 3.22)

project(SetlistSync VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Universal binary on macOS (Apple Silicon + Intel).
if(APPLE)
  set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "")
  set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")
endif()

# ---------------------------------------------------------------------------
# Unit tests for the stop gate (no JUCE needed)

option(SETLIST_TESTS_ONLY "Only build the gate unit tests (skips fetching JUCE)" OFF)

enable_testing()
add_executable(GateTests tests/GateTests.cpp)
target_include_directories(GateTests PRIVATE Source)
add_test(NAME GateTests COMMAND GateTests)

if(SETLIST_TESTS_ONLY)
  return()
endif()

# ---------------------------------------------------------------------------
# Plugin

include(FetchContent)
FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.4
  GIT_SHALLOW ON)
FetchContent_MakeAvailable(JUCE)

if(APPLE)
  set(SETLIST_FORMATS VST3 AU)
else()
  set(SETLIST_FORMATS VST3)
endif()

juce_add_plugin(SetlistSync
  COMPANY_NAME "Setlist"
  BUNDLE_ID "app.setlist.sync"
  PLUGIN_MANUFACTURER_CODE Stls
  PLUGIN_CODE Ssyn
  FORMATS ${SETLIST_FORMATS}
  PRODUCT_NAME "Setlist Sync"
  DESCRIPTION "Sample-accurate stops and playhead for the Setlist app"
  IS_SYNTH FALSE
  NEEDS_MIDI_INPUT FALSE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  VST3_CATEGORIES Fx Tools
  AU_MAIN_TYPE kAudioUnitType_Effect
  COPY_PLUGIN_AFTER_BUILD FALSE)

target_sources(SetlistSync PRIVATE
  Source/PluginProcessor.cpp
  Source/PluginEditor.cpp
  Source/Link.cpp)

target_compile_definitions(SetlistSync PUBLIC
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(SetlistSync
  PRIVATE
    juce::juce_audio_utils
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags)
