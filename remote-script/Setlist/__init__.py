"""Setlist Remote Script for Ableton Live 12.

Install into  <User Library>/Remote Scripts/Setlist  and select "Setlist" as a
Control Surface in Live's Preferences -> Link, Tempo & MIDI.
"""

from .surface import SetlistSurface


def create_instance(c_instance):
    return SetlistSurface(c_instance)
