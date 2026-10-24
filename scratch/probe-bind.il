/* Which techfile-attachment form actually works?
 * Each variant is guarded, and errset gives (value) or nil, so a nil entry is a
 * failed variant. DSH_SCRATCH already exists bare; DSH_SCRATCH2 tests whether
 * ddCreateLib accepts a techfile *path* (the handle form already failed). */
let((lib tf out)
  lib = ddGetObj("DSH_SCRATCH")
  tf = techGetTechFile(ddGetObj("VB_DEMO"))
  out = list(
    list("bind-lib-tf"        errset(techBindTechFile(lib tf) t))
    list("bind-lib-path"      errset(techBindTechFile(lib "<GUEST_HOME>/VB_DEMO/tech.db") t))
    list("bind-name-tf"       errset(techBindTechFile("DSH_SCRATCH" tf) t))
    list("bind-lib-tf-nil"    errset(techBindTechFile(lib tf nil) t))
    list("createlib-path"     errset(ddCreateLib("DSH_SCRATCH2" "<GUEST_HOME>/VB_DEMO/tech.db") t))
    list("createlib-tfname"   errset(ddCreateLib("DSH_SCRATCH3" "tech.db") t)))
  sprintf(nil "%L" out))
