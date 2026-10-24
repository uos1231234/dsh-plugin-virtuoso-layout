; Stream out via XStream WITHOUT the completion dialog.
;
; This records a real trap: xstOutDoTranslate() pops a modal "Stream out
; translation complete" dialog. That dialog is owned by the CIW evaluator, so the
; evaluator parks inside it and the whole SKILL channel goes silent --
; every later eval times out with no CDS.log trace, which looks exactly like a
; dead tunnel. The cure is not to dismiss it afterwards but to not create it:
; set showCompletionMsgBox to nil BEFORE translating.
;
; streamOutKeys documents the option: 'showCompletionMsgBox t
; The doc for xstOutDoTranslate says its value is always nil, so success can only
; be judged by the file and the log, never by the return value.

let(( out )
  out = ""

  unless( boundp('streamOutKeys )
    streamOutKeys = list(nil) )

  ; The one setting that matters for an unattended run.
  out = strcat(out sprintf(nil "no-msgbox   %L\n" errset(xstSetField("showCompletionMsgBox" "nil"))))

  out = strcat(out sprintf(nil "strmFile    %L\n" errset(xstSetField("strmFile" "/tmp/drc/nmos4.gds"))))
  out = strcat(out sprintf(nil "library     %L\n" errset(xstSetField("library" "DSH_NMOS"))))
  out = strcat(out sprintf(nil "topCell     %L\n" errset(xstSetField("topCell" "dsh_nmos4"))))
  out = strcat(out sprintf(nil "view        %L\n" errset(xstSetField("view" "layout"))))
  out = strcat(out sprintf(nil "techLib     %L\n" errset(xstSetField("techLib" "smic18ee"))))
  out = strcat(out sprintf(nil "layerMap    %L\n" errset(xstSetField("layerMap" "<PDK_ROOT>/stream/strmoutMap"))))
  out = strcat(out sprintf(nil "unmappedLPP %L\n" errset(xstSetField("translateUnmappedLPP" "t"))))
  out = strcat(out sprintf(nil "strmVersion %L\n" errset(xstSetField("strmVersion" "3"))))
  out = strcat(out sprintf(nil "logFile     %L\n" errset(xstSetField("logFile" "/tmp/drc/nmos4.log"))))

  ; issue it; expect nil, judge by the file
  out = strcat(out sprintf(nil "translate   %L\n" errset(xstOutDoTranslate())))

  ; the issuer is non-blocking, so poll rather than sleep a fixed amount
  let(( i done )
    i = 0  done = nil
    while( i < 20 && !done
      errset(sh("sleep 1"))
      when( errset(sh("test -s /tmp/drc/nmos4.gds")) done = t )
      i = i + 1 )
    out = strcat(out sprintf(nil "waited %ds, gds present=%L\n" i done)) )

  out = strcat(out sprintf(nil "size        %L\n"
    errset(sh("stat -c %s /tmp/drc/nmos4.gds")) ))
  out)