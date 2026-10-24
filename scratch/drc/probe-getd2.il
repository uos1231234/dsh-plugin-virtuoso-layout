; getd() raises on a symbol with no definition, so wrap each call.
; This distinguishes three states that all looked like "nil" before:
;   DEFINED       getd returns a function object
;   UNDEFINED     getd raises, errset catches -> we print the flag
let(( out r )
  out = ""
  foreach( n '("geOpen" "dbCreateRect" "dbSave" "streamOut" "leStreamOut" "xstream")
    r = errset( getd( n ) )
    if( r
      then out = strcat(out sprintf(nil "%-20s DEFINED   %L\n" n car(r)))
      else out = strcat(out sprintf(nil "%-20s UNDEFINED\n" n)) ) )
  out)