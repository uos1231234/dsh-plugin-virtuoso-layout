#!/bin/bash
# What is the CIW waiting on? Read the status bar of each layout window, which
# states the pending command in plain words, rather than guessing.
export DISPLAY=:0
xset s off; xset -dpms
for id in 0x2000df3 0x2001136 0x200120e 0x2000bed 0x2000ba7 0x2000d8d; do
  name=$(xprop -id "$id" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
  echo "=== $id  $name"
  xwd -screen -id "$id" -out /tmp/shot-$id.xwd 2>/dev/null
  convert /tmp/shot-$id.xwd /tmp/shot-$id.png 2>/dev/null && identify /tmp/shot-$id.png 2>/dev/null | head -1
done
echo "=== CIW log tail ==="
tail -12 <GUEST_HOME>/CDS.log
