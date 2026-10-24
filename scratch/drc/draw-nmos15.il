; draw-nmos15.il -- NMOS inside a real four-sided P+ guard ring
;
; Everything here is computed, not tuned. The history that forced it:
;   dsh_nmos13  the "ring" was four rectangles that overlapped in y and filled
;               in -- a solid bar beside the device, not a loop. Only the picture
;               showed it; no DRC rule says "a ring must have a hole".
;   dsh_nmos14  the ring was raised to clear the gate pad, but its SP then shared
;               a y band with the device's SN implant -> SN_18&SP_18 flagged the
;               whole SN rectangle (220 -640)-(2180 -100).
;
; The geometry that resolves it, derived from the rules:
;   SP must not overlap SN at all (SN_18&SP_18), so the ring's SP has to sit
;   outside the SN box, which is 0.22..2.18 x -0.64..1.84.
;   The ring's AA is 0.42 wide (a 0.22 contact + 0.10 enclosure each side), and
;   SP extends <rv> beyond it (SP_9), so the opening is the SN box grown by <rv>.
;   The gate strap must stop <rv> short of the ring's top metal (M1_2), which
;   fixes the gate metal's top at 2.16 and the gate contact at y 1.77..1.99.
;
; Result: a frame with an opening, the device entirely inside it, and the ring's
; implant never sharing a band with the device's implant.
let(( cv out rects )
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos15" "layout" "maskLayout" "a")
  foreach( s cv~>shapes dbDeleteObject(s) )

  rects = list(
    ; ---------------- device, inside the ring ----------------------------
    list("AA"  0.40  0.00  2.00  1.20)   ; active, W = 1.20
    list("GP"  <rv> -0.32  <rv>  <rv>)   ; gate finger, GP_6 extension both ends
    list("GP"  0.99  1.30  1.41  2.19)   ; gate pad, overlaps the finger 1.30..1.52
    list("SN"  <rv> -0.64  <rv>  <rv>)   ; SN_7_17: encloses the gate end
    ; diffusion contacts
    list("CT"  0.50  0.10  0.72  0.32)
    list("CT"  0.50  0.88  0.72  1.10)
    list("CT"  1.68  0.10  1.90  0.32)
    list("CT"  1.68  0.88  1.90  1.10)
    ; gate contact, lowered to 1.77..1.99 so its metal can clear the ring
    list("CT"  1.09  1.77  1.31  1.99)
    ; metal: drain, source, gate
    list("M1"  0.36 -0.04  0.80  1.24)
    list("M1"  1.60 -0.04  2.04  1.24)
    list("M1"  <rv>  <rv>  <rv>  <rv>)   ; <rv> x <rv> = <rv>, over M1_6's <rv>

    ; ---------------- guard ring: four AA sides --------------------------
    list("AA" -0.48 -1.34  2.88 -0.92)   ; bottom
    list("AA" -0.48  2.39  2.88  2.81)   ; top
    list("AA" -0.48 -1.34 -0.06  2.81)   ; left
    list("AA"  2.46 -1.34  2.88  2.81)   ; right

    ; ---------------- ring implant: four SP sides, 0.18 beyond -----------
    list("SP" -0.66 -1.52  3.06 -0.74)
    list("SP" -0.66  2.21  3.06  2.99)
    list("SP" -0.66 -1.52  0.12  2.99)
    list("SP"  2.28 -1.52  3.06  2.99)

    ; ---------------- ring contacts --------------------------------------
    list("CT"  0.60 -1.24  0.82 -1.02)
    list("CT"  1.80 -1.24  2.02 -1.02)
    list("CT"  0.60  2.49  0.82  2.71)
    list("CT"  1.80  2.49  2.02  2.71)
    list("CT" -0.38 -1.00 -0.16 -0.78)
    list("CT" -0.38  0.20 -0.16  0.42)
    list("CT" -0.38  1.40 -0.16  1.62)
    list("CT"  2.56 -1.00  2.78 -0.78)
    list("CT"  2.56  0.20  2.78  0.42)
    list("CT"  2.56  1.40  2.78  1.62)

    ; ---------------- ring metal: four sides, corners overlap ------------
    list("M1" -0.48 -1.34  2.88 -0.92)
    list("M1" -0.48  2.39  2.88  2.81)
    list("M1" -0.48 -1.34 -0.06  2.81)
    list("M1"  2.46 -1.34  2.88  2.81)
  )

  foreach( r rects
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cddddr(r)) ) ) ) )

  ; Labels on M1 drawing. The deck reads ports from TEXT LAYER <n> ATTACH <n>
  ; metal1, and 61 is M1/drawing -- there is no "M1 pin" entry in the layer map,
  ; so labels drawn on M1/pin depend on the streamer inventing a purpose.
  dbCreateLabel( cv list("M1" "drawing") list( 0.58  0.60) "D" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "drawing") list( 1.82  0.60) "S" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "drawing") list( 1.20  1.87) "G" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "drawing") list(-0.27 -0.89) "B" "centerCenter" "R0" "roman" 0.10 )

  out = sprintf(nil "shapes=%d bbox=%L\n" length(cv~>shapes) cv~>bBox)
  out = strcat(out sprintf(nil "SAVE %L\n" errset(dbSave(cv))))
  out)
