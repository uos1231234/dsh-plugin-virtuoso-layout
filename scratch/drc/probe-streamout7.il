; Give streamOut everything it could plausibly need, and report each step so a
; silent nil becomes a located failure.
;
; What the earlier attempts established (so this is not a repeat):
;   - the cellview opens, the tech is bound ("smic18ee")
;   - /tmp/drc exists and is writable
;   - every streamOut calling form returned nil WITHOUT logging anything
;   - procedurep/getd are useless as probes on compiled functions here
;
; What has NOT been tried: a fresh library list, an explicit map file together
; with a ?libName, and writing to the library directory instead of /tmp.
let(( cv out r )
  out = ""

  out = strcat(out sprintf(nil "guarded ddUpdateLibList %L\n" errset(ddUpdateLibList())))
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "r")
  out = strcat(out sprintf(nil "cv                        %L\n" cv))
  out = strcat(out sprintf(nil "techOfLib                 %L\n"
    errset(techGetTechLibName(ddGetObj("DSH_NMOS")))) )

  ; the map file the PDK ships, resolved to an absolute path
  out = strcat(out sprintf(nil "mapfile readable          %L\n"
    errset(sh("test -r <PDK_ROOT>/stream/strmoutMap && echo YES")) ) )

  ; write into the library root, which is definitely writable by this user
  r = errset( streamOut( cv "<GUEST_HOME>/DSH_NMOS/dsh_nmos2.gds"
                         ?mapFile "<PDK_ROOT>/stream/strmoutMap" ) )
  out = strcat(out sprintf(nil "streamOut -> lib dir      %L\n" r))

  ; did a file appear?
  out = strcat(out sprintf(nil "listing                   %L\n"
    errset(sh("ls -l <GUEST_HOME>/DSH_NMOS/*.gds 2>&1")) ) )
  out)