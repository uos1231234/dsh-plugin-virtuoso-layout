export PATH=/opt/IC617/tools/dfII/bin:$PATH
export CDSHOME=/opt/IC617
mkdir -p /tmp/drc
cd /tmp/drc
strmout \
  -library DSH_NMOS \
  -strmFile /tmp/drc/dsh_nmos2.gds \
  -strmVersion 3 \
  -topCell dsh_nmos2 \
  -view layout \
  -techLib smic18ee \
  -layerMap "<PDK_ROOT>/stream/strmoutMap" \
  -logFile /tmp/drc/strmout.log \
  -summaryFile /tmp/drc/strmout.summary 2>&1 | tail -25
echo "=== RESULT ==="
ls -l /tmp/drc/ 2>/dev/null