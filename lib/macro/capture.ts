"use client";

import { isTauri, startKeyCapture, cancelKeyCapture, onKeyCaptured } from "@/lib/tauri";
import type { StepAction } from "./types";

/** DOM 마우스 버튼 번호 → 입력 식별자 */
export function domMouseToCode(button: number): string | null {
  switch (button) {
    case 0:
      return "MouseLeft";
    case 1:
      return "MouseMiddle";
    case 2:
      return "MouseRight";
    case 3:
      return "MouseX1";
    case 4:
      return "MouseX2";
    default:
      return null;
  }
}

type Cancel = () => void;

/**
 * 다음 입력 1건을 캡처해 onCode 로 전달. ESC 취소.
 * 설정 창이 포커스를 가진 상태에서 DOM(capture phase) 으로 잡는다.
 * Tauri 에서는 캡처 동안 트리거 처리를 일시 정지(startKeyCapture/cancelKeyCapture).
 */
export function captureNextInput(onCode: (code: string) => void, onCancel?: () => void): Cancel {
  let done = false;
  let nativeUn: (() => void) | null = null;

  const cleanup = () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("mousedown", onMouse, true);
    window.removeEventListener("contextmenu", onCtx, true);
    nativeUn?.();
    nativeUn = null;
    if (isTauri()) void cancelKeyCapture();
  };
  const finish = (code: string) => {
    if (done) return;
    done = true;
    cleanup();
    onCode(code);
  };
  const cancel = () => {
    if (done) return;
    done = true;
    cleanup();
    onCancel?.();
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code) finish(e.code);
  }
  function onMouse(e: MouseEvent) {
    // 캡처 트리거 UI 자신 클릭은 무시
    if ((e.target as HTMLElement)?.closest("[data-capture-ignore]")) return;
    e.preventDefault();
    e.stopPropagation();
    const code = domMouseToCode(e.button);
    if (code) finish(code);
  }
  function onCtx(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  window.addEventListener("keydown", onKey, true);
  window.addEventListener("mousedown", onMouse, true);
  window.addEventListener("contextmenu", onCtx, true);

  // 네이티브 후킹 캡처 — 마우스 사이드버튼 등 웹뷰 DOM 이 못 잡는 입력까지 전역 캡처
  if (isTauri()) {
    void startKeyCapture();
    onKeyCaptured((code) => finish(code)).then((un) => {
      if (done) un();
      else nativeUn = un;
    });
  }
  return cancel;
}

export type RecordedStep = {
  action: StepAction;
  input?: string;
  holdMs?: number;
  delayMs?: number;
};

/**
 * 입력 녹화 시작 — 실제 키/마우스 입력을 타이밍과 함께 스텝으로 변환.
 *  - keydown → 누르기(press), keyup → 때기(release)
 *  - 이벤트 사이 간격 → 지연(delay) 카드
 *  - 키 반복(auto-repeat) 은 무시, ESC 로 종료
 * onFinish(steps) 로 결과 전달. 반환 함수로 수동 종료.
 */
export type RecordOptions = {
  /** 지연 고정 — 지정 시 모든 간격을 측정 대신 이 값(ms)으로 기록 */
  fixedDelayMs?: number | null;
  /** 녹화 진행 실시간 콜백 — 입력이 추가될 때마다 현재까지의 스텝 사본 전달 */
  onProgress?: (steps: RecordedStep[]) => void;
};

export function startRecording(
  onFinish: (steps: RecordedStep[]) => void,
  options: RecordOptions = {}
): Cancel {
  const down = new Set<string>();
  const out: RecordedStep[] = [];
  let last = 0;
  let started = false;
  const fixed =
    options.fixedDelayMs != null && options.fixedDelayMs >= 0
      ? Math.floor(options.fixedDelayMs)
      : null;

  const now = () =>
    typeof performance !== "undefined" && performance.now ? performance.now() : 0;

  const gap = () => {
    const t = now();
    if (started) {
      const d = fixed != null ? fixed : Math.max(0, Math.round(t - last));
      if (d > 0) out.push({ action: "delay", delayMs: d });
    }
    started = true;
    last = t;
  };

  const emitProgress = () => options.onProgress?.(out.slice());
  const press = (code: string) => {
    if (down.has(code)) return; // auto-repeat 무시
    gap();
    down.add(code);
    out.push({ action: "press", input: code });
    emitProgress();
  };
  const release = (code: string) => {
    if (!down.has(code)) return;
    gap();
    down.delete(code);
    out.push({ action: "release", input: code });
    emitProgress();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code) press(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code) release(e.code);
  };
  const onMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.closest("[data-rec-ignore]")) return;
    const code = domMouseToCode(e.button);
    if (!code) return;
    e.preventDefault();
    e.stopPropagation();
    press(code);
  };
  const onMouseUp = (e: MouseEvent) => {
    const code = domMouseToCode(e.button);
    if (!code) return;
    e.preventDefault();
    e.stopPropagation();
    release(code);
  };
  const onCtx = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("contextmenu", onCtx, true);
    if (isTauri()) void cancelKeyCapture();
  };

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    cleanup();
    // 남아있는(안 뗀) 키는 release 추가
    for (const code of down) out.push({ action: "release", input: code });
    // 후행 지연 제거
    while (out.length && out[out.length - 1].action === "delay") out.pop();
    onFinish(out);
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("contextmenu", onCtx, true);
  if (isTauri()) void startKeyCapture();

  return finish;
}
