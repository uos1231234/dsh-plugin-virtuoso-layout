; draw-nmos2.il -- a parametrically symmetric NMOS, SMIC 0.18 (smic18ee)
;
; Why a second cell instead of editing dsh_nmos: the first cell's asymmetry is
; evidence, and it should stay readable. dsh_nmos2 exists to prove that the
; fix is parametric -- every mirrored edge below is COMPUTED from the axis, so
; the two halves cannot drift apart the way hand-typed coordinates did.
;
; The rule that guarantees it: nothing is written twice. A left-hand feature is
; defined once, and its partner is emitted by MIR() from the same numbers.
;
; Library: DSH_NMOS   Cell: dsh_nmos2   Tech: smic18ee
; Result must satisfy .validate/layout-audit.py with zero failures.

procedure( MIR(x) 2 * XC - x )

let(( lib cv XC W L yTop yBot out res )

  ; ---- parameters -----------------------------------------------------------
  XC   = 1.2      ; symmetry axis: the gate centre. Everything hangs off this.
  L    = 0.18     ; drawn gate length
  CX   = 0.22     ; contact size (square)
  ENC  = 0.08     ; metal enclosure of a contact, per side
  IMP  = 0.10     ; implant overlap of active, per side

  ; device body (upper bar) and p-tap (lower bar)
  AAx0 = 0.30  AAx1 = 2.10
  AAy0 = 0.00  AAy1 = 1.20
  TAPy0 = -0.90 TAPy1 = -0.50

  ; gate
  Gx0 = XC - L/2  Gx1 = XC + L/2
  Gy0 = -0.30     Gy1 = 1.68
  ; gate pad (where the gate contact lands), centred on the axis
  PADx0 = XC - 0.17 PADx1 = XC + 0.17
  PADy0 = 1.20      PADy1 = 1.68

  ; diffusion contacts: ONE column defined, the other mirrored.
  ; These MUST land on the 10 nm manufacturing grid, so the column is chosen as
  ; a round 0.01-multiple rather than as the exact centre of the gap (the exact
  ; centre is 0.705, which is 5 nm off grid and would be a DRC grid violation).
  CTxL0 = 0.60    CTxL1 = 0.82           ; left column, on grid, in the AA-to-gate gap
  CTyA0 = 0.19    CTyA1 = 0.41           ; lower row
  CTyB0 = 0.79    CTyB1 = 1.01           ; upper row

  ; tap contacts: same idea
  TAPxL0 = 0.64   TAPxL1 = 0.86
  TAPy0c = -0.81  TAPy1c = -0.59

  ; metal
  MxL0 = 0.50  MxL1 = 0.90  My0 = 0.10  My1 = 1.10     ; diffusion metal
  TMxL0 = 0.54 TMxL1 = 0.96 TMy0 = -0.88 TMy1 = -0.52  ; tap metal
  GxM0 = XC-0.19 GxM1 = XC+0.19 GyM0 = 1.24 GyM1 = 1.62 ; gate metal

  out = ""
  res = errset(
    let(()

      ; ---- library + tech --------------------------------------------------
      unless( ddGetObj("DSH_NMOS")
        ddCreateLib("DSH_NMOS" "<GUEST_HOME>/DSH_NMOS") )
      lib = ddGetObj("DSH_NMOS")
      out = strcat(out sprintf(nil "LIB      %L\n" lib))
      out = strcat(out sprintf(nil "TECHBIND %L\n" errset(techBindTechFile(lib "smic18ee"))))

      cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "a")
      out = strcat(out sprintf(nil "CELLVIEW %L\n" cv))

      ; ---- active ----------------------------------------------------------
      dbCreateRect(cv list("AA" "drawing") list(list(AAx0 AAy0) list(AAx1 AAy1)))
      dbCreateRect(cv list("AA" "drawing") list(list(AAx0 TAPy0) list(AAx1 TAPy1)))

      ; ---- gate ------------------------------------------------------------
      dbCreateRect(cv list("GP" "drawing") list(list(Gx0 Gy0) list(Gx1 Gy1)))
      dbCreateRect(cv list("GP" "drawing") list(list(PADx0 PADy0) list(PADx1 PADy1)))

      ; ---- implants, grown from the active by IMP on every side ------------
      dbCreateRect(cv list("SN" "drawing")
        list(list(AAx0 - IMP  AAy0 - IMP) list(AAx1 + IMP AAy1 + IMP)))
      dbCreateRect(cv list("SP" "drawing")
        list(list(AAx0 - IMP  TAPy0 - IMP) list(AAx1 + IMP TAPy1 + IMP)))

      ; ---- diffusion contacts: left written once, right mirrored -----------
      foreach( y list( list(CTyA0 CTyA1) list(CTyB0 CTyB1) )
        ; left column
        dbCreateRect(cv list("CT" "drawing")
          list(list(CTxL0 car(y)) list(CTxL1 cadr(y))))
        ; right column -- computed from the same numbers
        dbCreateRect(cv list("CT" "drawing")
          list(list(MIR(CTxL1) car(y)) list(MIR(CTxL0) cadr(y)))) )

      ; ---- gate contact, on the axis ---------------------------------------
      dbCreateRect(cv list("CT" "drawing")
        list(list(XC - CX/2 1.33) list(XC + CX/2 1.55)))

      ; ---- tap contacts: left written once, right mirrored -----------------
      dbCreateRect(cv list("CT" "drawing") list(list(TAPxL0 TAPy0c) list(TAPxL1 TAPy1c)))
      dbCreateRect(cv list("CT" "drawing") list(list(MIR(TAPxL1) TAPy0c) list(MIR(TAPxL0) TAPy1c)))

      ; ---- metal over the diffusion contacts -------------------------------
      dbCreateRect(cv list("M1" "drawing") list(list(MxL0 My0) list(MxL1 My1)))
      dbCreateRect(cv list("M1" "drawing") list(list(MIR(MxL1) My0) list(MIR(MxL0) My1)))
      ; ---- tap metal -------------------------------------------------------
      dbCreateRect(cv list("M1" "drawing") list(list(TMxL0 TMy0) list(TMxL1 TMy1)))
      dbCreateRect(cv list("M1" "drawing") list(list(MIR(TMxL1) TMy0) list(MIR(TMxL0) TMy1)))
      ; ---- gate metal, on the axis -----------------------------------------
      dbCreateRect(cv list("M1" "drawing") list(list(GxM0 GyM0) list(GxM1 GyM1)))

      out = strcat(out sprintf(nil "DRAWN    %d shapes\n" length(cv~>shapes)))
      out = strcat(out sprintf(nil "SAVE     %L\n" errset(dbSave(cv))))
      out = strcat(out sprintf(nil "BBOX     %L\n" cv~>bBox))
      out = strcat(out sprintf(nil "AXIS     x=%.3f  (every mirrored edge derived from it)\n" XC))
    )
  )
  if( res == nil
    out = strcat(out sprintf(nil "ERROR    %L\n" errset.errset)) )
  out
)