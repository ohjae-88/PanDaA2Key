"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Cpu, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isTauri, physicalAvailable, installDriver } from "@/lib/tauri";
import { showToast } from "@/lib/utils";

const SETUP_KEY = "panda-key-setup-v1";

type Phase =
  /** 확인 중 (드라이버 활성 여부) — 화면 표시 전 */
  | "checking"
  /** 셋업 화면: 드라이버 설치 진행 중 */
  | "installing"
  /** 설치 완료, 재부팅 필요 */
  | "reboot"
  /** 설치 실패 */
  | "failed"
  /** 셋업 불필요/완료 — 렌더 없음 */
  | "done";

/**
 * 첫 실행 셋업 게이트 — 포터블/설치본 공통.
 *
 * 흐름:
 * 1. 이미 셋업 완료 표시(localStorage) 또는 드라이버 활성 → 아무것도 안 함
 * 2. 첫 실행 + 드라이버 비활성 → 로딩 화면에서 드라이버 자동 설치
 * 3. 설치 후 즉시 활성(이미 설치돼 있던 경우 등) → 재부팅 안내 없이 완료
 * 4. 비활성(일반적) → 재부팅 안내. "나중에"를 눌러도 앱은 SendInput 폴백으로 동작
 */
export function FirstRunSetup() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [failMsg, setFailMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!isTauri()) {
      setPhase("done");
      return;
    }
    void (async () => {
      // 이미 셋업을 마쳤거나(재부팅 대기 포함) 드라이버가 활성인 경우 — 통과
      if (localStorage.getItem(SETUP_KEY)) {
        setPhase("done");
        return;
      }
      if (await physicalAvailable()) {
        localStorage.setItem(SETUP_KEY, "done");
        setPhase("done");
        return;
      }
      // 첫 실행 + 드라이버 비활성 → 자동 설치 진행
      setPhase("installing");
      const msg = await installDriver();
      const ok = msg.startsWith("설치기가");
      if (!ok) {
        setFailMsg(msg);
        setPhase("failed");
        return;
      }
      // 설치기 실행 완료 — 드라이버가 곧바로 활성화됐는지 확인 (이미 설치된 경우 등)
      const active = await physicalAvailable();
      localStorage.setItem(SETUP_KEY, "done");
      if (active) {
        showToast("드라이버 설치 완료 — 물리 입력 모드 사용 가능");
        setPhase("done");
      } else {
        // 일반적인 경로: 커널 드라이버는 재부팅 후 활성화
        setPhase("reboot");
      }
    })();
  }, []);

  if (phase === "checking" || phase === "done") return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-5 rounded-xl border bg-card p-8 text-center shadow-lg">
        <div className="flex items-center justify-center gap-2 text-lg font-extrabold">
          <span>⌨</span> PANDA KEY 초기 설정
        </div>

        {phase === "installing" && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-[hsl(var(--cat-macro))]" />
            <div className="space-y-1">
              <p className="text-sm font-bold">물리 입력 드라이버 설치 중…</p>
              <p className="text-xs text-muted-foreground">
                Interception 드라이버를 설치하고 있습니다. 잠시만 기다려 주세요.
              </p>
            </div>
          </>
        )}

        {phase === "reboot" && (
          <>
            <RotateCcw className="mx-auto h-10 w-10 text-amber-400" />
            <div className="space-y-1">
              <p className="text-sm font-bold">설치 완료 — 재부팅이 필요합니다</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                물리 입력 모드(게임이 실제 키보드로 인식)는 <strong className="text-foreground">재부팅 후</strong>부터 사용할 수 있습니다.
                재부팅 전에도 기본 입력 모드로 모든 기능을 사용할 수 있습니다.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => setPhase("done")}>
                나중에 재부팅 — 지금 시작하기
              </Button>
            </div>
          </>
        )}

        {phase === "failed" && (
          <>
            <Cpu className="mx-auto h-10 w-10 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-bold">드라이버 설치 실패</p>
              <p className="text-xs text-muted-foreground">{failMsg}</p>
              <p className="text-xs text-muted-foreground">
                기본 입력 모드로 계속 사용할 수 있으며, 설정에서 다시 설치할 수 있습니다.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  localStorage.setItem(SETUP_KEY, "skipped");
                  setPhase("done");
                }}
              >
                계속 진행
              </Button>
            </div>
          </>
        )}

        {phase !== "failed" && phase !== "reboot" && (
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" /> 최초 1회만 진행됩니다
          </p>
        )}
      </div>
    </div>
  );
}
