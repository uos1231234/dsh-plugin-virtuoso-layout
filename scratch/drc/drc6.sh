export PATH=/opt/IC617/tools/dfII/bin:$PATH
export CDSHOME=/opt/IC617
mkdir -p /tmp/drc6 && cd /tmp/drc6
strmout -library DSH_NMOS -strmFile /tmp/drc6/nmos6.gds -strmVersion 3 \
  -topCell dsh_nmos6 -view layout -techLib smic18ee \
  -layerMap "<PDK_ROOT>/stream/strmoutMap" \
  -translateUnmappedLPP -logFile /tmp/drc6/strmout.log -summaryFile /tmp/drc6/strmout.summary \
  2>&1 | /bin/grep -E "Rectangles|error" | /usr/bin/head -3
DECK=<PDK_ROOT>/calibre/drc/SmicDR10T_<rev>.drc
cp "$DECK" /tmp/drc6/effective.drc
sed -i \
  -e 's|^LAYOUT PATH "xxx.gds"|LAYOUT PATH "/tmp/drc6/nmos6.gds"|' \
  -e 's|^LAYOUT PRIMARY "\*"|LAYOUT PRIMARY "dsh_nmos6"|' \
  -e 's|^DRC RESULTS DATABASE "drc_cal.out" ASCII|DRC RESULTS DATABASE "/tmp/drc6/nmos6.drc.results" ASCII|' \
  -e 's|^DRC SUMMARY REPORT "drc_cal.sum"|DRC SUMMARY REPORT "/tmp/drc6/nmos6.drc.summary"|' \
  /tmp/drc6/effective.drc
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
calibre -drc -64 -hier -turbo 2 /tmp/drc6/effective.drc > /tmp/drc6/calibre.stdout 2>&1 || true
/bin/grep -E 'TOTAL RULECHECKS EXECUTED|TOTAL RESULTS GENERATED' /tmp/drc6/calibre.stdout