; Verify the list-access fix before rewriting the draw script.
;
; The bug: `list( list( cadr(r) caddr(r) ) list( cadddr(r) car(cdddr(r)) ) )`
;           x0 = cadr        y0 = caddr        x1 = cadddr    y1 = car(cdddr)  <-- WRONG
; car(cdddr(r)) returns the 4th element again (x1), not the 5th (y1), so every
; rectangle came out with y1 == x1. That is exactly what the shape dump showed:
; AA (0.47 0.00)-(1.93 1.93) instead of (1.93 1.20).
;
; Correct accessors for a 5-element list (name x0 y0 x1 y1):
;   car      -> name
;   cadr     -> x0
;   caddr    -> y0
;   cadddr   -> x1
;   car(cddddr(r)) -> y1
let(( r )
  r = list("AA" 0.47 0.00 1.93 1.20)
  sprintf(nil "r=%L\n  name=%L x0=%L y0=%L x1=%L  car(cdddr)=%L  car(cddddr)=%L"
    r car(r) cadr(r) caddr(r) cadddr(r) car(cdddr(r)) car(cddddr(r))))