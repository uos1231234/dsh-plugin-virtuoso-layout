; Experiment 2: does NW + NTAP satisfy Convention_FLT_NW, and what else appears?
;
; Findings from experiment 1 (dsh_nmos10):
;   - PW is NOT a drawn layer. The map has PWI (81:0), and the deck derives
;     PW = ((BULK NOT NWi) NOT PBi) NOT DNWi. So drawing on "PW" is silently
;     dropped at stream-out and the deck's PW is already correct by construction.
;     This is why the earlier cells raised no well error: the PMOS-well half of
;     the structure was never missing, it is implicit.
;   - NW IS drawn (GDS 14:0). Adding it raised exactly one new rule:
;         Convention_FLT_NW: "NW without N+ pick up"   (NW NOT INTERACT NTAPi)
;     So an N-well is only legal with an N+ tap inside it.
;
; This cell therefore tries the smallest legal N-well: a box with an N+ pickup
; (AA inside NW + SN to make it N+) and an NTAP contact.
;
; Layout: the NMOS occupies the lower half; the N-well sits above it as a separate
; structure, so the two do not fight over the SN implant.
let(( cv src out )

  cv  = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos11" "layout" "maskLayout" "a")
  src = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos9"  "layout" "maskLayout" "r")

  foreach( s cv~>shapes dbDeleteObject(s) )

  ; copy nmos9 verbatim
  foreach( s src~>shapes
    case( s~>objType
      ( "rect"
        dbCreateRect( cv s~>lpp
          list( list( caar(s~>bBox) cadar(s~>bBox) )
                list( caadr(s~>bBox) cadadr(s~>bBox) ) ) ) )
      ( "label"
        dbCreateLabel( cv s~>lpp
          list( caar(s~>bBox) cadar(s~>bBox) )
          s~>theLabel "centerCenter" "R0" "roman" 0.10 ) ) ) )

  ; ---- N-well with its required N+ pickup -----------------------------------
  ; NW: at least <rv> wide (NW_1) and, since it is not the most-positive supply,
  ; at least 2.10 in its other dimension. Place it clear above the device; the
  ; device's SN reaches y = 1.84, so start at 2.60.
  dbCreateRect( cv list("NW" "drawing") list( list(0.30 2.60) list(2.00 4.80) ) )

  ; N+ pickup inside the well: AA + SN (N+ implant) + a contact + metal.
  ; Keep AA >= 0.20 from the well edge so the well encloses it.
  dbCreateRect( cv list("AA" "drawing") list( list(0.60 2.90) list(1.70 4.50) ) )
  dbCreateRect( cv list("SN" "drawing") list( list(0.42 2.72) list(1.88 4.68) ) )
  dbCreateRect( cv list("CT" "drawing") list( list(1.04 3.59) list(1.26 3.81) ) )
  dbCreateRect( cv list("M1" "drawing") list( list(0.94 3.49) list(1.36 3.91) ) )

  out = sprintf(nil "shapes=%d bbox=%L\n" length(cv~>shapes) cv~>bBox)
  out = strcat(out sprintf(nil "SAVE %L\n" errset(dbSave(cv))))
  out)