export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat
cd /tmp/drc
timeout 300 calibre -drc -64 -hier -turbo 2 /tmp/drc/effective.drc > /tmp/drc/calibre.stdout 2>&1
echo "exit=$?"
echo "--- tail ---"
tail -25 /tmp/drc/calibre.stdout
echo "--- artefacts ---"
ls -l /tmp/drc/*.results /tmp/drc/*.summary 2>/dev/null