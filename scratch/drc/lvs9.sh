set -e
export PATH=/opt/IC617/tools/dfII/bin:$PATH
export CDSHOME=/opt/IC617
WORK=/tmp/lvs9
mkdir -p "$WORK" && cd "$WORK"
strmout -library DSH_NMOS -strmFile "$WORK/dsh_nmos9.gds" -strmVersion 3 \
  -topCell dsh_nmos9 -view layout -techLib smic18ee \
  -layerMap "<PDK_ROOT>/stream/strmoutMap" \
  -translateUnmappedLPP -logFile "$WORK/strmout.log" -summaryFile "$WORK/strmout.summary" \
  2>&1 | /bin/grep -E "Rectangles" | /usr/bin/head -2
DECK=<PDK_ROOT>/calibre/lvs/SmicSP12R_<rev>.lvs
cp "$DECK" "$WORK/effective.lvs"
sed -i \
  -e "s|^SOURCE PATH \"test_res_ckt.cdl\"|SOURCE PATH \"$WORK/dsh_nmos9.cdl\"|" \
  -e "s|^SOURCE PRIMARY \"test_res_ckt\"|SOURCE PRIMARY \"dsh_nmos9\"|" \
  -e "s|^LAYOUT PATH \"test_res_ckt.gds\"|LAYOUT PATH \"$WORK/dsh_nmos9.gds\"|" \
  -e "s|^LAYOUT PRIMARY \"test_res_ckt.*|LAYOUT PRIMARY \"dsh_nmos9\"|" \
  -e "s|^LVS REPORT \"lvs.rep\"|LVS REPORT \"$WORK/dsh_nmos9.lvs.rep\"|" \
  "$WORK/effective.lvs"
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
calibre -lvs -64 -hier -turbo 2 "$WORK/effective.lvs" > "$WORK/calibre.stdout" 2>&1 || true
/bin/grep -E "LVS completed|CORRECT|INCORRECT" "$WORK/calibre.stdout" | /usr/bin/head -3