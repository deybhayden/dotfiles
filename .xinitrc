#!/bin/bash

DEFAULT_SESSION="i3"
# Define Xresources
XRESOURCES=$HOME/.Xresources

# Merge what is available
if [ -f "$XRESOURCES" ]; then
    xrdb -merge "$XRESOURCES"
fi

# Run urxvt daemon
urxvtd -q -o -f
# Set xserver parameters
xset s 0
xset dpms 0 0 1800

# Start WM
exec $DEFAULT_SESSION
