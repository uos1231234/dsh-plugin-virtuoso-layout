; Minimal probe for the two constructs that are most likely culprits in
; draw-nmos5.il, since the error carries no location:
;   a) cadddr -- is it defined?  (list access beyond 3rd element)
;   b) (- AAx0 0.18) used as a list element -- subtraction at the head position
;      of a list is legal, but a NEGATIVE NUMBER printed first can be misread by
;      the reader if it follows an open paren, so test it directly.
let(( out r v )
  out = ""

  r = errset( cadddr( list( 1 2 3 4 5 ) ) )
  out = strcat(out sprintf(nil "cadddr(1 2 3 4 5)   %L\n" r))

  r = errset( car( cdddr( list( "AA" 1 2 3 4 ) ) ) )
  out = strcat(out sprintf(nil "car(cdddr(...))      %L\n" r))

  v = 0.30
  r = errset( list( "AA" (- v 0.18) (- v 0.18) 2.10 1.20 ) )
  out = strcat(out sprintf(nil "list with (- v 0.18) %L\n" r))

  ; the pattern actually used in the rect table: a 4-element list whose 2nd
  ; and 3rd entries are subtractions
  r = errset( list( "SN" (- 0.30 0.18) (- 0.00 0.18) (+ 2.10 0.18) (+ 1.20 0.18) ) )
  out = strcat(out sprintf(nil "full rect row        %L\n" r))

  ; and negative literals directly
  r = errset( list( "AA" 0.30 -0.90 2.10 -0.50 ) )
  out = strcat(out sprintf(nil "negative literals    %L\n" r))

  out)