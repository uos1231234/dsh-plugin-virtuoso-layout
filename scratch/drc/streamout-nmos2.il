; Stream out DSH_NMOS/dsh_nmos2 to GDSII so Calibre can read it.
;
; Why this is also a correctness check: streamOut writes the layers the tech
; database actually holds. If a rectangle were on a layer the PDK does not
; define, or on the wrong purpose, the GDS would show it (or refuse), which the
; editor display cannot tell us.
let(( cv out res )
  out = ""
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "r")
  out = strcat(out sprintf(nil "cv=%L shapes=%d\n" cv length(cv~>shapes)))

  ; Make sure the output directory exists before asking Virtuoso to write.
  sh("mkdir -p /tmp/drc")
  out = strcat(out sprintf(nil "mkdir=%L\n" errset(sh("mkdir -p /tmp/drc 2>&1"))))

  res = errset( streamOut( cv "/tmp/drc/dsh_nmos2.gds" )
    ; 0  = no options; the GDS then carries the cell name as-is
  )
  out = strcat(out sprintf(nil "STREAMOUT %L\n" res))

  ; Report the layers that went out, so a missing CT or a wrong purpose is
  ; visible in this same reply rather than only in the DRC result.
  let(( seen )
    seen = ""
    foreach( s cv~>shapes
      unless( member( car(s~>lpp) seen )
        seen = cons( car(s~>lpp) seen ) ) )
    out = strcat(out sprintf(nil "LAYERS %L\n" seen)) )
  out)