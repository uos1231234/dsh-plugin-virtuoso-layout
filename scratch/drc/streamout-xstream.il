; Stream out DSH_NMOS/dsh_nmos2 using the DOCUMENTED XStream API.
;
; The correction this file records: `streamOut()` is not the SKILL entry point.
; It is the GUI wrapper that reads the global `streamOutKeys` list, and on this
; install it returns nil without logging. The real documented API is
; (Design Data Translator's SKILL Reference, IC6.1.7, "XStream Functions"):
;
;     xstSetField("strmFile" "out.gds")
;     xstSetField("library" "lib1")
;     xstOutDoTranslate()
;
; and xstOutDoTranslate() "Value Returned: nil" -- ALWAYS nil. It is a
; non-blocking issuer, so nil means "issued", not "failed". Every earlier probe
; that treated nil as failure was measuring the wrong thing.
;
; The proof of success is therefore the FILE, not the return value.

let(( out )
  out = ""

  ; ---- the fields the two required ones plus the ones that matter here ------
  out = strcat(out sprintf(nil "set strmFile  %L\n" errset(xstSetField("strmFile" "/tmp/drc/x1.gds"))))
  out = strcat(out sprintf(nil "set library   %L\n" errset(xstSetField("library" "DSH_NMOS"))))
  out = strcat(out sprintf(nil "set topCell   %L\n" errset(xstSetField("topCell" "dsh_nmos2"))))
  out = strcat(out sprintf(nil "set view      %L\n" errset(xstSetField("view" "layout"))))
  out = strcat(out sprintf(nil "set techLib   %L\n" errset(xstSetField("techLib" "smic18ee"))))
  out = strcat(out sprintf(nil "set layMap    %L\n" errset(xstSetField("layerMap" "<PDK_ROOT>/stream/strmoutMap"))))
  out = strcat(out sprintf(nil "set unmapLPP  %L\n" errset(xstSetField("translateUnmappedLPP" "t"))))
  out = strcat(out sprintf(nil "set strmVer   %L\n" errset(xstSetField("strmVersion" "3"))))
  out = strcat(out sprintf(nil "set logFile   %L\n" errset(xstSetField("logFile" "/tmp/drc/x1.log"))))

  ; ---- issue it (nil expected) ----------------------------------------------
  out = strcat(out sprintf(nil "translate     %L\n" errset(xstOutDoTranslate())))

  ; The issuer is non-blocking, so give it a moment before looking for the file.
  errset(sh("sleep 3"))

  out = strcat(out sprintf(nil "file exists   %L\n"
    errset(sh("test -s /tmp/drc/x1.gds && echo YES || echo NO")) ))
  out