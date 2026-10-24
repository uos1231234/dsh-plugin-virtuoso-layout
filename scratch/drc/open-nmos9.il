; Open dsh_nmos9 for a screenshot, fitted to its window.
let(( w out )
  w = errset(geOpen(?lib "DSH_NMOS" ?cell "dsh_nmos9" ?view "layout" ?mode "r"))
  out = sprintf(nil "opened=%L\n" w)
  when( car(w) errset(hiSetCurrentWindow(car(w))) )
  out)