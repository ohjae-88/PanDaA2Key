"use client";

/**
 * Tauri 환경 감지 + 안전한 invoke 래퍼.
 * 브라우저(next dev 단독) 환경에서는 noop 폴백 — UI 는 동일하게 동작하되 실제 입력 주입만 비활성.
 */

import type { MacroSet, MacroSetPayload, OverlayConfig } from "./macro/types";

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).__TAURI_INTERNALS__ ?? (window as any).__TAURI__);
}

async function getInvoke() {
  if (!isTauri()) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    return mod.invoke;
  } catch {
    return null;
  }
}

async function getEvent() {
  if (!isTauri()) return null;
  try {
    return await import("@tauri-apps/api/event");
  } catch {
    return null;
  }
}

// ── 기본 윈도우 커맨드 ───────────────────────────────────────────

export async function getAppVersion(): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) return `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"} (browser)`;
  return invoke<string>("app_version");
}

export async function setAlwaysOnTop(on: boolean): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("set_always_on_top", { on });
}

export async function exitApp(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("exit_app");
}

/** 메인 윈도우 숨김(트레이로 최소화) */
export async function hideMainWindow(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("hide_main_window");
}

/** 메인 창 X 클릭 요청 구독 (종료/트레이/취소 선택 다이얼로그용) */
export async function onMainCloseRequested(cb: () => void): Promise<() => void> {
  const ev = await getEvent();
  if (!ev) return () => {};
  return ev.listen("main-close-requested", () => cb());
}

// ── 매크로 엔진 커맨드 ───────────────────────────────────────────

/** UI 세트 → Rust 페이로드 (step.id 제거) */
function toPayload(sets: MacroSet[]): MacroSetPayload[] {
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    trigger: s.trigger,
    mode: s.mode,
    passThrough: s.passThrough,
    enabled: s.enabled,
    steps: s.steps.map((st) => ({
      input: st.input,
      action: st.action,
      holdMs: Math.max(0, Math.floor(st.holdMs) || 0),
      // 표준 지연 사용 시 모든 지연 카드를 표준값으로 일괄 적용
      delayMs:
        st.action === "delay" && s.useStandardDelay
          ? Math.max(0, Math.floor(s.standardDelayMs) || 0)
          : Math.max(0, Math.floor(st.delayMs) || 0),
    })),
  }));
}

/** 현재 세트 구성 푸시 — 트리거가 비었거나 스텝이 없는 세트는 제외 */
export async function pushConfig(sets: MacroSet[]): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  const usable = sets.filter((s) => s.trigger && s.steps.some((st) => st.input));
  await invoke("macro_set_config", { sets: toPayload(usable) });
}

export async function setEngineRunning(on: boolean): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_set_running", { on });
}

export async function panicStop(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_panic_stop");
}

/** 물리 입력(Interception 드라이버) 모드 ON/OFF */
export async function setPhysicalInput(on: boolean): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_set_physical", { on });
}

/** Interception 드라이버 사용 가능 여부 */
export async function physicalAvailable(): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke) return false;
  try {
    return await invoke<boolean>("macro_physical_available");
  } catch {
    return false;
  }
}

/** 활성 창 제한 (빈 문자열이면 제한 없음) */
export async function setTargetProcess(name: string): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_set_target", { name });
}

/** 실행 중인 창 프로세스명 목록 (타이틀 있는 visible 창, 알파벳 정렬) */
export async function listWindows(): Promise<string[]> {
  const invoke = await getInvoke();
  if (!invoke) return [];
  try {
    return await invoke<string[]>("macro_list_windows");
  } catch {
    return [];
  }
}

/** 현재 포그라운드 창 프로세스명 */
export async function getForegroundProcess(): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return (await invoke<string | null>("macro_foreground_process")) ?? null;
  } catch {
    return null;
  }
}

/** 반복 모드 최소 사이클 주기(ms) */
export async function setMinCycle(ms: number): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_set_min_cycle", { ms: Math.max(1, Math.floor(ms) || 1) });
}

/** 다중 실행 모드 (exclusive=배타/일시정지·재개, false=동시) */
export async function setExecMode(exclusive: boolean): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_set_exec_mode", { exclusive });
}

/** 전체 ON/OFF 단축키 (키 식별자, 빈 문자열이면 해제) */
export async function setHotkeys(on: string, off: string): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_set_hotkeys", { on: on || null, off: off || null });
}

/** 트리거키 중복 허용 — ON 시 같은 트리거에 여러 매크로 동시 실행 */
export async function setAllowDupTriggers(on: boolean): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_set_allow_dup_triggers", { on });
}

/** 통합 토글 단축키 (키 식별자, 빈 문자열이면 해제) */
export async function setHotkeyToggle(toggle: string): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_set_hotkey_toggle", { toggle: toggle || null });
}

/** 엔진 실행 여부 조회 (오버레이 초기 상태용) */
export async function isEngineRunning(): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke) return false;
  try {
    return await invoke<boolean>("macro_is_running");
  } catch {
    return false;
  }
}

// ── 오버레이 윈도우 ──────────────────────────────────────────────

/** 오버레이 토글 — 반환=열림 여부 */
export async function toggleOverlay(): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke) return false;
  return invoke<boolean>("toggle_overlay");
}

export async function openOverlay(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("open_overlay");
}

export async function closeOverlay(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("close_overlay");
}

export async function isOverlayOpen(): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke) return false;
  try {
    return await invoke<boolean>("is_overlay_open");
  } catch {
    return false;
  }
}

/** 오버레이 클릭 통과 (true=마우스를 아래 게임으로 통과) */
export async function setOverlayPassthrough(ignore: boolean): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("set_overlay_passthrough", { ignore });
}

/** PresentMon(FPS 실측) 사용 가능 여부 */
export async function fpsAvailable(): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke) return false;
  try {
    return await invoke<boolean>("fps_available");
  } catch {
    return false;
  }
}

/** FPS 모니터 보장 — 필요 상태인데 죽어 있으면 재시작 (워치독용, 동작 중이면 no-op) */
export async function fpsEnsure(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  try {
    await invoke("fps_ensure");
  } catch {
    // 구버전 백엔드 호환
  }
}

/** FPS 자동 딜레이 사용 여부 — ON 시 오버레이 없이도 FPS 모니터 시작/유지 */
export async function fpsSetAuto(on: boolean): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  try {
    await invoke("fps_set_auto", { on });
  } catch {
    // 구버전 백엔드 호환 — 커맨드 없으면 무시
  }
}

export async function startKeyCapture(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_start_capture");
}

export async function cancelKeyCapture(): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke("macro_cancel_capture");
}

// ── 이벤트 구독 ─────────────────────────────────────────────────

type Unlisten = () => void;

/** 키 캡처 결과(다음 입력 1건) 구독. 반환된 함수로 해제. */
export async function onKeyCaptured(cb: (code: string) => void): Promise<Unlisten> {
  const ev = await getEvent();
  if (!ev) return () => {};
  return ev.listen<string>("macro-key-captured", (e) => cb(e.payload));
}

/** 엔진 ON/OFF 변화 구독 (단축키로 토글된 경우 UI 동기화) */
export async function onRunningChanged(cb: (on: boolean) => void): Promise<Unlisten> {
  const ev = await getEvent();
  if (!ev) return () => {};
  return ev.listen<boolean>("macro-running-changed", (e) => cb(e.payload));
}

/** 오버레이 열림/닫힘 상태 변화 구독 */
export async function onOverlayStateChanged(cb: (open: boolean) => void): Promise<Unlisten> {
  const ev = await getEvent();
  if (!ev) return () => {};
  return ev.listen<boolean>("overlay-state-changed", (e) => cb(!!e.payload));
}

/** 인게임 FPS 구독 (PresentMon 실측, -1=미설치) */
export async function onFps(cb: (fps: number) => void): Promise<Unlisten> {
  const ev = await getEvent();
  if (!ev) return () => {};
  return ev.listen<number>("overlay-fps", (e) => cb(e.payload));
}

/** 오버레이 시각 설정 브로드캐스트 (메인 → 오버레이) */
export async function emitOverlayConfig(cfg: OverlayConfig): Promise<void> {
  const ev = await getEvent();
  if (!ev) return;
  await ev.emit("overlay-config", cfg);
}

/** 오버레이 시각 설정 구독 (오버레이 창) */
export async function onOverlayConfig(cb: (cfg: OverlayConfig) => void): Promise<Unlisten> {
  const ev = await getEvent();
  if (!ev) return () => {};
  return ev.listen<OverlayConfig>("overlay-config", (e) => cb(e.payload));
}

/** 세트 활성/비활성 상태 변화 구독 */
export async function onSetActive(
  cb: (id: string, active: boolean) => void
): Promise<Unlisten> {
  const ev = await getEvent();
  if (!ev) return () => {};
  return ev.listen<{ id: string; active: boolean }>("macro-set-active", (e) =>
    cb(e.payload.id, e.payload.active)
  );
}

/** Interception 드라이버 설치 (UAC 실행). 반환: 성공 안내 or 오류 문자열 */
export async function installDriver(): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) return "브라우저 모드에서는 사용할 수 없습니다.";
  try {
    return await invoke<string>("install_driver");
  } catch (e) {
    return String(e);
  }
}

/** 업데이트 실패 로그 저장 — 저장된 파일 경로 반환 (실패 시 null) */
export async function saveUpdateErrorLog(content: string): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke<string>("save_update_error_log", { content });
  } catch {
    return null;
  }
}

/** Interception 드라이버 제거 (관리자 권한으로 직접 실행). 반환: 안내 or 오류 문자열 */
export async function uninstallDriver(): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) return "브라우저 모드에서는 사용할 수 없습니다.";
  try {
    return await invoke<string>("uninstall_driver");
  } catch (e) {
    return String(e);
  }
}

/** 기본 브라우저로 URL 열기 (Tauri) / window.open 폴백 (브라우저) */
export async function openUrl(url: string): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await invoke("open_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
