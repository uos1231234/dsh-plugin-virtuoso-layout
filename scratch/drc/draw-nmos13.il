; draw-nmos13.il -- NMOS with a P+ guard ring, no N-well.
;
; What changed from dsh_nmos12, and why:
;
;   REMOVED the N-well. A standalone NMOS sits in the P-well, and PW is derived
;   by the deck (PWO = BULK NOT NWi ...), so no N-well is needed. The one I added
;   satisfied NW_3 and Convention_FLT_NW and was electrically floating -- a
;   labelled island connected to nothing. connectivity.py showed it as NET 4 with
;   no label and no neighbour.
;
;   REPLACED the single tap strip with a closed P+ ring. The substrate is
;   resistive, so one tap on one side ties the far corner through a long path;
;   that is the condition latch-up and substrate noise need. A ring puts a tie
;   within a short distance of every point of the device.
;
; The four ring sides OVERLAP at the corners (0.10) rather than merely abutting,
; so rounding cannot open a gap and the union is provably one loop. Verified by
; .validate/connectivity.py, not assumed.
;
; Ring geometry from .validate/solve-ring.py:
;   width <rv>  = a <rv> contact + <rv> AA enclosure on both sides (AA_3 alone
;                 would allow 0.22, which cannot hold a contact)
;   <rv> from the device active (AA_4)
;   <rv> below the SN implant (SN_4)
let(( cv src out ring )

  cv  = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos13" "layout" "maskLayout" "a")
  src = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos9"  "layout" "maskLayout" "r")

  foreach( s cv~>shapes dbDeleteObject(s) )

  ; ---- device: copy from dsh_nmos9 but DROP its tap strip ------------------
  ; The filter below skips shapes in the tap band, and it must NOT skip the
  ; device's own SN implant: SN runs from y -0.64 to 1.84, so its bottom edge is
  ; below the -0.30 cut-off even though most of it covers the device. A first
  ; attempt filtered on the bottom edge alone and deleted SN, which produced
  ;     Convention_BAD_IMP: "AA area without any implant"
  ; flagged at (400 0)-(2000 1200) -- exactly the device active. The filter now
  ; requires the shape to lie ENTIRELY below the cut-off.
  foreach( s src~>shapes
    let(( bb skip )
      bb = s~>bBox
      skip = nil
      ; entirely below the device active -> that is the old tap band
      when( cadadr(bb) < -0.30 skip = t )
      ; the B label sat on the old tap
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

  ; ---- the guard ring (solve-ring.py) --------------------------------------
  ; SP must cover ONLY the ring and stop below the device's SN implant.
  ; solve-ring.py put SP at -1.67..-0.10, which reaches ABOVE SN's bottom edge
  ; (-0.18) and produced four violations at once:
  ;   SN_18&SP_18  (implant overshoot: the two implant types now overlap)
  ;   SN_12&SP_12, SP_3, SP_7_17, SP_16
  ; The ring's top side descends to -0.70, so SP only needs to reach -0.52
  ; (<rv> past it, SP_9) and stays clear of SN.
  ; The ring sits entirely BELOW the SN implant, not beside it.
  ;
  ; SN's bottom edge is at -0.64, not at the active edge (-0.18): SN_7_17 forced
  ; SN to enclose the GATE end, and the gate extends <rv> past the active (GP_6),
  ; so SN had to grow to -0.64. Calibre showed exactly this in the last attempt
  ; by reporting the SN_18&SP_18 overlap as (220 -640)-(2180 -280) -- SP's top
  ; edge cutting into SN. Any ring placed beside the device collides with the
  ; implant that wraps around it, so the ring goes below.
  ring = list(
    list("AA" -0.30 -1.49 2.70 -1.07)     ; bottom
    list("AA" -0.30 -1.34 2.70 -0.92)     ; top
    ; The verticals must stop BELOW the SP's top edge, not level with it:
    ; SP_10&11 wants <rv> of SP beyond the P+ pickup AA, and Calibre flagged the
    ; exact case where both ended at -0.74 (a 4 nm sliver, i.e. zero extension).
    list("AA" -0.30 -1.59 0.12 -0.76)     ; left
    list("AA"  2.28 -1.59 2.70 -0.76)     ; right
    ; SP: <rv> beyond the ring (SP_9), top edge -0.74 leaves <rv> to SN's -0.64
    list("SP" -0.48 -1.67 2.88 -0.74)
  )
  foreach( r ring
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cddddr(r)) ) ) ) )

  ; Contacts and metal on the ring, so it is a real tie and not a floating shape.
  ; A ring with no contact is exactly the mistake dsh_nmos12 made with its N-well
  ; pickup: geometrically present, electrically connected to nothing.
  ;
  ; Contacts sit centred at x -0.09 and 2.49 (the two vertical sides) and on the
  ; two horizontal rails, all inside the 0.42 ring width with 0.10 of AA around.
  list(
    ; bottom rail contacts (rail y -1.49..-1.07)
    list("CT"  0.60 -1.39  0.82 -1.17)
    list("CT"  1.80 -1.39  2.02 -1.17)
    ; top rail contacts (rail y -1.34..-0.92)
    list("CT"  0.60 -1.24  0.82 -1.02)
    list("CT"  1.80 -1.24  2.02 -1.02)
    ; left and right verticals (x -0.30..0.12 and 2.28..2.70)
    list("CT" -0.20 -1.34 -0.02 -1.12)
    list("CT"  2.42 -1.34  2.60 -1.12)
    ; metal: two rails plus two verticals, overlapping at the corners so the ring
    ; is one metal net (same overlap argument as the AA loop)
    list("M1" -0.30 -1.49  2.70 -1.07)
    list("M1" -0.30 -1.34  2.70 -0.92)
    list("M1" -0.30 -1.49  0.12 -0.92)
    list("M1"  2.28 -1.49  2.70 -0.92)
  )

  ; The body label belongs on the ring's metal, and specifically on a piece of
  ; metal that touches the ring AA through a contact. Calibre extracted
  ; "M0 S G D 4": node 4 IS the ring, so the ring is connected -- but the label
  ; did not make it a PORT, because it sat at (-0.09, -0.88) which is on the
  ; left vertical's metal but NOT over a contact, and the extractor names a net
  ; from a label only when the label is on the same connected piece it named.
  ; Put it over the left vertical's contact (x -0.20..-0.02, y -1.34..-1.12).
  dbCreateLabel( cv list("M1" "pin") list(-0.11 -1.23) "B" "centerCenter" "R0" "roman" 0.10 )

  out = sprintf(nil "shapes=%d bbox=%L\n" length(cv~>shapes) cv~>bBox)
  out = strcat(out sprintf(nil "SAVE %L\n" errset(dbSave(cv))))
  out)