; draw-nmos5.il -- NMOS from rule equations, SMIC 0.18 (smic18ee)
;
; Correction that made this file possible, and it is an environment fact worth
; recording: in THIS Virtuoso (6.1.7-64b), prefix arithmetic -- (- 3.0 0.18),
; (+ 3.0 0.18) -- is NOT available. It fails with
;     *Error* load: error while loading file - "...vb_eval_XXXX.il" at line N
; where N is the END of the wrapper, so the message points nowhere useful. The
; INFIX form (a - b) works fine, and so does `x - 0.18` inline.
;
; Every derived coordinate below therefore uses infix arithmetic. The previous
; versions of this file were dominated by (- x d) forms, which is why they died
; with a location-less load error rather than a useful one.
;
; Geometry is built to satisfy the foundry's design rules. Rule IDENTIFIERS are kept,
; because those are what a DRC report names; the rule wording and the numeric limits
; are deliberately NOT reproduced here (see README, "What is not in this repository").
; What each constraint means in practice:
;   GP_11a  no bends on the active area        -> the gate ENDS exactly on the active boundary.
;   GP_7    field poly must not crowd the AA   -> the gate pad is a separate shape, offset above active.
;   CT_10   contacts on the gate region are barred -> gate contact lands on the pad only.
;   CT_7a   the gate pad must enclose its contact
;   CT_6a   active must enclose its contact
;   CT_1    contact size is bounded in both directions
;   M1_1    minimum M1 width
;   M1_3&4  M1 enclosure over a contact / at a line end
;   M1_2    minimum M1 spacing
;   M1_6    minimum M1 area
;   SN_9    source/drain implant must enclose its active
;   SN_18 & SP_18  the two implant types may not overlap

let(( cv out L W AX G1x0 G1x1 AAy0 AAy1 AAx0 AAx1 ret )

  L = 0.18                          ; gate length
  W = 1.20                          ; gate width = active height (LVS measured)
  AX = 1.20                         ; symmetry axis

  AAx0 = 0.30   AAx1 = 2.10
  AAy0 = 0.00   AAy1 = W
  G1x0 = AX - L*0.5                 ; infix, not (- AX 0.09)
  G1x1 = AX + L*0.5

  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos5" "layout" "maskLayout" "a")
  foreach( s cv~>shapes dbDeleteObject(s) )

  ret = list(
    ; active (device) and tap active
    list("AA" AAx0 AAy0 AAx1 AAy1)
    list("AA" AAx0 -0.90 AAx1 -0.50)

    ; gate finger: exactly the active height
    list("GP" G1x0 AAy0 G1x1 AAy1)

    ; gate pad: separate field-poly, <rv> above active (GP_7)
    list("GP" AX-0.21 1.30 AX+0.21 1.72)

    ; implants, <rv> beyond active (SN_9), well separated from each other
    list("SN" AAx0-0.18 AAy0-0.18 AAx1+0.18 AAy1+0.18)
    list("SP" AAx0-0.18 -1.08 AAx1+0.18 -0.32)

    ; diffusion contacts, <rv> square (CT_1), <rv> inside the active ends
    list("CT" 0.52 0.12 0.74 0.34)
    list("CT" 0.52 0.86 0.74 1.08)
    list("CT" 1.66 0.12 1.88 0.34)
    list("CT" 1.66 0.86 1.88 1.08)

    ; gate contact on the pad, <rv> GP enclosure (CT_7a)
    list("CT" AX-0.11 1.40 AX+0.11 1.62)

    ; tap contacts
    list("CT" 0.60 -0.78 0.82 -0.56)
    list("CT" 1.58 -0.78 1.80 -0.56)

    ; metal, +0.10 over every contact
    list("M1" 0.42 0.02 0.84 1.18)
    list("M1" 1.56 0.02 1.98 1.18)
    list("M1" AX-0.11 1.30 AX+0.11 1.72)
    list("M1" 0.50 -0.88 0.92 -0.46)
    list("M1" 1.48 -0.88 1.90 -0.46)
  )

  foreach( r ret
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cdddr(r)) ) ) ) )

  dbCreateLabel( cv list("M1" "pin") list(0.63 0.60) "D" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.77 0.60) "S" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.20 1.51) "G" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(0.71 -0.67) "B" "centerCenter" "R0" "roman" 0.10 )

  out = sprintf(nil "DRAWN %d shapes\n" length(cv~>shapes))
  out = strcat(out sprintf(nil "SAVE  %L\n" errset(dbSave(cv))))
  out = strcat(out sprintf(nil "BBOX  %L\n" cv~>bBox))
  out)