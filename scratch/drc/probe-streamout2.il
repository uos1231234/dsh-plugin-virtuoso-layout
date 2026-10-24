; Why did streamOut return nil? Test the preconditions one at a time.
let(( cv out r1 r2 r3 )
  out = ""
  cv = dbOpenCellViewByType("DSH_NMOS" "dsh_nmos2" "layout" "maskLayout" "r")

  ; 1) does the directory exist and is it writable?
  out = strcat(out sprintf(nil "mkdir %L\n" errset(sh("mkdir -p /tmp/drc"))))
  out = strcat(out sprintf(nil "lsdir %L\n" errset(sh("ls -ld /tmp/drc"))))

  ; 2) is the tech attached to the LIBRARY? streamOut needs a tech file to map
  ;    layers to GDS numbers. A cellview can open fine and still fail to stream
  ;    out when the library has no tech.
  out = strcat(out sprintf(nil "techOfLib %L\n" errset(techGetTechLibName(ddGetObj("DSH_NMOS")))))

  ; 3) plain call, then the documented 2-arg and 3-arg forms
  r1 = errset( streamOut(cv "/tmp/drc/a.gds") )
  out = strcat(out sprintf(nil "streamOut(2arg) %L\n" r1))
  r2 = errset( streamOut(cv "/tmp/drc/b.gds" nil) )
  out = strcat(out sprintf(nil "streamOut(3arg nil) %L\n" r2))
  r3 = errset( streamOut(cv "/tmp/drc/c.gds" ?hierDepth 32) )
  out = strcat(out sprintf(nil "streamOut(hierDepth) %L\n" r3))
  out = strcat(out sprintf(nil "ls %L\n" errset(sh("ls -l /tmp/drc"))))
  out)