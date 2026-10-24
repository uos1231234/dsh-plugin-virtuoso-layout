; Open both cells side by side so the asymmetry and the fix are visible at once.
; geOpen returns a window id per call; the second is positioned to the right of
; the first by the window manager, which is enough for a screenshot.
let((w1 w2 out)
  out = ""
  w1 = errset(geOpen(?lib "DSH_NMOS" ?cell "dsh_nmos" ?view "layout" ?mode "r"))
  out = strcat(out sprintf(nil "nmos(original) %L\n" w1))
  w2 = errset(geOpen(?lib "DSH_NMOS" ?cell "dsh_nmos2" ?view "layout" ?mode "r"))
  out = strcat(out sprintf(nil "nmos2(parametric) %L\n" w2))
  errset(hiSetCurrentWindow(car(w2)))
  out = strcat(out "focused=window2\n")
  out)
