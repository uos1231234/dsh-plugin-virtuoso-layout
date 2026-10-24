#!/bin/bash
# xwd keeps producing 2-colour ~354 byte images while gnome-screensaver reports
# "inactive". That was diagnosed before as DPMS: the display is off, not blank.
# xset must be applied and then the screen must be WOKEN -- disabling DPMS does
# not light a panel that is already off.
export DISPLAY=:0

gnome-screensaver-command -d 2>/dev/null
xset s off
xset -dpms
xset s noblank

# Wake it: a synthetic input event forces the server to re-enable the output.
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py list 2>/dev/null | head -3
xdotool --version 2>/dev/null || true
# no xdotool on this guest, so use the bridge's own driver to nudge the pointer
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py focus 0x2001383 2>/dev/null
sleep 1

xwd -root -out /tmp/root-now.xwd 2>/dev/null
convert /tmp/root-now.xwd /tmp/root-now.png 2>/dev/null
identify /tmp/root-now.png 2>/dev/null

xwd -screen -id 0x2001383 -out /tmp/nmos9b.xwd 2>/dev/null
convert /tmp/nmos9b.xwd /tmp/nmos9b.png 2>/dev/null
identify /tmp/nmos9b.png 2>/dev/null
