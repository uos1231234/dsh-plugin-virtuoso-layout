; draw-nmos7.il -- geometry solved by .validate/solve-nmos.py
;
; Constraints satisfied by construction (each checked numerically in the solver
; before these lines were printed):
;   CT_1 <rv> square | CT_6a AA enc <rv> | CT_7a GP enc <rv> | CT_10 no CT on gate
;   GP_1_2 <rv> min width | GP_7 field poly <rv> from AA | GP_11a gate ends on active
;   M1_1 <rv> | M1_2 <rv> | M1_3&4 line end <rv> | M1_6 area <rv>
;   SN_9 <rv> beyond active | SN_7_17 <rv> space to gate | SN_18&SP_18 no overlap
;
; Environment facts this depends on (both cost several rounds to find):
;   - infix arithmetic only; (- x d) is unavailable in this 6.1.7 build
;   - car(cddddr(row)) is y1; car(cdddr(row)) returns x1 again
let(( cv out ret )

  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos7" "layout" "maskLayout" "a")
  foreach( s cv~>shapes dbDeleteObject(s) )

  ret = list(
    list("AA" 0.40  0.00 2.00 1.20)
    list("AA" 0.40 -0.90 2.00 -0.50)
    list("GP" 1.11  0.00 1.29 1.20)
    list("GP" 0.99  1.30 1.41 1.72)
    list("SN" 0.22 -0.18 2.18 1.38)
    list("SP" 0.22 -0.68 2.18 -0.32)
    list("CT" 0.50  0.10 0.72 0.32)
    list("CT" 0.50  0.88 0.72 1.10)
    list("CT" 1.68  0.10 1.90 0.32)
    list("CT" 1.68  0.88 1.90 1.10)
    list("CT" 1.09  1.40 1.31 1.62)
    list("M1" 0.36 -0.04 0.80 1.24)
    list("M1" 1.60 -0.04 2.04 1.24)
    list("M1" 1.03  1.30 1.37 1.72)
  )

  foreach( r ret
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cddddr(r)) ) ) ) )

  dbCreateLabel( cv list("M1" "pin") list(0.58 0.60) "D" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.82 0.60) "S" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.20 1.51) "G" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(0.60 -0.70) "B" "centerCenter" "R0" "roman" 0.10 )

  out = sprintf(nil "DRAWN %d shapes\n" length(cv~>shapes))
  out = strcat(out sprintf(nil "SAVE  %L\n" errset(dbSave(cv))))
  out = strcat(out sprintf(nil "BBOX  %L\n" cv~>bBox))
  out)