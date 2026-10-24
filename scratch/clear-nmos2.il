; Reset dsh_nmos2 so the parametric draw starts from an empty cellview.
; Kept as a file rather than an inline expression because PowerShell 5.1 strips
; embedded double quotes out of native argv, which turns "DSH_NMOS" into a
; bare symbol and produces "unbound variable" instead of a useful error.
let(( cv n )
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "a")
  n = 0
  if( cv
    foreach( shape cv~>shapes
      dbDeleteObject( shape )
      n = n + 1 ) )
  sprintf(nil "cleared=%d remaining=%d" n if(cv length(cv~>shapes) -1)))
