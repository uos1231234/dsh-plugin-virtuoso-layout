; Test: a 4-element list whose 2nd and 3rd entries are subtractions, and the
; 4th is reached with car(cdddr(...)). This is the exact access pattern the
; rectangle table uses.
sprintf(nil "row -> %L ; elem4 -> %L"
  errset(list("SN" (- 0.30 0.18) (- 0.00 0.18) (+ 2.10 0.18) (+ 1.20 0.18)))
  errset(car(cdddr(list("SN" (- 0.30 0.18) (- 0.00 0.18) (+ 2.10 0.18) (+ 1.20 0.18))))))