; Minimal streamOut probe. Bisected because the fuller script failed at load
; time, and a load error reports the END of the wrapper, not the fault.
; Step 1: can we write ANY gds at all?
let(( cv res )
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "r")
  res = errset( streamOut( cv "/tmp/drc/dsh_nmos2.gds" ) )
  sprintf(nil "cv=%L streamOut=%L" cv res)
)