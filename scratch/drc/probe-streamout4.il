; Simplest possible: which of these symbols are already a function?
let(( out )
  out = ""
  foreach( n '("streamOut" "leStreamOut" "geStreamOut" "dbConvertCellView"
               "strmout" "xstream" "geOpen" "dbCreateRect")
    out = strcat(out sprintf(nil "%-18s %L\n" n procedurep(n)) ) )
  out)