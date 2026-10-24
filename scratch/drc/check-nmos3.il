; Did the add-pins run complete before the modal dialog froze the evaluator?
; A wedged evaluator can leave a half-written cellview, so check rather than
; assume: report the cells in the library and the shape/label counts.
let(( out lib cells cv )
  out = ""
  lib = ddGetObj("DSH_NMOS")
  cells = lib~>cells
  out = strcat(out sprintf(nil "cells in DSH_NMOS: %L\n" mapcar(lambda((c) c~>name) cells)))
  if( member("dsh_nmos3" mapcar(lambda((c) c~>name) cells))
    then
      cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos3" "layout" "maskLayout" "r")
      out = strcat(out sprintf(nil "dsh_nmos3 cv=%L shapes=%d\n" cv length(cv~>shapes)))
      out = strcat(out sprintf(nil "  labels=%d\n"
        length( setof( s cv~>shapes s~>objType == "label" ) )))
    else out = strcat(out "dsh_nmos3 DOES NOT EXIST\n") )
  out)