#!/bin/bash
# Run Calibre LVS on DSH_NMOS/dsh_nmos2.
#
# Same two lessons as the DRC flow: the placeholders in the deck are substituted
# in a COPY (never the foundry file), and the layout side comes from a real GDS.
# The new variable is SOURCE: a hand-written .cdl, because the library has no
# schematic. That is deliberate -- it turns LVS into "does the layout extract to
# the circuit I claim", which is the more useful question here.
set -e
export PATH=/opt/calibre2015/aoi_cal_2015.2_36.27/pkgs/icv.aoi/bin:$PATH
export MGC_HOME=/opt/calibre2015/aoi_cal_2015.2_36.27
export MGLS_LICENSE_FILE=/opt/calibre2015/license.dat

WORK=/tmp/lvs
CELL=dsh_nmos3
DECK=<PDK_ROOT>/calibre/lvs/SmicSP12R_<rev>.lvs
GDS=/tmp/drc/pinned.gds

mkdir -p "$WORK"
cd "$WORK"

[ -s "$GDS" ] || { echo "no GDS at $GDS -- run the stream-out first"; exit 1; }
echo "GDS: $(stat -c %s "$GDS") bytes"

cp "$DECK" "$WORK/effective.lvs"

# Substitute ONLY the placeholder lines the deck ships with. The layout primary
# in the shipped deck is malformed (missing closing quote, line 494), so that
# line is replaced wholesale rather than pattern-matched.
sed -i \
  -e "s|^SOURCE PATH \"test_res_ckt.cdl\"|SOURCE PATH \"$WORK/$CELL.cdl\"|" \
  -e "s|^SOURCE PRIMARY \"test_res_ckt\"|SOURCE PRIMARY \"$CELL\"|" \
  -e "s|^LAYOUT PATH \"test_res_ckt.gds\"|LAYOUT PATH \"$GDS\"|" \
  -e "s|^LAYOUT PRIMARY \"test_res_ckt.*|LAYOUT PRIMARY \"$CELL\"|" \
  -e "s|^LVS REPORT \"lvs.rep\"|LVS REPORT \"$WORK/$CELL.lvs.rep\"|" \
  "$WORK/effective.lvs"

echo "--- substituted lines ---"
grep -n 'SOURCE PATH\|SOURCE PRIMARY\|LAYOUT PATH\|LAYOUT PRIMARY\|LVS REPORT "' "$WORK/effective.lvs" | head -8

calibre -lvs -64 -hier -turbo 2 "$WORK/effective.lvs" > "$WORK/calibre.stdout" 2>&1 || true

echo "--- calibre tail ---"
tail -30 "$WORK/calibre.stdout"
echo "--- report ---"
ls -l "$WORK/$CELL.lvs.rep" 2>/dev/null || echo "no LVS report produced"
