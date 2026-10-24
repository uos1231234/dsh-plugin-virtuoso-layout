; PROBE, EXPECTED TO SUCCEED — and that is the point.
;
; A stray extra closing paren is TOLERATED by the guest-side reader: this file
; returns ok:true, output:"nil" instead of a load error. So "unbalanced parens"
; is NOT a reliable way to force a failure; use `bad-function.il` (undefined
; function) instead. Kept as the regression probe for that tolerance.
(progn
  (println "probe: expected to succeed despite the stray paren below")
))
