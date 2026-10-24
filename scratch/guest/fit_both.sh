#!/bin/bash
# Fit both DSH_NMOS layouts to their windows so the two screenshots share a scale.
# 'f' is the layout editor's fit shortcut. Escape first: if a zoom is already
# armed and waiting for a click, it would swallow the 'f' and stay armed.
export DISPLAY=:0
xset s off; xset -dpms
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py focus 0x2001136
sleep 0.5
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py key 0x2001136 Escape
sleep 0.3
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py key 0x2001136 f
sleep 1

python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py focus 0x200120e
sleep 0.5
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py key 0x200120e Escape
sleep 0.3
python2 /tmp/virtuoso_bridge_work/HP/x11_drive.py key 0x200120e f
sleep 1
echo "done"
