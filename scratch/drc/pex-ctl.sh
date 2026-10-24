#!/bin/bash
# Control experiment: can the SHIPPED xRC deck be parsed at all by this Calibre?
#
# Nothing is appended and only the two layout placeholders are substituted, so if
# this still fails with the Tcl parse error, the fault is the deck interacting
# with Calibre v2015.2 (the Release Note says the deck was tested against
# v2009.3_24.19), not anything I edited.
set -e
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:/opt/IC617/tools/dfII/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
export CDSHOME=/opt/IC617

CELL=dsh_nmos15
WORK=/tmp/pexctl
DECK=<PDK_ROOT>/calibre/xrc/Calibre/SmicSP12R_<rev>.lvs_XRC
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"

cp /tmp/pex15b/$CELL.gds "$WORK/" 2>/dev/null || \
  strmout -library DSH_NMOS -strmFile "$WORK/$CELL.gds" -strmVersion 3 -topCell "$CELL" \
    -view layout -techLib smic18ee -layerMap "<PDK_ROOT>/stream/strmoutMap" \
    -translateUnmappedLPP -logFile "$WORK/s.log" > /dev/null 2>&1

cp "$DECK" "$WORK/ctl.xrc"
sed -i -e "s|^LAYOUT PATH \"test_res_ckt.gds\"|LAYOUT PATH \"$WORK/$CELL.gds\"|" \
       -e "s|^LAYOUT PRIMARY \"test_res_ckt.*|LAYOUT PRIMARY \"$CELL\"|" "$WORK/ctl.xrc"
echo "changed lines:"
grep -n 'LAYOUT PATH\|LAYOUT PRIMARY' "$WORK/ctl.xrc" | head -3

calibre -gui -pex -batch "$WORK/ctl.xrc" > "$WORK/out.log" 2>&1 || true
echo "--- verdict ---"
grep -iE 'Interactive Error|PEX completed|XRC completed|ERROR' "$WORK/out.log" | head -5
echo "--- files ---"
ls "$WORK" | head -10
