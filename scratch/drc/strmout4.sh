export PATH=/opt/IC617/tools/dfII/bin:$PATH
export CDSHOME=/opt/IC617
mkdir -p /tmp/drc4
cd /tmp/drc4
strmout \
  -library DSH_NMOS \
  -strmFile /tmp/drc4/nmos4.gds \
  -strmVersion 3 \
  -topCell dsh_nmos4 \
  -view layout \
  -techLib smic18ee \
  -layerMap "<PDK_ROOT>/stream/strmoutMap" \
  -translateUnmappedLPP \
  -logFile /tmp/drc4/strmout.log \
  -summaryFile /tmp/drc4/strmout.summary 2>&1 | /bin/grep -E "Rectangles|Cells|error" | /usr/bin/head -5
echo "=== what cell is inside? ==="
/usr/bin/strings /tmp/drc4/nmos4.gds | /bin/grep dsh_nmos