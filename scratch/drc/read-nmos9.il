; Print M1 rectangles and label positions, using the label's text via ~>theLabel
; (dbCreateLabel stores it there; plain ~>label is not a slot on a label object,
; which is what made the previous probe fail with a load error).
let(( cv out )
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos9" "layout" "maskLayout" "r")
  out = ""
  out = strcat(out "-- M1 rectangles --\n")
  foreach( s cv~>shapes
    when( s~>objType == "rect" && car(s~>lpp) == "M1"
      out = strcat(out sprintf(nil "  M1 (%6.2f %6.2f)-(%6.2f %6.2f)\n"
        caar(s~>bBox) cadar(s~>bBox) caadr(s~>bBox) cadadr(s~>bBox)))))
  out = strcat(out "-- labels --\n")
  foreach( s cv~>shapes
    when( s~>objType == "label"
      out = strcat(out sprintf(nil "  at (%6.2f %6.2f) lpp=%L\n"
        caar(s~>bBox) cadar(s~>bBox) s~>lpp))))
  out)