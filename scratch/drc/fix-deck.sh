sed -i 's|^#include |INCLUDE |' /tmp/drc/../drc/effective.drc 2>/dev/null
# regenerate properly: the include directive is INCLUDE, not #include
python - <<'PY'
deck = "<PDK_ROOT>/calibre/drc/SmicDR10T_<rev>.drc"
work = "/tmp/drc"
body = open(deck).read()
override = f'''
// ===== run-specific overrides (appended, so they win) =====
LAYOUT PATH "{work}/dsh_nmos2.gds"
LAYOUT PRIMARY "dsh_nmos2"
LAYOUT SYSTEM GDSII
DRC RESULTS DATABASE "{work}/dsh_nmos2.drc.results" ASCII
DRC SUMMARY REPORT "{work}/dsh_nmos2.drc.summary"
DRC MAXIMUM RESULTS 1000
DRC MAXIMUM VERTEX 4096
'''
open(f"{work}/effective.drc","w").write(body + override)
print("effective.drc bytes:", len(body+override))
PY
grep -n "^LAYOUT PATH" /tmp/drc/effective.drc | head