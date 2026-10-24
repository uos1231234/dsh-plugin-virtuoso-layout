#!/bin/bash
# Build the effective rule file: patch ONLY the placeholders the deck leaves for
# the user, in place, instead of appending a second copy of each statement.
#
# Lesson from the previous attempt: appending `LAYOUT PRIMARY` produced
#   "Error SPC1 ... superfluous specification statement: layout primary"
# because the deck already declares it. Calibre treats these as single-valued
# statements, not as last-one-wins. So the correct edit is a substitution of the
# placeholder line, which also keeps the deck's structure and line numbers close
# to the original -- easier to diff against the foundry copy.
set -e
WORK=/tmp/drc
DECK=<PDK_ROOT>/calibre/drc/SmicDR10T_<rev>.drc

cp "$DECK" "$WORK/effective.drc"

# Only these three carry placeholders. Everything else in the deck is real rules.
sed -i \
  -e 's|^LAYOUT PATH "xxx.gds"|LAYOUT PATH "/tmp/drc/nmos4.gds"|' \
  -e 's|^LAYOUT PRIMARY "\*"|LAYOUT PRIMARY "dsh_nmos4"|' \
  -e 's|^DRC RESULTS DATABASE "drc_cal.out" ASCII|DRC RESULTS DATABASE "/tmp/drc/nmos4.drc.results" ASCII|' \
  -e 's|^DRC SUMMARY REPORT "drc_cal.sum"|DRC SUMMARY REPORT "/tmp/drc/nmos4.drc.summary"|' \
  "$WORK/effective.drc"

echo "--- the four lines that matter ---"
grep -n 'LAYOUT PATH\|LAYOUT PRIMARY\|DRC RESULTS DATABASE\|DRC SUMMARY REPORT' "$WORK/effective.drc"
echo "--- any placeholder left? ---"
grep -n 'xxx.gds\|drc_cal.out\|drc_cal.sum' "$WORK/effective.drc" || echo "none"
