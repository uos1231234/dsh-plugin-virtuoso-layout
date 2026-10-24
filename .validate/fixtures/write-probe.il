;; Fixture for guard-test.mjs: exactly one mutating call, so the gate has to read
;; the FILE to see it. Never evaluated against the guest.
cv = dbOpenCellViewByType("DSH_LAYOUT" "dsh_demo" "layout" "maskLayout" "a")
dbCreateRect(cv list("M1" "drawing") list(list(0.0 0.0) list(1.0 1.0)))
