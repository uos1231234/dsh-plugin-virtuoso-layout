; draw-nmos12.il -- dsh_nmos9 (DRC-clean device + tap) + N-well with its N+ pickup
;
; What "add the wells" actually means on SMIC 0.18, established by experiment:
;
;   PW is DERIVED by the deck, not drawn.
;       PWO = ((BULK NOT NWi) NOT PBi) NOT DNWi ;  PW = PWO NOT EXCLU
;     Drawing on layer "PW" is silently dropped at stream-out (the deck reported
;     PWIi geometry count 0). So the P-well was never missing -- it is
;     "everything that is not N-well". This corrects the claim in NMOS-FINAL.md
;     that the cell "has no wells at all".
;
;   NW is drawn (14:0) and owes an N+ pickup:
;       Convention_FLT_NW: "NW without N+ pick up"  (NW NOT INTERACT NTAPi)
;     NW alone fires it. NW + AA + SN (an N+ tap) inside satisfies it.
;
;   NW_3 wants BOTH dimensions >= <rv> while the well is not tied to VDD/VCC:
;       NWwoMPV = NOT NET (NW NOT INTERACT DSTR) ?VDD? ?VCC?
;       RESULT1 = INT NWwoMPV < 2.1
;     An untied well therefore cannot be a thin strip.
;
; Well geometry from .validate/solve-nwell.py.
let(( cv src out )

  cv  = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos12" "layout" "maskLayout" "a")
  src = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos9"  "layout" "maskLayout" "r")

  foreach( s cv~>shapes dbDeleteObject(s) )

  ; ---- copy the proven device + tap from dsh_nmos9 -------------------------
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

  ; ---- N-well + N+ pickup (solve-nwell.py) --------------------------------
  let(( wel )
    wel = list(
      ; <rv> x <rv>: NW_3 needs both dimensions at <rv> because the well is not
      ; tied to the most positive supply.
      list("NW" 0.30 2.60 2.40 4.70)
      ; the pickup: AA inside the well, SN grown <rv> past it (SN_9)
      list("AA" 0.54 2.84 2.16 4.46)
      list("SN" 0.36 2.66 2.34 4.64)
      ; contact and metal; metal sized from M1_6's area rule, not from a guess
      list("CT" 1.24 3.54 1.46 3.76)
      list("M1" 1.10 3.40 1.60 3.90)
    )
    foreach( r wel
      dbCreateRect( cv list( car(r) "drawing" )
        list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cddddr(r)) ) ) ) ) )

  out = sprintf(nil "shapes=%d bbox=%L\n" length(cv~>shapes) cv~>bBox)
  out = strcat(out sprintf(nil "SAVE %L\n" errset(dbSave(cv))))
  out)