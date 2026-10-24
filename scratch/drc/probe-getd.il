; Definitive probe: getd() returns the function object or nil, and unlike
; procedurep() it works for compiled functions (procedurep returns nil even for
; geOpen, which definitely works). Calling with errset() is NOT a probe: an
; undefined function raises, errset catches, and you see nil -- indistinguishable
; from "exists and refused".
let(( out )
  out = ""
  foreach( n '("geOpen" "dbCreateRect" "dbSave" "streamOut" "leStreamOut"
               "xstream" "dbConvertCellView" "geStreamOut" "dbWriteStream")
    out = strcat(out sprintf(nil "%-20s getd=%L\n" n getd(n)) ) )
  out)