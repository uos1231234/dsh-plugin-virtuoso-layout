; Run the real draw body but WITHOUT errset, so the actual error message is
; reported instead of being swallowed into a load error with no location.
; The errset in the main script converted the fault into "load ... at line 166",
; which names the end of the wrapper. Removing it makes the reader print the
; failing expression itself.
;
; Everything here is the same arithmetic as draw-nmos4.il; if this succeeds the
; difference is the errset wrapper, and the main script gets fixed by keeping the
; body plain and using errset only around the whole thing at call time.

let(( cv XC4 MIR4 )
  let(( lib out )
    XC4 = 1.60
    MIR4 = lambda( (x) 2 * XC4 - x )

    let(( L CT AA_ENC GP_ENC CT_AA M1_SP M1_AR SN_OV SN_G GP_AA
           AAx0 AAx1 AAy0 AAy1 Gx0 Gx1 Gy0 Gy1
           GCx0 GCx1 GCy0 GCy1 CTxL0 CTxL1 CTyL0 CTyL1 CTyU0 CTyU1
           TAPy0 TAPy1 TCxL0 TCxL1 TCy0 TCy1
           M1_ENC MxL0 MxL1 My0 My1 GxM0 GxM1 TMxL0 TMxL1 TMy0 TMy1 )

      L      = 0.18
      CT     = 0.22
      AA_ENC = X
      GP_ENC = X
      CT_AA  = 0.20
      M1_SP = X
      M1_AR  = 0.20
      SN_OV = X
      SN_G = X
      GP_AA = X

      AAx0 = 0.30   AAx1 = 2.90
      AAy0 = 0.00   AAy1 = 1.40

      Gx0 = XC4 - L/2      Gx1 = XC4 + L/2
      Gy0 = AAy0 - 0.30    Gy1 = AAy1 + 0.30

      GCx0 = XC4 - CT/2 - GP_ENC
      GCx1 = XC4 + CT/2 + GP_ENC
      GCy0 = AAy1 + CT_AA + 0.02
      GCy1 = GCy0 + CT + 2*GP_ENC

      CTxL0 = AAx0 + 0.24
      CTxL1 = CTxL0 + CT
      CTyL0 = AAy0 + AA_ENC + 0.04
      CTyL1 = CTyL0 + CT
      CTyU0 = AAy1 - AA_ENC - 0.04 - CT
      CTyU1 = CTyU0 + CT

      TAPy0 = -1.10  TAPy1 = -0.60
      TCxL0 = AAx0 + 0.30
      TCxL1 = TCxL0 + CT
      TCy0  = TAPy0 + 0.14
      TCy1  = TCy0 + CT

      M1_ENC = 0.10
      MxL0 = CTxL0 - M1_ENC
      MxL1 = CTxL1 + M1_ENC
      My0  = CTyL0 - M1_ENC
      My1  = CTyU1 + M1_ENC
      GxM0 = XC4 - 0.19
      GxM1 = XC4 + 0.19
      TMxL0 = TCxL0 - M1_ENC
      TMxL1 = TCxL1 + M1_ENC
      TMy0  = TCy0 - M1_ENC
      TMy1  = TCy1 + M1_ENC

      cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos4" "layout" "maskLayout" "a")
      foreach( s cv~>shapes dbDeleteObject(s) )

      dbCreateRect(cv list("AA" "drawing") list(list(AAx0 AAy0) list(AAx1 AAy1)))
      dbCreateRect(cv list("AA" "drawing") list(list(AAx0 TAPy0) list(AAx1 TAPy1)))
      dbCreateRect(cv list("GP" "drawing") list(list(Gx0 Gy0) list(Gx1 Gy1)))
      dbCreateRect(cv list("GP" "drawing") list(list(GCx0 GCy0) list(GCx1 GCy1)))
      dbCreateRect(cv list("SN" "drawing")
        list(list(AAx0 - SN_OV  AAy0 - SN_OV) list(AAx1 + SN_OV AAy1 + SN_OV)))
      dbCreateRect(cv list("SP" "drawing")
        list(list(AAx0 - SN_OV  TAPy0 - SN_OV) list(AAx1 + SN_OV TAPy1 + SN_OV)))

      foreach( y list( list(CTyL0 CTyL1) list(CTyU0 CTyU1) )
        dbCreateRect(cv list("CT" "drawing") list(list(CTxL0 car(y)) list(CTxL1 cadr(y))))
        dbCreateRect(cv list("CT" "drawing")
          list(list(MIR4(CTxL1) car(y)) list(MIR4(CTxL0) cadr(y)))) )

      dbCreateRect(cv list("CT" "drawing")
        list(list(XC4 - CT/2  GCy0 + GP_ENC) list(XC4 + CT/2 GCy0 + GP_ENC + CT)))

      dbCreateRect(cv list("CT" "drawing") list(list(TCxL0 TCy0) list(TCxL1 TCy1)))
      dbCreateRect(cv list("CT" "drawing")
        list(list(MIR4(TCxL1) TCy0) list(MIR4(TCxL0) TCy1)))

      dbCreateRect(cv list("M1" "drawing") list(list(MxL0 My0) list(MxL1 My1)))
      dbCreateRect(cv list("M1" "drawing")
        list(list(MIR4(MxL1) My0) list(MIR4(MxL0) My1)))
      dbCreateRect(cv list("M1" "drawing") list(list(TMxL0 TMy0) list(TMxL1 TMy1)))
      dbCreateRect(cv list("M1" "drawing")
        list(list(MIR4(TMxL1) TMy0) list(MIR4(TMxL0) TMy1)))
      dbCreateRect(cv list("M1" "drawing")
        list(list(GxM0 (GCy0 - 0.02)) list(GxM1 (GCy1 + 0.10))))

      dbCreateLabel(cv list("M1" "pin")
        list((MxL0+MxL1)/2 (My0+My1)/2) "D" "centerCenter" "R0" "roman" 0.12)
      dbCreateLabel(cv list("M1" "pin")
        list((MIR4(MxL0)+MIR4(MxL1))/2 (My0+My1)/2) "S" "centerCenter" "R0" "roman" 0.12)
      dbCreateLabel(cv list("M1" "pin")
        list(XC4 (GxM0+GxM1)/2) "G" "centerCenter" "R0" "roman" 0.12)
      dbCreateLabel(cv list("M1" "pin")
        list((TMxL0+TMxL1)/2 (TMy0+TMy1)/2) "B" "centerCenter" "R0" "roman" 0.12)

      dbSave(cv)
      sprintf(nil "OK shapes=%d bbox=%L" length(cv~>shapes) cv~>bBox) ) ) )