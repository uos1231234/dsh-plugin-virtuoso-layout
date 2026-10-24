; Build DSH_NMOS/dsh_nmos3 = the audited geometry of dsh_nmos2 + terminal labels.
;
; Two corrections over the previous attempt, both worth recording:
;
; 1. The existence test `ddGetObj("LIB")~>cells~>dsh_nmos3` is wrong: ddGetObj
;    returns a library object and `cells` is a LIST, not a struct, so the arrow
;    chain cannot work. Use member() over mapcar of the names.
;
; 2. A port is a LABEL, not a rectangle. It must be on a pin-purpose layer
;    (M1 pin here) and sit inside the metal of the net it names. Rectangles alone
;    give Calibre nothing to bind, which is why LVS reported "missing port" four
;    times while every net matched.
;
; Idempotent: clears old labels first, so re-running does not stack them.

let(( out cv names src )
  out = ""
  names = mapcar( lambda( (c) c~>name ) ddGetObj("DSH_NMOS")~>cells )

  if( member("dsh_nmos3" names)
    then
      cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos3" "layout" "maskLayout" "a")
      out = strcat(out "reusing existing dsh_nmos3\n")
    else
      cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos3" "layout" "maskLayout" "a")
      src = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "r")
      foreach( s src~>shapes
        when( s~>objType == "rect"
          dbCreateRect( cv s~>lpp
            list( list( caar(s~>bBox) cadar(s~>bBox) )
                  list( caadr(s~>bBox) cadadr(s~>bBox) ) ) ) ) )
      out = strcat(out sprintf(nil "copied rects from dsh_nmos2\n")) )

  ; clear labels so a re-run does not duplicate them
  let(( n )
    n = 0
    foreach( s cv~>shapes
      when( s~>objType == "label" dbDeleteObject(s) n = n + 1 ) )
    out = strcat(out sprintf(nil "cleared labels=%d\n" n)) )

  ; Four labels, each centred in the metal of its net.
  foreach( spec list(
      list("D" 0.70  0.55)     ; left diffusion metal   M1 0.50-0.90
      list("S" 1.70  0.55)     ; right diffusion metal  M1 1.50-1.90
      list("G" 1.20  1.43)     ; gate metal             M1 1.01-1.39 y 1.24-1.62
      list("B" 0.75 -0.70) )   ; tap metal              M1 0.54-0.96 y -0.88..-0.52
    let(( nm x y )
      nm = car(spec)  x = cadr(spec)  y = caddr(spec)
      dbCreateLabel( cv list("M1" "pin") list(x y) nm "centerCenter" "R0" "roman" 0.12 )
      out = strcat(out sprintf(nil "label %s at (%.2f %.2f)\n" nm x y)) ) )

  out = strcat(out sprintf(nil "SAVE %L\n" errset(dbSave(cv))))
  out = strcat(out sprintf(nil "shapes=%d labels=%d\n"
    length(cv~>shapes)
    length( setof( s cv~>shapes s~>objType == "label" ) )))
  out)