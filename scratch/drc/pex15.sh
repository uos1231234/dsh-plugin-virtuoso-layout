#!/bin/bash
# PEX by extending the deck we KNOW parses: the LVS deck.
#
# Why not the xRC deck: it was written for Calibre xRC v2009.3_24.19 (per the
# Release Note) and Calibre Interactive v2015.2_36.27 rejects it with two separate
# Tcl parse errors -- first `list element in quotes followed by "//"` (line 289,
# a quote glued to a comment marker), then `unmatched open brace in list`. Both are parser
# strictness changes, and patching a foundry deck statement-by-statement is the
# wrong way to spend effort.
#
# The LVS deck is the same generation of deck (SmicSP12R_...) and we have already
# run it successfully many times, so it parses. PEX reuses LVS connectivity; adding
# a PEX section to the parsed-ok deck is the reliable route. The process
# calibration comes in with the same `include` statements the xRC deck uses.
set -e
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:/opt/IC617/tools/dfII/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
export CDSHOME=/opt/IC617

CELL=dsh_nmos15
WORK=/tmp/pex15c
LVSDECK=<PDK_ROOT>/calibre/lvs/SmicSP12R_<rev>.lvs
CRULE=<PDK_ROOT>/calibre/xrc/rules/v2009.3_24.19/SmicSP10R_<rev>_typ.C
RRULE=<PDK_ROOT>/calibre/xrc/rules/v2009.3_24.19/SmicSP10R_<rev>_typ.R
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

strmout -library DSH_NMOS -strmFile "$WORK/$CELL.gds" -strmVersion 3 -topCell "$CELL" \
  -view layout -techLib smic18ee \
  -layerMap "<PDK_ROOT>/stream/strmoutMap" \
  -translateUnmappedLPP -logFile "$WORK/s.log" -summaryFile "$WORK/s.sum" \
  > "$WORK/s.stdout" 2>&1 || true
[ -s "$WORK/$CELL.gds" ] || { echo "no GDS"; exit 1; }
echo "GDS: $(stat -c %s "$WORK/$CELL.gds") bytes"

cp "$LVSDECK" "$WORK/effective.xrc"

# Patch the one line Calibre Interactive v2015.2 cannot parse. Line 289 reads
#     // ... the licence paragraph, ending in a quote then "//"
# a quoted token with "//" glued to it. The LVS and xRC decks are the same
# generation and both carry it; it is harmless to the old rule-file reader but a
# Tcl parse error to Calibre Interactive. No rule is changed, only the spacing.
# (this step edited the private deck in place; the edit depends on your deck's
#  own text, so it is not reproduced here -- see README, "Note on third-party material")
echo "line 289 now:"
sed -n '289p' "$WORK/effective.xrc"

sed -i \
  -e "s|^LAYOUT PATH \"test_res_ckt.gds\"|LAYOUT PATH \"$WORK/$CELL.gds\"|" \
  -e "s|^LAYOUT PRIMARY \"test_res_ckt.*|LAYOUT PRIMARY \"$CELL\"|" \
  -e "s|^SOURCE PATH \"test_res_ckt.cdl\"|SOURCE PATH \"$WORK/$CELL.cdl\"|" \
  -e "s|^SOURCE PRIMARY \"test_res_ckt\"|SOURCE PRIMARY \"$CELL\"|" \
  -e "s|^LVS GROUND NAME.*|LVS GROUND NAME \"B\" \"VSS\" \"SAVSS?\" \"?GND?\" \"?VSS?\"|" \
  -e "s|^LVS SOFT SUBSTRATE PINS.*|LVS SOFT SUBSTRATE PINS YES|" \
  "$WORK/effective.xrc"

# newline guard: the deck does not end with one, and appending straight after it
# glued "MASK" to "//" and produced a Tcl parse error on an earlier attempt.
printf '\n' >> "$WORK/effective.xrc"
cat >> "$WORK/effective.xrc" <<EOF
// ===== PEX section appended by scratch/drc/pex15.sh =====
PEX RULES "$CRULE"
PEX RESISTANCE RULES "$RRULE"
PEX NETLIST LUMPED "lumped.dist" HSPICE LAYOUT GROUND B MASK
PEX REPORT LUMPED "cap.rep" LAYOUT
MASK SVDB DIRECTORY svdb XRC
EOF

echo "--- key lines ---"
grep -n 'LAYOUT PATH\|LAYOUT PRIMARY\|PEX RULES\|PEX NETLIST\|LVS GROUND NAME' "$WORK/effective.xrc" | tail -8

calibre -gui -pex -batch "$WORK/effective.xrc" > "$WORK/calibre.stdout" 2>&1 || true

echo "--- verdict ---"
grep -iE 'Interactive Error|PEX completed|XRC completed|ERROR|CORRECT' "$WORK/calibre.stdout" | head -8
echo "--- files ---"
ls -la "$WORK"/ | grep -vE '^total' | head -20
