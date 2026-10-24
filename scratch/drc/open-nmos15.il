; Open dsh_nmos15 fitted, so the four-sided ring around the device is visible.
let(( w out )
  w = errset( geOpen(?lib "DSH_NMOS" ?cell "dsh_nmos15" ?view "layout" ?mode "r") )
  out = sprintf(nil "opened=%L\n" w)
  when( car(w)
    errset( hiSetCurrentWindow( car(w) ) )
    errset( hiZoomAbsoluteScale( car(w) 0.9 ) ) )
  out)