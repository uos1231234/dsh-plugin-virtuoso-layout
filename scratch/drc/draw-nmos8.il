; draw-nmos8.il -- geometry from solve-nmos.py including GP_6 and the SP rules
;
; Added to the constraint set after the nmos7 run reported 16 violations:
;   GP_6      gate must extend <rv> beyond the active (NOT pinned to it)
;   SP_1      SP width >= <rv>
;   SP_8      SP must overlap AA by >= <rv>
;   SP_10&11  SP must extend >= <rv> beyond the P+ pick-up AA
;
; GP_6 vs GP_11a was the interesting one: 11a forbids a NON-COINCIDENT edge on
; the active (a gate that stops part-way across it), not a gate that runs past
; it. Running past by 0.32 satisfies both.
let(( cv out ret )

  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos8" "layout" "maskLayout" "a")
  foreach( s cv~>shapes dbDeleteObject(s) )

  ret = list(
    list("AA" 0.40  0.00 2.00 1.20)
    list("AA" 0.40 -0.90 2.00 -0.50)
    ; Gate: a FINGER that runs 0.32 past both active edges, plus a wider PAD at
    ; the top big enough to enclose the gate contact.
    ;
    ; Two separate earlier mistakes are fixed here at once:
    ;   - finger pinned to the active height (<rv>..1.20) -> GP_6 "extension from
    ;     AA to GP 0.32" failed, because the extension was zero;
    ;   - pad as the only GA contact host while the finger stayed narrow -> the
    ;     contact (<rv> wide) cannot be enclosed by a <rv>-wide finger, so CT_7a
    ;     would fail.
    ; The finger now spans -0.32..2.04 (0.18 wide, gate length) and the pad adds
    ; width from 1.62 up, so the contact sits in 0.42 of metal on both sides.
    list("GP" <rv> -0.32 <rv> <rv>)      ; finger, GP_6 compliant
    list("GP" 0.99  1.62 1.41 2.04)      ; pad, encloses the gate contact
    list("SN" 0.22 -0.18 2.18 1.38)
    list("SP" 0.22 -0.75 2.18 -0.27)
    list("CT" 0.50  0.10 0.72 0.32)
    list("CT" 0.50  0.88 0.72 1.10)
    list("CT" 1.68  0.10 1.90 0.32)
    list("CT" 1.68  0.88 1.90 1.10)
    list("CT" 1.09  1.72 1.31 1.94)
    list("M1" 0.36 -0.04 0.80 1.24)
    list("M1" 1.60 -0.04 2.04 1.24)
    list("M1" 1.03  1.62 1.37 2.04)
  )

  foreach( r ret
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cddddr(r)) ) ) ) )

  dbCreateLabel( cv list("M1" "pin") list(0.58 0.60) "D" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.82 0.60) "S" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.20 1.83) "G" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(0.60 -0.70) "B" "centerCenter" "R0" "roman" 0.10 )

  out = sprintf(nil "DRAWN %d shapes\n" length(cv~>shapes))
  out = strcat(out sprintf(nil "SAVE  %L\n" errset(dbSave(cv))))
  out = strcat(out sprintf(nil "BBOX  %L\n" cv~>bBox))
  out)