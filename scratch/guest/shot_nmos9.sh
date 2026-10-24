#!/bin/bash
# Screenshot the dsh_nmos9 layout window straight from X, bypassing the bridge's
# window lookup (which was returning a blank canvas).
#
# Root cause of the blank canvas: the layout was OPENED but never zoomed -- the
# status bar showed "26(27)" with an empty view, and 'f' did nothing because the
# window had no current cell view bound. xwd on the FRAME gets the pixels either
# way, so this also distinguishes "the window is genuinely empty" from "the view
# is zoomed somewhere else".
export DISPLAY=:0
xset s off; xset -dpms

ID=""
for w in $(xwininfo -root -tree 2>/dev/null | awk '{print $1}' | grep '^0x'); do
  n=$(xprop -id "$w" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
  case "$n" in
    *dsh_nmos9*) ID="$w"; echo "client=$w"; echo "title=$n" ;;
  esac
done

[ -n "$ID" ] || { echo "no dsh_nmos9 window"; exit 1; }

# The frame is the client's parent; xwd -screen on the client gives real pixels.
xwd -screen -id "$ID" -out /tmp/nmos9.xwd 2>/dev/null
convert /tmp/nmos9.xwd /tmp/nmos9.png 2>/dev/null
identify /tmp/nmos9.png 2>/dev/null
