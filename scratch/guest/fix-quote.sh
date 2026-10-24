#!/bin/bash
# Find every line in the LVS deck where a quoted token is glued to "//".
#
# The PEX run failed with the same Tcl error even after I appended with a leading
# newline, so the offending line is IN the deck, not in my additions. This finds
# them all so they can be patched once rather than discovered one run at a time.
D=<PDK_ROOT>/calibre/lvs/SmicSP12R_<rev>.lvs
echo "=== quoted token immediately followed by // ==="
grep -n '"//' "$D"
echo ""
echo "=== count ==="
grep -c '"//' "$D"
echo ""
echo "=== also: does it end with newline? ==="
tail -c 1 "$D" | od -c | head -2
