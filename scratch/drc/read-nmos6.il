; Read back every shape in dsh_nmos6 and print its layer and bbox, so the extra
; extent (bbox says y max 2.11 but no drawn rectangle was meant to reach that)
; can be identified instead of guessed at.
let(( cv out )
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos6" "layout" "maskLayout" "r")
  out = sprintf(nil "shapes=%d bbox=%L\n" length(cv~>shapes) cv~>bBox)
  foreach( s cv~>shapes
    out = strcat(out sprintf(nil "  %-5s %-8s (%6.2f %6.2f)-(%6.2f %6.2f)\n"
      s~>objType
      car(s~>lpp)
      caar(s~>bBox) cadar(s~>bBox) caadr(s~>bBox) cadadr(s~>bBox) ) ) )
  out)