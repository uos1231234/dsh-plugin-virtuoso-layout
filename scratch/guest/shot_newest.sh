#!/bin/bash
# Screenshot the NEWEST window showing dsh_nmos12.
#
# Why "newest": there are now several identical-titled windows from repeated
# geOpen calls, and picking the first match grabs a stale one (the previous shot
# captured the old window and looked unchanged). xwininfo lists them in creation
# order, so the LAST match is the newest.
export DISPLAY=:0
gnome-screensaver-command -d 2>/dev/null
xset s off; xset -dpms; xset s noblank

ID=""
for w in $(xwininfo -root -tree 2>/dev/null | awk '{print $1}' | grep '^0x'); do
  n=$(xprop -id "$w" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
  case "$n" in
    *dsh_nmos12*) ID="$w" ;;
  esac
done

if [ -z "$ID" ]; then echo "no dsh_nmos12 window"; exit 1; fi
echo "using newest: $ID"

python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py focus "$ID"
sleep 0.5
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py key "$ID" Escape
sleep 0.3

xwd -screen -id "$ID" -out /tmp/nmos12c.xwd 2>/dev/null
convert /tmp/nmos12c.xwd /tmp/nmos12c.png 2>/dev/null
identify /tmp/nmos12c.png 2>/dev/null
