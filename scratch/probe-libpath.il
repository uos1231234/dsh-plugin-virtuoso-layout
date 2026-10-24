/* Where does the guest think VB_DEMO lives, and what is its techfile called?
 * errset here yields (value) or nil on error, and swallows the message, so an
 * entry that comes back nil means "that property/function is not available". */
let((lib tf out)
  lib = ddGetObj("VB_DEMO")
  tf = techGetTechFile(lib)
  out = list(
    errset(lib~>readPath t)
    errset(lib~>writePath t)
    errset(tf~>fileName t)
    errset(tf~>name t)
    errset(getd('techBindTechFile) t)
    errset(getd('techAttachTechFile) t)
    errset(getd('techOpenTechFile) t)
    errset(getd('ddCopyLib) t)
    errset(getd('ddCreateLib) t))
  sprintf(nil "%L" out))
