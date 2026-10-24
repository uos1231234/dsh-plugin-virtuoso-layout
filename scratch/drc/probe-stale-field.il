; Is xstSetField actually taking effect, or is the form retaining the previous
; run's values? This matters because nmos4.gds came out containing dsh_nmos2
; while the log claimed it translated dsh_nmos4 -- so one of the two is lying
; about what was translated.
;
; Test: set topCell to a cell that does NOT exist. If the output still contains
; the previously used cell, the field is being ignored (stale form state).
let(( out )
  out = ""
  out = strcat(out sprintf(nil "set topCell=BOGUS  %L\n" errset(xstSetField("topCell" "THIS_CELL_DOES_NOT_EXIST"))))
  out = strcat(out sprintf(nil "set strmFile       %L\n" errset(xstSetField("strmFile" "/tmp/drc/bogus.gds"))))
  out = strcat(out sprintf(nil "set library        %L\n" errset(xstSetField("library" "DSH_NMOS"))))
  out = strcat(out sprintf(nil "set view           %L\n" errset(xstSetField("view" "layout"))))
  out = strcat(out sprintf(nil "translate          %L\n" errset(xstOutDoTranslate())))
  errset(sh("sleep 2"))
  out = strcat(out sprintf(nil "bogus.gds exists   %L\n"
    errset(sh("test -f /tmp/drc/bogus.gds && echo YES || echo NO")) ))
  out)