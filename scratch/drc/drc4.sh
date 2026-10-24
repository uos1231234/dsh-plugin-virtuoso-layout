set -e
WORK=/tmp/drc
DECK=<PDK_ROOT>/calibre/drc/SmicDR10T_<rev>.drc
cp "$DECK" "$WORK/effective.drc"
sed -i \
  -e 's|^LAYOUT PATH "xxx.gds"|LAYOUT PATH "/tmp/drc/nmos4.gds"|' \
  -e 's|^LAYOUT PRIMARY "\*"|LAYOUT PRIMARY "dsh_nmos4"|' \
  -e 's|^DRC RESULTS DATABASE "drc_cal.out" ASCII|DRC RESULTS DATABASE "/tmp/drc/nmos4.drc.results" ASCII|' \
  -e 's|^DRC SUMMARY REPORT "drc_cal.sum"|DRC SUMMARY REPORT "/tmp/drc/nmos4.drc.summary"|' \
  "$WORK/effective.drc"
echo "--- head 3 ---"; head -3 "$WORK/effective.drc"
echo "--- targets ---"; grep -n 'LAYOUT PATH\|LAYOUT PRIMARY\|DSH\|dsh_nmos4' "$WORK/effective.drc" | head -4
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
cd "$WORK"
calibre -drc -64 -hier -turbo 2 "$WORK/effective.drc" > "$WORK/calibre.stdout" 2>&1 || true
grep -E 'TOTAL RULECHECKS|TOTAL RESULTS|COMPLETED' "$WORK/calibre.stdout" | head -4