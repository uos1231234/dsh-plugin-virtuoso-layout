/* Which libraries report a techfile? Used to pick one for a new scratch library. */
let((out libs)
  out = ""
  libs = ddGetLibList()
  foreach(lib libs
    out = strcat(out sprintf(nil "%s | tech=%L\n" lib~>name techGetTechFile(lib))))
  out)
