/* Deliberately unguarded: let the error surface so the bridge reports it. */
let((cv)
  cv = dbOpenCellViewByType("DSH_LAYOUT" "dsh_demo" "layout" "maskLayout" "a")
  dbCreateRect(cv list("Metal1" "drawing") list(list(0 0) list(5 5))))
