; streamOut is not cooperating (returns nil silently for every calling form).
; Find an alternative GDS export path that this install actually supports.
; Candidates, in order of likelihood:
;   - leStreamOut / geStreamOut   : GUI-level stream out
;   - dbConvertCellView           : database-level format conversion
;   - strmout                      : the classic standalone stream-out binary
;   - xstream                      : the newer translator
let(( out cv )
  out = ""
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "r")

  foreach( n list("streamOut" "leStreamOut" "geStreamOut" "dbConvertCellView"
                  "strmout" "xstream" "dbFCreateCellView")
    out = strcat(out sprintf(nil "%-18s func=%L bound=%L\n"
      n procedurep(n) boundp(intern(n))) ) )

  ; Is the stream-out capability licensed at all? Check what the cds.log said.
  out = strcat(out sprintf(nil "\n--- does strmout exist on disk ---\n%L\n"
    errset(sh("ls -l $CDSHOME/tools/dfII/bin/strmout 2>/dev/null; ls -l $CDSHOME/bin/strmout 2>/dev/null; echo CDSHOME=$CDSHOME"))))
  out)