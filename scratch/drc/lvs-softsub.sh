#!/bin/bash
# LVS with soft substrate pins ENABLED.
#
# Why: the deck connects the P+ pickup to the pwell through a SOFT connection
#     SCONNECT <pickup net> <well net> BY <plug>
# and it declares
#     LVS SOFT SUBSTRATE PINS  <on|off>
# With that off, the substrate node is internal, so a label on the ring cannot
# become a PORT -- which is exactly the symptom:
#     Ports: Layout 3 / Source 4 ; missing port: B ; Nets 4/4 matched
# The ring already MATCHED the B net; it just was not exposed as a pin.
#
# Setting it to YES is the documented way to expose the substrate as a port.
set -e
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:/opt/IC617/tools/dfII/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
export CDSHOME=/opt/IC617

WORK=/tmp/lvs14
CELL=dsh_nmos13
DECK=<PDK_ROOT>/calibre/lvs/SmicSP12R_<rev>.lvs

mkdir -p "$WORK"; cd "$WORK"

strmout -library DSH_NMOS -strmFile "$WORK/$CELL.gds" -strmVersion 3 \
  -topCell "$CELL" -view layout -techLib smic18ee \
  -layerMap "<PDK_ROOT>/stream/strmoutMap" \
  -translateUnmappedLPP -logFile "$WORK/strmout.log" -summaryFile "$WORK/strmout.summary" \
  > "$WORK/strmout.stdout" 2>&1 || true
[ -s "$WORK/$CELL.gds" ] || { echo "no GDS"; exit 1; }
echo "GDS texts: $(grep -E 'Text:' "$WORK/strmout.stdout" | head -1)"

cp "$DECK" "$WORK/effective.lvs"
sed -i \
  -e "s|^SOURCE PATH \"test_res_ckt.cdl\"|SOURCE PATH \"$WORK/$CELL.cdl\"|" \
  -e "s|^SOURCE PRIMARY \"test_res_ckt\"|SOURCE PRIMARY \"$CELL\"|" \
  -e "s|^LAYOUT PATH \"test_res_ckt.gds\"|LAYOUT PATH \"$WORK/$CELL.gds\"|" \
  -e "s|^LAYOUT PRIMARY \"test_res_ckt.*|LAYOUT PRIMARY \"$CELL\"|" \
  -e "s|^LVS REPORT \"lvs.rep\"|LVS REPORT \"$WORK/$CELL.lvs.rep\"|" \
  -e "s|^LVS SOFT SUBSTRATE PINS.*|LVS SOFT SUBSTRATE PINS YES|" \
  "$WORK/effective.lvs"

echo "--- soft substrate setting now ---"
grep -n 'SOFT SUBSTRATE\|SOFTCHK pwell' "$WORK/effective.lvs"

calibre -lvs -64 -hier -turbo 2 "$WORK/effective.lvs" > "$WORK/calibre.stdout" 2>&1 || true
echo "--- verdict ---"
grep -E 'LVS completed|CORRECT|INCORRECT' "$WORK/calibre.stdout" | head -2
