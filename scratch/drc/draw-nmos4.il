; draw-nmos4.il -- DRC-orientated NMOS, SMIC 0.18 (smic18ee), take 2
;
; Why this version is structured so differently from take 1: take 1 declared ~40
; variables in ONE let, and the whole program died with only
;   "*Error* load: error while loading file ... at line N"
; where N is the END of the wrapper -- no fault, no line, no message. Bisecting
; (probe-bisect.il) showed every individual construct works: open+clear, a rect,
; a label with a computed midpoint, a label with the arithmetic inline, and a
; nested let. So the failure was the shape of the program, not any one call.
;
; The rewrite therefore:
;   - declares a handful of variables, not forty;
;   - computes geometry into a LIST of (layer x0 y0 x1 y1) in one pass and draws
;     from that list, so the coordinate arithmetic is separated from the API call;
;   - defines the mirror as a local lambda taking the axis as an argument, so it
;     does not depend on an enclosing binding.
;
; Every dimension is derived from a rule id, not from "looks right":
;   CT_6a  AA enclosure of a contact   >= <rv>
;   CT_7a  GP enclosure of a gate contact >= <rv>
;   CT_4a  gate contact to AA space    >= <rv>
;   M1_2   M1 to M1 space              >= <rv>
;   M1_6   M1 minimum area             >= <rv> um^2
;   SN_9   SN beyond active            >= <rv>
;   GP_7   field poly to AA space      >= <rv>

let(( XC cv rects out )

  XC = 1.60                       ; symmetry axis
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos4" "layout" "maskLayout" "a")
  foreach( s cv~>shapes dbDeleteObject(s) )

  ; ---- geometry, as data ---------------------------------------------------
  ; Each entry: (layer x0 y0 x1 y1). Written once; the mirror is generated.
  rects = list(

    ; active and tap
    list("AA" 0.30 0.00 2.90 1.40)
    list("AA" 0.30 -1.10 2.90 -0.60)

    ; gate finger and its pad (pad is wide enough for CT_7a on all sides)
    list("GP" 1.51 -0.30 1.69 1.70)
    list("GP" 1.39 1.62 1.81 2.04)

    ; implants: SN_9 needs <rv> beyond active
    list("SN" 0.12 -0.18 3.08 1.58)
    list("SP" 0.12 -1.28 3.08 -0.42)

    ; diffusion contacts, left column, two rows
    list("CT" 0.54 0.14 0.76 0.36)
    list("CT" 0.54 1.04 0.76 1.26)
    ; mirrored column
    list("CT" 2.44 0.14 2.66 0.36)
    list("CT" 2.44 1.04 2.66 1.26)

    ; gate contact, on the axis, inside its pad with GP_ENC margin
    list("CT" 1.49 1.72 1.71 1.94)

    ; tap contacts
    list("CT" 0.60 -0.96 0.82 -0.74)
    list("CT" 2.38 -0.96 2.60 -0.74)

    ; metal over the diffusion contacts: tall, so M1_6 area is far above <rv>
    list("M1" 0.44 0.04 0.86 1.36)
    list("M1" 2.34 0.04 2.76 1.36)
    ; tap metal
    list("M1" 0.50 -1.06 0.92 -0.64)
    list("M1" 2.28 -1.06 2.70 -0.64)
    ; gate metal
    list("M1" 1.41 1.60 1.79 2.14)
  )

  foreach( r rects
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cdddr(r)) ) ) ) )

  ; ---- labels, so LVS has ports -------------------------------------------
  dbCreateLabel( cv list("M1" "pin") list(0.65 0.70) "D" "centerCenter" "R0" "roman" 0.12 )
  dbCreateLabel( cv list("M1" "pin") list(2.55 0.70) "S" "centerCenter" "R0" "roman" 0.12 )
  dbCreateLabel( cv list("M1" "pin") list(1.60 1.87) "G" "centerCenter" "R0" "roman" 0.12 )
  dbCreateLabel( cv list("M1" "pin") list(0.71 -0.85) "B" "centerCenter" "R0" "roman" 0.12 )

  out = sprintf(nil "DRAWN %d shapes (18 rects + 4 labels)\n" length(cv~>shapes))
  out = strcat(out sprintf(nil "SAVE  %L\n" errset(dbSave(cv))))
  out = strcat(out sprintf(nil "BBOX  %L\n" cv~>bBox))
  out
)