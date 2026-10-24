; procedurep() is useless here: it returns nil even for geOpen and dbCreateRect,
; which demonstrably work. So probe by CALLING, and rely on errset to catch the
; "undefined function" case. The message tells us which path is available.
let(( out cv r1 r2 r3 )
  out = ""
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "r")

  ; 1) the GUI-level stream out, which is what the Layout editor's File>Export uses
  r1 = errset( leStreamOut( cv "/tmp/drc/le.gds" ) )
  out = strcat(out sprintf(nil "leStreamOut    %L\n" r1))

  ; 2) xstream, the newer translator entry point
  r2 = errset( xstream( ?lib "DSH_NMOS" ?cell "dsh_nmos2" ?view "layout"
                        ?outFile "/tmp/drc/x.gds" ?format "GDSII" ) )
  out = strcat(out sprintf(nil "xstream        %L\n" r2))

  ; 3) strmout: the standalone binary, invoked as a shell command
  r3 = errset( sh("which strmout; echo rc=$?") )
  out = strcat(out sprintf(nil "which strmout  %L\n" r3))
  out)