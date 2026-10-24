#!/bin/bash
# Screenshot dsh_nmos12 (device + tap + N-well pickup), waking the display first.
# The DPMS trap: xset alone does not light a panel that is already off; an input
# event has to arrive before xwd returns real pixels.
export DISPLAY=:0
gnome-screensaver-command -d 2>/dev/null
xset s off; xset -dpms; xset s noblank

ID=""
for w in $(xwininfo -root -tree 2>/dev/null | awk '{print $1}' | grep '^0x'); do
  n=$(xprop -id "$w" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
  case "$n" in
    *dsh_nmos12*) ID="$w"; echo "found: $w  $n" ;;
  esac
done

if [ -z "$ID" ]; then echo "no dsh_nmos12 window"; exit 1; fi

python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py focus "$ID"
sleep 0.5
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py key "$ID" Escape
sleep 0.3

xwd -screen -id "$ID" -out /tmp/nmos12b.xwd 2>/dev/null
convert /tmp/nmos12b.xwd /tmp/nmos12b.png 2>/dev/null
identify /tmp/nmos12b.png 2>/dev/null
