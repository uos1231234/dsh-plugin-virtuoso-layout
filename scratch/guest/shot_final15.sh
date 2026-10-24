#!/bin/bash
# Screenshot the newest dsh_nmos15 window, waking the display first.
export DISPLAY=:0
gnome-screensaver-command -d 2>/dev/null
xset s off; xset -dpms; xset s noblank

BEST=""; BESTSZ=0; i=0
for w in $(xwininfo -root -tree 2>/dev/null | awk '{print $1}' | grep '^0x'); do
  n=$(xprop -id "$w" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
  case "$n" in
    *dsh_nmos15*)
      i=$((i+1))
      python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py focus "$w" >/dev/null 2>&1
      sleep 0.4
      xwd -screen -id "$w" -out "/tmp/r$i.xwd" 2>/dev/null
      convert "/tmp/r$i.xwd" "/tmp/r$i.png" 2>/dev/null
      sz=$(stat -c %s "/tmp/r$i.png" 2>/dev/null || echo 0)
      echo "  $w -> $sz"
      if [ "$sz" -gt "$BESTSZ" ]; then BESTSZ=$sz; BEST="/tmp/r$i.png"; fi
      ;;
  esac
done
[ -n "$BEST" ] || { echo "no dsh_nmos15 window"; exit 1; }
cp "$BEST" /tmp/final15.png
identify /tmp/final15.png
