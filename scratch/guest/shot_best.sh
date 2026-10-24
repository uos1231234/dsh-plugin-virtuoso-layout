#!/bin/bash
# Screenshot every window titled dsh_nmos12 and keep the largest PNG.
#
# Rationale: window ids are not ordered by creation time on this X server
# (0x20015f3 was created AFTER 0x20017a5), so "newest = highest id" is wrong and
# "last in xwininfo order" is also wrong. The reliable discriminator is CONTENT
# SIZE: a window showing the fitted cell produces far more pixels than one at a
# stale zoom, so picking the biggest capture is deterministic.
export DISPLAY=:0
gnome-screensaver-command -d 2>/dev/null
xset s off; xset -dpms; xset s noblank

BEST=""
BESTSZ=0
i=0
for w in $(xwininfo -root -tree 2>/dev/null | awk '{print $1}' | grep '^0x'); do
  n=$(xprop -id "$w" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
  case "$n" in
    *dsh_nmos12*)
      i=$((i+1))
      python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py focus "$w" >/dev/null 2>&1
      sleep 0.4
      xwd -screen -id "$w" -out "/tmp/w$i.xwd" 2>/dev/null
      convert "/tmp/w$i.xwd" "/tmp/w$i.png" 2>/dev/null
      sz=$(stat -c %s "/tmp/w$i.png" 2>/dev/null || echo 0)
      echo "  $w -> $sz bytes"
      if [ "$sz" -gt "$BESTSZ" ]; then BESTSZ=$sz; BEST="/tmp/w$i.png"; fi
      ;;
  esac
done

[ -n "$BEST" ] || { echo "no dsh_nmos12 window"; exit 1; }
cp "$BEST" /tmp/nmos12best.png
echo "best: $BEST ($BESTSZ bytes)"
identify /tmp/nmos12best.png
