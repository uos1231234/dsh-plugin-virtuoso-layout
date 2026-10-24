; Zoom both cells to the same absolute scale so the two screenshots are directly
; comparable. hiZoomAbsolute is not available in 6.1.7 (verified earlier), so the
; window box is set with hiSetWindowBox-ish fallbacks in a guarded chain: the
; first one that exists wins, and the result is reported rather than assumed.
let((w1 w2 out)
  out = ""
  w1 = hiGetWindowFromId(24)
  w2 = hiGetWindowFromId(25)
  out = strcat(out sprintf(nil "w24=%L w25=%L\n" w1 w2))

  foreach( pair list( list(24 w1) list(25 w2) )
    let(( id win )
      id  = car(pair)
      win = cadr(pair)
      when( win
        ; 0.2..2.2 in x is the cell; give it a 3.0um wide view box centred on 1.2
        errset( hiSetViewBox(win -0.3 -1.3 2.7 1.98) )
        out = strcat(out sprintf(nil "viewbox %d -> %L\n" id win~>viewBox)) ) ) )
  out)