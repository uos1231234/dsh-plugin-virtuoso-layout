; Open dsh_nmos12 in a fresh window and fit it.
let(( w out )
  w = errset( geOpen(?lib "DSH_NMOS" ?cell "dsh_nmos12" ?view "layout" ?mode "r") )
  out = sprintf(nil "opened=%L\n" w)
  when( car(w)
    errset( hiSetCurrentWindow( car(w) ) )
    ; hiZoomAbsoluteScale: BIGGER value = larger on screen (0.06 made the cell a
    ; dot, 0.9 is the editor's own default). 1.2 fills the canvas for a cell
    ; ~2.2 um wide.
    errset( hiZoomAbsoluteScale( car(w) 1.2 ) ) )
  out)