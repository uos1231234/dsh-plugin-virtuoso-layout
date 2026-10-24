#!/bin/bash
# Locate the line Calibre Interactive is complaining about.
#
# The error "list element in quotes followed by // instead of space" means some
# line has a quoted token immediately followed by "//" with no space between the
# closing quote and the comment marker. That is legal for older Calibre rule-file
# readers but a Tcl parse error for Calibre Interactive v2015.2.
D=<PDK_ROOT>/calibre/xrc/Calibre/SmicSP12R_<rev>.lvs_XRC
echo "=== last byte (newline?) ==="
tail -c 1 "$D" | od -c | head -2
echo ""
echo "=== last 3 lines ==="
tail -3 "$D"
echo ""
echo "=== quoted token immediately followed by // ==="
grep -n '"//' "$D" | head -10
echo ""
echo "=== quoted token, whitespace, then // ==="
grep -nE '"[[:space:]]+//' "$D" | head -10
echo ""
echo "=== lines ending in a quote (next line starts with //) ==="
grep -nE '"[[:space:]]*$' "$D" | head -10
