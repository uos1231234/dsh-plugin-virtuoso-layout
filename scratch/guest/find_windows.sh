#!/bin/bash
# Walk the X11 tree and print, for every window with a WM_NAME that mentions
# dsh_nmos, its client id together with its parent frame id and geometry.
# Needed because xwininfo -root -tree only shows the metacity FRAMES (no name);
# the Virtuoso windows are children. This prints the mapping that the screenshot
# and XTEST paths both need.
export DISPLAY=:0
xwininfo -root -tree 2>/dev/null | grep -E 'dsh_nmos' | while read -r line; do
  id=$(echo "$line" | awk '{print $1}')
  printf '%s  %s\n' "$id" "$(echo "$line" | sed 's/^[^"]*"//; s/".*//')"
done
echo "--- reparented check ---"
for id in $(xwininfo -root -tree 2>/dev/null | grep -E 'dsh_nmos' | awk '{print $1}'); do
  xwininfo -id "$id" 2>/dev/null | grep -E 'Absolute upper-left|Width|Height' | tr '\n' ' '
  echo " <- $id"
done
