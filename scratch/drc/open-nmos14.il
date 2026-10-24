; Open dsh_nmos14 in a fitted window so the ring's opening is visible.
let(( w out )
  w = errset( geOpen(?lib "DSH_NMOS" ?cell "dsh_nmos14" ?view "layout" ?mode "r") )
  out = sprintf(nil "opened=%L\n" w)
  when( car(w)
    errset( hiSetCurrentWindow( car(w) ) )
    errset( hiZoomAbsoluteScale( car(w) 0.9 ) ) )
  out)