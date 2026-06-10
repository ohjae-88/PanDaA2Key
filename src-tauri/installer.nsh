; PANDA KEY — NSIS 설치 훅
; 설치 시 Interception 커널 드라이버를 함께 설치하고, 제거 시 드라이버도 제거한다.
; perMachine(installMode) 로 설치기가 관리자 권한으로 실행되므로 /install 이 성공한다.
; install-interception.exe 는 resources 로 번들되어 $INSTDIR 에 배치된다.

!macro NSIS_HOOK_POSTINSTALL
  ; 바탕화면 바로가기 (perMachine → 모든 사용자 바탕화면)
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"

  DetailPrint "Interception 드라이버 설치 중... (물리 입력 모드)"
  ClearErrors
  ; oblitum Interception installer: /install
  ExecWait '"$INSTDIR\install-interception.exe" /install' $0
  DetailPrint "드라이버 설치기 종료 코드: $0"
  ; 드라이버 활성화에는 재부팅이 필요 — finish 페이지에 재부팅 옵션 표시
  SetRebootFlag true
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Interception 드라이버 제거 중..."
  ClearErrors
  ; oblitum Interception installer: /uninstall
  ExecWait '"$INSTDIR\install-interception.exe" /uninstall' $0
  DetailPrint "드라이버 제거기 종료 코드: $0"
  SetRebootFlag true
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 바탕화면 바로가기 제거
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend
