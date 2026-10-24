; draw-nmos6.il -- the SOLVED geometry, drawn without modification.
;
; Every coordinate below is output of .validate/solve-nmos.py, which checks each
; against a rule id from the foundry deck before printing. The value of doing it
; this way, after five hand-tuned attempts (22, 24, 35, 36, 36 violations):
; tuning one edge breaks a different rule, and only a constraint list notices.
;
; Two environment facts this file depends on, both learned the hard way:
;   1. prefix arithmetic (- x d) / (+ x d) is NOT available in this Virtuoso
;      6.1.7 build. Infix (x - d) works. Using the prefix form produced a
;      location-less "load ... at line N" error that cost several rounds.
;   2. strmout, not SKILL's streamOut, is what produces a GDS whose top cell is
;      actually the one requested. XStream's xstSetField("topCell" ...) silently
;      exports the whole library instead.
;
; Tap contacts and tap metal are deliberately NOT drawn: solve them with the same
; constraint script once the device itself is DRC-clean, rather than mixing more
; untested geometry into the same step.

let(( cv out ret )

  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos6" "layout" "maskLayout" "a")
  foreach( s cv~>shapes dbDeleteObject(s) )

  ; ---- solved geometry (see solve-nmos.py for the constraint behind each) ---
  ret = list(
    list("AA" 0.47  0.00 1.93 1.20)      ; active, W = 1.20 (matches LVS)
    list("AA" 0.47 -0.90 1.93 -0.50)     ; p-tap active
    list("GP" <rv>  <rv> <rv> <rv>)      ; gate: ends exactly on active (GP_11a)
    list("GP" <rv>  <rv> <rv> <rv>)      ; gate pad, <rv> above active (GP_7)
    list("SN" <rv> -0.18 <rv> <rv>)      ; SN_9 = X beyond active
    list("SP" <rv> -0.68 <rv> -0.32)     ; clear of SN (SN_18&SP_18)
    list("CT" <rv>  <rv> <rv> <rv>)      ; diffusion contacts, <rv> sq (CT_1)
    list("CT" 0.57  0.88 0.79 1.10)
    list("CT" 1.61  0.10 1.83 0.32)
    list("CT" 1.61  0.88 1.83 1.10)
    list("CT" <rv>  <rv> <rv> <rv>)      ; gate contact on the pad (CT_10/CT_7a)
    list("M1" 0.43 -0.04 0.87 1.24)      ; diffusion metal, line-end on gate side
    list("M1" 1.53 -0.04 1.97 1.24)
    list("M1" 0.99  1.30 1.41 1.72)      ; gate metal, above the diffusion metal
  )

  ; Rectangle from a 5-element row (name x0 y0 x1 y1).
  ; The accessor matters: car(cdddr(r)) returns the 4th element (x1) AGAIN, not
  ; the 5th, so writing it as the y1 made every rectangle y1 == x1 -- AA came out
  ; (0.47 0.00)-(1.93 1.93) instead of (1.93 1.20), and the resulting cell had a
  ; bbox taller than anything intended. car(cddddr(r)) is the y1.
  foreach( r ret
    dbCreateRect( cv list( car(r) "drawing" )
      list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cddddr(r)) ) ) ) )

  ; labels for LVS, centred in their metal
  dbCreateLabel( cv list("M1" "pin") list(0.65 0.60) "D" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.75 0.60) "S" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(1.20 1.51) "G" "centerCenter" "R0" "roman" 0.10 )
  dbCreateLabel( cv list("M1" "pin") list(0.70 -0.70) "B" "centerCenter" "R0" "roman" 0.10 )

  out = sprintf(nil "DRAWN %d shapes\n" length(cv~>shapes))
  out = strcat(out sprintf(nil "SAVE  %L\n" errset(dbSave(cv))))
  out = strcat(out sprintf(nil "BBOX  %L\n" cv~>bBox))
  out)