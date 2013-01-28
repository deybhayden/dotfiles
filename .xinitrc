#!/bin/bash

DEFAULT_SESSION="i3"
# Define Xresources
XRESOURCES=$HOME/.Xresources
# Define Xmodmap
XMODMAP=$HOME/.Xmodmap

# Merge what is available
if [ -f "$XRESOURCES" ]; then
    xrdb -merge "$XRESOURCES"
fi

if [ -f "$XMODMAP" ]; then
    xmodmap "$XMODMAP"
fi

# Run urxvt daemon
urxvtd -q -o -f
# Set xserver parameters
xset s 0
xset dpms 0 0 1800
# Set background
feh --bg-scale /usr/share/slim/themes/batman/background.jpg

# Start WM
exec $DEFAULT_SESSION
