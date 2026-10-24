#!/bin/bash
# Same DRC flow, but for the ORIGINAL dsh_nmos cell.
#
# Purpose: the audit script judged dsh_nmos (4 failures) vs dsh_nmos2 (0), but
# the audit only checks hand-written geometry rules. Running the real deck on
# both is the only way to know whether the parametric rewrite actually reduced
# real DRC violations, or merely satisfied my own checks.
set -e
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:/opt/IC617/tools/dfII/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
export CDSHOME=/opt/IC617

WORK=/tmp/drc1
CELL=dsh_nmos
DECK=<PDK_ROOT>/calibre/drc/SmicDR10T_<rev>.drc
mkdir -p "$WORK"
cd "$WORK"

strmout -library DSH_NMOS -strmFile "$WORK/$CELL.gds" -strmVersion 3 \
  -topCell "$CELL" -view layout -techLib smic18ee \
  -layerMap "<PDK_ROOT>/stream/strmoutMap" \
  -translateUnmappedLPP \
  -logFile "$WORK/strmout.log" -summaryFile "$WORK/strmout.summary" \
  > "$WORK/strmout.stdout" 2>&1 || true
[ -s "$WORK/$CELL.gds" ] || { echo "no GDS"; tail -10 "$WORK/strmout.stdout"; exit 1; }
echo "GDS: $(stat -c %s "$WORK/$CELL.gds") bytes"

cp "$DECK" "$WORK/effective.drc"
sed -i \
  -e "s|^LAYOUT PATH \"xxx.gds\"|LAYOUT PATH \"$WORK/$CELL.gds\"|" \
  -e "s|^LAYOUT PRIMARY \"\*\"|LAYOUT PRIMARY \"$CELL\"|" \
  -e "s|^DRC RESULTS DATABASE \"drc_cal.out\" ASCII|DRC RESULTS DATABASE \"$WORK/$CELL.drc.results\" ASCII|" \
  -e "s|^DRC SUMMARY REPORT \"drc_cal.sum\"|DRC SUMMARY REPORT \"$WORK/$CELL.drc.summary\"|" \
  "$WORK/effective.drc"

calibre -drc -64 -hier -turbo 2 "$WORK/effective.drc" > "$WORK/calibre.stdout" 2>&1 || true
echo "--- totals ---"
grep -E "TOTAL RULECHECKS EXECUTED|TOTAL RESULTS GENERATED" "$WORK/calibre.stdout"
ls -l "$WORK/$CELL.drc.results" "$WORK/$CELL.drc.summary" 2>/dev/null
