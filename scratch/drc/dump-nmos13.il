; Read back dsh_nmos13 and print it in the form connectivity.py consumes.
let(( cv out )
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos13" "layout" "maskLayout" "r")
  out = sprintf(nil "shapes=%d bbox=%L\n" length(cv~>shapes) cv~>bBox)
  foreach( s cv~>shapes
    when( s~>objType == "rect"
      out = strcat(out sprintf(nil "%s %.3f %.3f %.3f %.3f\n"
        car(s~>lpp)
        caar(s~>bBox) cadar(s~>bBox) caadr(s~>bBox) cadadr(s~>bBox) ))))
  foreach( s cv~>shapes
    when( s~>objType == "label"
      out = strcat(out sprintf(nil "LABEL %s %.3f %.3f\n"
        car(s~>lpp) caar(s~>bBox) cadar(s~>bBox) ))))
  out)