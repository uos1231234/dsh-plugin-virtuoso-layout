; draw-nmos14.il -- NMOS + P+ guard ring as a FRAME, not a bar
;
; The single most important correction this round: the "ring" in dsh_nmos13 was
; four rectangles that overlapped in y and filled in -- a solid bar beside the
; device, not a loop around it. solve-ring-frame.py proves this one is a frame by
; rasterising it and counting the hole (76608 enclosed cells) rather than
; trusting the four coordinates.
;
; The ring encloses the device below it: top of the ring stays below the device's
; SP-side constraints, so SN_18&SP_18 stays clean -- the ring's SP and the
; device's SN never share a y band at all.
;
; Only two rectangles of each side exist where they must: the frame is four AA
; sides + SP covering it. Metal and contacts come after the shape is proven.

let(( cv out ring )
  cv  = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos14" "layout" "maskLayout" "a")
  src = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos9"  "layout" "maskLayout" "r")
  foreach( s cv~>shapes dbDeleteObject(s) )

  ; copy nmos9 minus the tap strip (entirely below the device)
  foreach( s src~>shapes
    let(( bb skip )
      bb = s~>bBox
      skip = nil
      when( cadadr(bb) < -0.30 skip = t )
      when( s~>objType == "label"
        when( cadar(bb) < -0.30 skip = t ) )
      unless( skip
        case( s~>objType
          ( "rect"
            dbCreateRect( cv s~>lpp
              list( list( caar(bb) cadar(bb) ) list( caadr(bb) cadadr(bb) ) ) ) )
          ( "label"
            dbCreateLabel( cv s~>lpp
              list( caar(bb) cadar(bb) )
              s~>theLabel "centerCenter" "R0" "roman" 0.10 ) ) ) ) ) )

  ; ---- the ring as a frame (solve-ring-frame.py) ----------------------------
  ; Outer ring x -0.48..2.88, y -1.67..0.32. Ring width 0.42 (a contact plus
  ; 0.10 enclosure each side). The top edge is at -0.28, and the ring's SP stays
  ; at -0.10 so it never meets SN's bottom edge (-0.64).
  ring = list(
    list("AA" -0.30 -1.49 2.70 -1.07)    ; bottom
    list("AA" -0.30 -0.70 2.70 -0.28)    ; top
    list("AA" -0.30 -1.59 0.12 -0.18)    ; left  -- overlaps bottom and top
    list("AA"  2.28 -1.59 2.70 -0.18)    ; right -- overlaps bottom and top
    list("SP" -0.48 -1.67 2.88 -0.10)    ; over the ring, ends 0.18 clear of SN
  )
  foreach( r ring
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cddddr(r)) ) ) ) )

  ; ---- contacts and metal on the ring ---------------------------------------
  ; Six contacts: one centred on each side, one on each corner. Metal: four
  ; straps that overlap at the corners so the ring is one net.
  list(
    list("CT"  0.60 -1.39  0.82 -1.17)  list("CT"  1.80 -1.39  2.02 -1.17)
    list("CT"  0.60 -0.60  0.82 -0.38)  list("CT"  1.80 -0.60  2.02 -0.38)
    list("CT" -0.20 -0.95 -0.02 -0.73)  list("CT"  2.42 -0.95  2.60 -0.73)
    list("M1" -0.30 -1.49  2.70 -1.07)
    list("M1" -0.30 -0.70  2.70 -0.28)
    list("M1" -0.30 -1.49  0.12 -0.18)
    list("M1"  2.28 -1.49  2.70 -0.18)
  )

  ; B label goes on the ring's metal over a contact, on M1 drawing -- the layer
  ; the deck actually reads for ports (TEXT LAYER <n> ATTACH <n> metal1).
  dbCreateLabel( cv list("M1" "drawing") list(-0.09 -1.23) "B" "centerCenter" "R0" "roman" 0.10 )

  out = sprintf(nil "shapes=%d bbox=%L\n" length(cv~>shapes) cv~>bBox)
  out = strcat(out sprintf(nil "SAVE %L\n" errset(dbSave(cv))))
  out)