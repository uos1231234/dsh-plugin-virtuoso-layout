; Which zoom-related entry points does this Virtuoso actually have?
; procedurep()` distinguishes "defined" from "exists as a symbol", which matters
; here because the 6.1.7 build lacks several APIs the 6.1.8 docs list.
let((out names)
  out = ""
  names = list("hiSetViewBox" "hiZoomAbsolute" "hiZoomIn" "hiZoomOut"
               "hiFitAll" "leFitAll" "hiSetWindowBox" "hiGetWindowBox"
               "hiSetViewport" "hiZoomWindow" "hiWindowFit")
  foreach( n names
    out = strcat(out sprintf(nil "%-18s %L\n" n procedurep(n)) ) )
  out)