#!/bin/bash
# Fit window 26 (dsh_nmos9) and screenshot it.
# The window id from geOpen was (window:26), and the client id must be found by
# matching WM_NAME -- the ids are not stable across sessions, so guessing one is
# how a screenshot ends up showing the wrong cell.
export DISPLAY=:0
xset s off; xset -dpms

ID=""
for w in $(xwininfo -root -tree 2>/dev/null | awk '{print $1}' | grep '^0x'); do
  n=$(xprop -id "$w" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
  case "$n" in
    *dsh_nmos9*) ID="$w"; echo "found dsh_nmos9 at $w"; break ;;
  esac
done

if [ -z "$ID" ]; then
  echo "dsh_nmos9 window not found; listing candidates:"
  for w in $(xwininfo -root -tree 2>/dev/null | awk '{print $1}' | grep '^0x'); do
    n=$(xprop -id "$w" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
    case "$n" in *DSH_NMOS*) echo "  $w  $n" ;; esac
  done
  exit 1
fi

python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py focus "$ID"
sleep 0.4
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py key "$ID" Escape
sleep 0.2
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py key "$ID" f
sleep 1.2
echo "fitted $ID"
