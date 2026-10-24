; Experiment: is PW a DRAWN layer that matters, or is it derived by the deck?
;
; The deck says (line 438):
;     PWO = ((BULK NOT NWi) NOT PBi) NOT DNWi
;     PW  = PWO NOT EXCLU
; which reads as "PW = everything that is not N-well / PB / DNW", i.e. DERIVED.
; If that is right, drawing boxes on the PW layer changes nothing in DRC, and the
; earlier claim that the cell "has no wells" is wrong in an interesting way: the
; PMOS-well is implicit, and what is genuinely missing is the N-well (for a
; PMOS) and a proper P+ guard ring (for the substrate tie).
;
; This cell exists ONLY to be measured: nmos10 = nmos9 + a PW box + an NW box,
; drawn so that the GDS can be inspected for whether those layers survive the
; stream-out at all.
let(( cv src out )
  cv  = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos10" "layout" "maskLayout" "a")
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

  ; a PW box covering the whole cell, and an NW box off to one side
  dbCreateRect( cv list("PW" "drawing") list(list(-0.40 -2.00) list(2.80 3.00)))
  dbCreateRect( cv list("NW" "drawing") list(list(-0.40 3.20) list(2.80 5.40)))

  out = sprintf(nil "shapes=%d bbox=%L\n" length(cv~>shapes) cv~>bBox)
  out = strcat(out sprintf(nil "SAVE %L\n" errset(dbSave(cv))))
  out)