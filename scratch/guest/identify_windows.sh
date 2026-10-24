#!/bin/bash
# Zoom the two DSH_NMOS layout windows to the same scale, using the client ids
# that `virtuoso_windows` reported (0x2000df3, 0x2000bed, 0x2000ba7, 0x2000d8d).
# Rather than guess which is which, read each one's WM_NAME and act on the match.
export DISPLAY=:0
xset s off; xset -dpms

for id in 0x2000d8d 0x2000ba7 0x2000bed 0x2000df3 0x2001136 0x200120e; do
  name=$(xprop -id "$id" WM_NAME 2>/dev/null | sed 's/^WM_NAME(STRING) = "//; s/"$//')
  case "$name" in
    *dsh_nmos2*) echo "MATCH2 $id $name" ;;
    *dsh_nmos*)  echo "MATCH1 $id $name" ;;
    *)           echo "other  $id $name" ;;
  esac
done
