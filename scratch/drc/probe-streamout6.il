; streamOut returned nil because the cellview's tech has no default GDS layer
; map loaded in this session. The PDK ships one:
;   <PDK_ROOT>/stream/strmoutMap
; Pass it explicitly with ?mapFile, and compare against the .layermap the library
; also carries, so a wrong-but-plausible map cannot silently produce a GDS whose
; layers mean something else.
let(( cv out r1 r2 )
  out = ""
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "r")

  r1 = errset( streamOut( cv "/tmp/drc/m1.gds" ?mapFile "<PDK_ROOT>/stream/strmoutMap" ) )
  out = strcat(out sprintf(nil "with strmoutMap %L\n" r1))

  r2 = errset( streamOut( cv "/tmp/drc/m2.gds" ?mapFile "<PDK_ROOT>/smic18ee/smic18ee.layermap" ) )
  out = strcat(out sprintf(nil "with .layermap   %L\n" r2))

  out = strcat(out sprintf(nil "ls %L\n" errset(sh("ls -l /tmp/drc"))))
  out)