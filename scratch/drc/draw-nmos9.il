; draw-nmos9.il -- device + tap, both solved by the constraint scripts
;
; Device geometry:  .validate/solve-nmos.py
; Tap geometry:     .validate/solve-tap.py   (the 6 real violations from nmos8)
;
; The tap rules that took a dedicated solver, because they conflict unless the
; bar is placed from the rules rather than by eye:
;   SP_16  SP top must be <rv> below the gate bottom  -> pins SP's top edge
;   SP_1   SP width >= <rv>                            -> SP's height, which then
;          forces the TAP taller too, because SP_8 needs <rv> of overlap on the
;          tap and SP_10&11 needs <rv> of extension past it
;   SP_8   SP overlap of the tap >= <rv>
;   SN_7_17  SN must enclose the GATE end (not just the active) by <rv> -- the
;          gate sticks out by GP_EXT, so SN's extent is GP_EXT + SN_GATE = 0.64,
;          not the 0.18 the earlier cells used
;   M1_6   the gate strap needs <rv> um^2; the pad is only <rv> wide, so the area
;          comes from length (<rv>), which GP_6's extension makes available
;
; Also fixes BAD_IMP ("AA area without any implant"): the tap is now fully inside
; SP, and the device fully inside SN, with no uncovered sliver between them.
let(( cv out ret )

  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos9" "layout" "maskLayout" "a")
  foreach( s cv~>shapes dbDeleteObject(s) )

  ret = list(
    ; ---- device (solve-nmos.py) --------------------------------------------
    list("AA" 0.40  0.00 2.00 1.20)          ; W = 1.20
    ; The gate must be ONE polygon. Two previous shapes -- finger (to 1.52) plus a
    ; pad starting at <rv> -- left a <rv> gap that GP_4 demands only BETWEEN
    ; SEPARATE field-oxide shapes, not within one continuous gate. Splitting them
    ; made the gate two nets: Calibre extracted "M0 S 5 D B", gate on node 5,
    ; twice, even after the M1 strap was extended to touch both.
    ;
    ; One rectangle from -0.32 (GP_6 at the bottom) to <rv>, <rv> wide in the pad
    ; region, 0.18 wide through the channel. A single rect cannot have two widths,
    ; so the gate is a finger plus a pad that OVERLAP: the pad starts inside the
    ; finger's x range and at y 1.40, which is below the finger's top (1.52), so
    ; the union is connected and GP_4 does not apply (they are not separate).
    list("GP" <rv> -0.32 <rv> <rv>)          ; finger, <rv> wide, GP_6 compliant
    ; Pad: 0.42 wide (contact 0.22 + GP_ENC 0.10 each side), overlapping the
    ; finger from 1.30 to its top 1.52 so the union is one connected shape.
    list("GP" 0.99  1.30 1.41 2.19)
    ; SN_4 needs <rv> between SN and the P+ pickup AA. SN's bottom was -0.64 and
    ; the tap top is -0.69, leaving 0.05. Raising SN's bottom to -0.59 gives
    ; 0.10 exactly -- but SN must still enclose the gate end (-0.32) by 0.32,
    ; i.e. reach -0.64. Those two conflict, so the TAP moves down instead, which
    ; keeps SN_7_17 satisfied and opens SN_4 up.
    list("SN" <rv> -0.64 <rv> <rv>)          ; SN_7_17: encloses the gate by <rv>
    list("CT" 0.50  0.10 0.72 0.32)
    list("CT" 0.50  0.88 0.72 1.10)
    list("CT" 1.68  0.10 1.90 0.32)
    list("CT" 1.68  0.88 1.90 1.10)
    list("CT" 1.09  1.87 1.31 2.09)          ; gate contact, inside the raised pad

    ; ---- tap (solve-tap.py) ------------------------------------------------
    ; The violation coordinates from CT_6a/CT_8 pinpointed the fault: the flags
    ; were at y -770..-870, which is the tap contact's TOP edge against the tap
    ; active's top edge. That gap was <rv> (need CT_6a <rv>) and <rv> (need
    ; CT_8 <rv>). So the contact must move DOWN within the bar, and the tap must
    ; be tall enough to keep CT_6a on the bottom side too.
    ;
    ; tap active -1.21..-0.79 (0.42 tall = CT 0.22 + 2 x 0.10)
    ; contact    -1.09..-0.87 -> 0.12 clear of the bottom edge, and 0.08 of the
    ;                              top. Solved by making the bar 0.44 tall.
    list("AA" 0.40 -1.23 2.00 -0.79)         ; 0.44 tall: 0.10 + 0.22 + 0.10 + 0.02
    list("SP" <rv> -1.44 <rv> -0.75)         ; <rv> tall, <rv> past the tap (SP_10&11)
    list("CT" 0.52 -1.11 0.74 -0.89)         ; 0.10 from the tap bottom, 0.10 from the top
    list("CT" 1.66 -1.11 1.88 -0.89)

    ; ---- metal -------------------------------------------------------------
    list("M1" 0.36 -0.04 0.80 1.24)         ; drain strap
    list("M1" 1.60 -0.04 2.04 1.24)         ; source strap
    ; GP_4 (<rv>) forces the pad and the finger to be SEPARATE polygons, which
    ; means the gate is electrically two pieces unless something connects them.
    ; That is exactly what LVS caught: "M0 S 5 D B" -- the gate on an internal
    ; node -- because the M1 strap only touched the contact above the pad and
    ; never reached the finger. The connection is made in M1 (metal may cross the
    ; poly spacing rule, poly may not), by extending the gate strap down to the
    ; finger's top end.
    list("M1" 1.03  1.40 1.37 2.37)         ; gate strap: reaches down to the finger
    ; Tap metal must reach M1_6's <rv> um^2: nmos9's <rv> x <rv> = <rv> failed.
    ; Extended to 0.52 x 0.68 = 0.354, and dropped with the tap.
    list("M1" 0.40 -1.42 0.92 -0.74)
    list("M1" 1.48 -1.42 2.00 -0.74)
  )

  foreach( r ret
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cddddr(r)) ) ) ) )

  ; Labels must sit INSIDE the metal of the net they name, or the port binds to
  ; nothing: nmos9's gate label was at y 1.90 while the pad had moved up to
  ; 1.77..2.19 and the contact to 1.87..2.09, so the label landed on the contact
  ; rather than on the M1 strap. LVS then extracted "M0 S 5 D B" with the gate on
  ; an internal node 5 and Nets 5 vs Source 4 -- a one-line cause with a report
  ; that looks like a topology error.
  dbCreateLabel( cv list("M1" "pin") list(0.58 0.60) "D" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.82 0.60) "S" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.20 2.10) "G" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(0.66 -1.10) "B" "centerCenter" "R0" "roman" 0.10 )

  out = sprintf(nil "DRAWN %d shapes\n" length(cv~>shapes))
  out = strcat(out sprintf(nil "SAVE  %L\n" errset(dbSave(cv))))
  out = strcat(out sprintf(nil "BBOX  %L\n" cv~>bBox))
  out)