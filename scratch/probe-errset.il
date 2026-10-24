/* Calibrate diagnostics: does errset(x t) return the message, and does
 * ddCreateLib actually succeed? `car(1)` is a deliberate error for contrast. */
list(
  errset(1+1 t)
  errset(car(1) t)
  errset(ddCreateLib("DSH_SCRATCH" techGetTechFile(ddGetObj("VB_DEMO"))) t)
  errset(ddGetObj("DSH_SCRATCH") t))
