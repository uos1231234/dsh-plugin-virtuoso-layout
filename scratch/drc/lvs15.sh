#!/bin/bash
# LVS for dsh_nmos15, with SOFT SUBSTRATE PINS enabled.
#
# The deck ties the P+ pickup to the pwell through a soft connection
#     SCONNECT <pickup net> <well net> BY <plug>
# and declares  LVS SOFT SUBSTRATE PINS  <on|off>.  With that off the substrate node
# stays internal, so a label on the ring can never become a PORT -- which was
# exactly the dsh_nmos13 symptom: Nets matched 4/4 but "missing port B".
# Turning it on is the documented way to expose the substrate as a pin.
set -e
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:/opt/IC617/tools/dfII/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
export CDSHOME=/opt/IC617

WORK=/tmp/lvs15
CELL=dsh_nmos15
DECK=<PDK_ROOT>/calibre/lvs/SmicSP12R_<rev>.lvs
mkdir -p "$WORK"; cd "$WORK"

strmout -library DSH_NMOS -strmFile "$WORK/$CELL.gds" -strmVersion 3 \
  -topCell "$CELL" -view layout -techLib smic18ee \
  -layerMap "<PDK_ROOT>/stream/strmoutMap" \
  -translateUnmappedLPP -logFile "$WORK/strmout.log" -summaryFile "$WORK/strmout.summary" \
  > "$WORK/strmout.stdout" 2>&1 || true
[ -s "$WORK/$CELL.gds" ] || { echo "no GDS"; exit 1; }

cp "$DECK" "$WORK/effective.lvs"
sed -i \
  -e "s|^SOURCE PATH \"test_res_ckt.cdl\"|SOURCE PATH \"$WORK/$CELL.cdl\"|" \
  -e "s|^SOURCE PRIMARY \"test_res_ckt\"|SOURCE PRIMARY \"$CELL\"|" \
  -e "s|^LAYOUT PATH \"test_res_ckt.gds\"|LAYOUT PATH \"$WORK/$CELL.gds\"|" \
  -e "s|^LAYOUT PRIMARY \"test_res_ckt.*|LAYOUT PRIMARY \"$CELL\"|" \
  -e "s|^LVS REPORT \"lvs.rep\"|LVS REPORT \"$WORK/$CELL.lvs.rep\"|" \
  -e "s|^LVS SOFT SUBSTRATE PINS.*|LVS SOFT SUBSTRATE PINS YES|" \
  "$WORK/effective.lvs"

calibre -lvs -64 -hier -turbo 2 "$WORK/effective.lvs" > "$WORK/calibre.stdout" 2>&1 || true
echo "--- verdict ---"
/bin/grep -E 'LVS completed|CORRECT|INCORRECT' "$WORK/calibre.stdout" | /usr/bin/head -2
echo "--- extracted ---"
/bin/sed -n "/SUBCKT $CELL/,/ENDS/p" "$WORK/svdb/$CELL.sp" 2>/dev/null
