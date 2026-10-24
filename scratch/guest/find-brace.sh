#!/bin/bash
# Find brace imbalance in the xRC deck.
#
# Error after fixing line 289: "unmatched open brace in list" -- another Tcl
# parse complaint. This script reports, per line, the running brace depth, so the
# line where it goes wrong is identifiable instead of guessed at.
D=<PDK_ROOT>/calibre/xrc/Calibre/SmicSP12R_<rev>.lvs_XRC
awk '{
  line=$0
  # strip // comments to the end of line (a rough but useful approximation)
  sub(/\/\/.*$/, "", line)
  n=gsub(/\{/, "{", line)
  m=gsub(/\}/, "}", line)
  depth += (n - m)
  if (depth != prev && depth < 0) { print NR": depth="depth" : "substr($0,1,80) }
  prev = depth
}' "$D" | head -20
echo "--- final depth (should be 0) ---"
awk '{ line=$0; sub(/\/\/.*$/,"",line); n=gsub(/\{/,"{",line); m=gsub(/\}/,"}",line); d+=(n-m) } END { print "final depth =", d }' "$D"
echo ""
echo "=== lines containing a lone { or } that look suspicious ==="
grep -nE '^\s*[{}]\s*$' "$D" | head -10
