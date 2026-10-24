; Minimal: can dsh_nmos4 be created, cleared, and get one rect + one label?
; The full script fails inside its errset with load code 2, so bisect the two
; operations that are new here: dbDeleteObject over an empty shape list, and
; dbCreateLabel on a "pin" purpose.
let(( out cv )
  out = ""

  out = strcat(out sprintf(nil "lib %L\n" errset(ddGetObj("DSH_NMOS"))))
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos4" "layout" "maskLayout" "a")
  out = strcat(out sprintf(nil "cv  %L shapes=%d\n" cv length(cv~>shapes)))

  ; 1) creating a rect
  out = strcat(out sprintf(nil "rect %L\n"
    errset(dbCreateRect(cv list("AA" "drawing") list(list(0.0 0.0) list(1.0 1.0))))) )
  out = strcat(out sprintf(nil "  now %d shapes\n" length(cv~>shapes)))

  ; 2) a label on M1 pin
  out = strcat(out sprintf(nil "label %L\n"
    errset(dbCreateLabel(cv list("M1" "pin") list(0.5 0.5) "D" "centerCenter" "R0" "roman" 0.12))) )
  out = strcat(out sprintf(nil "  now %d shapes\n" length(cv~>shapes)))

  ; 3) deleting everything
  out = strcat(out sprintf(nil "clear %L\n" errset(foreach(s cv~>shapes dbDeleteObject(s)))) )
  out = strcat(out sprintf(nil "  now %d shapes\n" length(cv~>shapes)))
  out)