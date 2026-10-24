; Deliberately broken SKILL fixture: an undefined function, so the program is
; syntactically fine but fails at evaluation time (skill classifier, not skill-load).
(progn
  (dshProbeFunctionThatDoesNotExist 1))
