/* Which function removes a library from the in-memory list? Needed because the
 * probe runs left DSH_SCRATCH (bare, no techfile) plus two stray in-memory
 * libraries, and a stale same-name handle would silently shadow a good one. */
list(
  errset(getd('ddDeleteObj) t)
  errset(getd('ddDeleteLib) t)
  errset(getd('ddUnregisterLib) t)
  errset(getd('ddRemLib) t)
  errset(getd('ddGetLibList) t)
  sprintf(nil "libcount=%d" length(ddGetLibList())))
