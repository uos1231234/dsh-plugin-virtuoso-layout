; Is dsh_nmos9 actually empty in the database? DRC and LVS both read the GDS,
; which was streamed out BEFORE the last several edits. If the cellview lost its
; shapes in one of the redraws (the script clears with dbDeleteObject first), the
; editor would show a blank canvas while the stale GDS still passes.
; That would mean the DRC/LVS results describe an older cell than the one on disk.
let(( cv out )
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos9" "layout" "maskLayout" "r")
  out = sprintf(nil "cv=%L shapes=%d bbox=%L\n" cv length(cv~>shapes) cv~>bBox)
  foreach( s cv~>shapes
    out = strcat(out sprintf(nil "  %-5s %-8s (%6.2f %6.2f)-(%6.2f %6.2f)\n"
      s~>objType car(s~>lpp)
      caar(s~>bBox) cadar(s~>bBox) caadr(s~>bBox) cadadr(s~>bBox) )))
  out)