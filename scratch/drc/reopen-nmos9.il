; Close window 26 and reopen dsh_nmos9 -- a fresh geOpen fits the new window to
; the cell automatically, which is more reliable than trying to drive zoom on a
; window whose view is already in a strange state.
let(( out )
  out = ""
  ; close the blank window
  errset( hiCloseWindow( window(26) ) )
  ; reopen
  let(( w )
    w = errset( geOpen(?lib "DSH_NMOS" ?cell "dsh_nmos9" ?view "layout" ?mode "r") )
    out = strcat(out sprintf(nil "reopened=%L\n" w)) )
  out)