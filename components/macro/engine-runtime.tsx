"use client";

import { useEffect, useRef } from "react";
import { useMacroStore } from "@/lib/macro/store";
import { useMacroRuntime } from "@/lib/macro/runtime";
import { resolvePresetDelay } from "@/lib/macro/types";
import {
  pushConfig,
  setEngineRunning,
  onSetActive,
  setPhysicalInput,
  setTargetProcess,
  setMinCycle,
  setExecMode,
  setAllowDupTriggers,
  setHotkeys,
  setHotkeyToggle,
  onRunningChanged,
  onFps,
  fpsSetAuto,
  fpsEnsure,
} from "@/lib/tauri";

/**
 * 매크로 엔진 ↔ 프론트 상태 동기화 런타임 (비가시).
 * - 세트 구성 변경 시 Rust 로 푸시 (디바운스)
 * - engineOn 변경 시 엔진 On/Off
 * - 세트 활성 상태 이벤트 수신 → 런타임 스토어 반영
 */
export function MacroEngineRuntime() {
  const sets = useMacroStore((s) => s.sets);
  const engineOn = useMacroStore((s) => s.engineOn);
  const physicalInput = useMacroStore((s) => s.physicalInput);
  const targetProcess = useMacroStore((s) => s.targetProcess);
  const minCycleMs = useMacroStore((s) => s.minCycleMs);
  const hotkeyMode = useMacroStore((s) => s.hotkeyMode);
  const hotkeyOn = useMacroStore((s) => s.hotkeyOn);
  const hotkeyOff = useMacroStore((s) => s.hotkeyOff);
  const hotkeyToggle = useMacroStore((s) => s.hotkeyToggle);
  const execMode = useMacroStore((s) => s.execMode);
  const allowDuplicateTriggers = useMacroStore((s) => s.allowDuplicateTriggers);
  const delayPresets = useMacroStore((s) => s.delayPresets);
  const fpsAutoDelayEnabled = useMacroStore((s) => s.fpsAutoDelayEnabled);
  const setEngineOn = useMacroStore((s) => s.setEngineOn);
  const setActive = useMacroRuntime((s) => s.setActive);
  const clear = useMacroRuntime((s) => s.clear);
  const setCurrentFps = useMacroRuntime((s) => s.setCurrentFps);
  const currentFpsRef = useRef<number>(0);

  // 세트 활성 이벤트 구독
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    onSetActive((id, active) => setActive(id, active)).then((u) => {
      if (mounted) unlisten = u;
      else u();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [setActive]);

  // 자동 딜레이 해소 — autoDelayPresetId 설정된 세트의 standardDelayMs 를 FPS 기반으로 교체.
  // 전역 OFF 시에는 그대로 반환(세트별 표준/개별 지연으로 동작)
  function resolveAutoDelays(rawSets: typeof sets, fps: number) {
    const st = useMacroStore.getState();
    if (!st.fpsAutoDelayEnabled) return rawSets;
    const presets = st.delayPresets;
    return rawSets.map((s) => {
      if (!s.autoDelayPresetId) return s;
      const preset = presets.find((p) => p.id === s.autoDelayPresetId);
      if (!preset) return s;
      return { ...s, useStandardDelay: true, standardDelayMs: resolvePresetDelay(preset, fps) };
    });
  }

  /** 자동 딜레이 세트들의 해소 결과 시그니처 — 같으면 재푸시 생략 */
  function autoSig(resolved: typeof sets): string {
    return resolved
      .filter((s) => s.autoDelayPresetId)
      .map((s) => `${s.id}:${s.standardDelayMs}`)
      .join("|");
  }
  const lastAutoSig = useRef<string>("");

  // 구성 변경 → 푸시 (150ms 디바운스로 연속 편집 흡수)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const resolved = resolveAutoDelays(sets, currentFpsRef.current);
      lastAutoSig.current = autoSig(resolved);
      void pushConfig(resolved);
    }, 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, delayPresets, fpsAutoDelayEnabled]);

  // 자동 딜레이 사용 여부(전역 ON + 자동 세트 존재) → FPS 모니터 시작/유지 (오버레이 없이도 동작)
  const hasAutoDelay = fpsAutoDelayEnabled && sets.some((s) => s.autoDelayPresetId);
  useEffect(() => {
    void fpsSetAuto(hasAutoDelay);
  }, [hasAutoDelay]);

  // FPS 모니터 워치독 — PresentMon 비정상 종료 등으로 모니터가 죽으면 10초 주기로 재시작 보장
  useEffect(() => {
    if (!hasAutoDelay) return;
    const t = setInterval(() => void fpsEnsure(), 10_000);
    return () => clearInterval(t);
  }, [hasAutoDelay]);

  // FPS 간헐 손실 대응 — 측정이 잠시 끊겨도(0 수신) 직전 FPS 를 유지해
  // 지연시간이 일시적으로 폴백(60fps 가정)으로 튀는 것을 방지
  const FPS_HOLD_MS = 5000;
  const lastGoodFpsRef = useRef(0);
  const lastGoodAtRef = useRef(0);

  // FPS 이벤트 구독 → 적용 딜레이가 실제 바뀐 경우에만 재푸시 (250ms 마다 이벤트 수신)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    onFps((fps) => {
      if (!mounted) return;
      if (fps < 0) return; // -1 = PresentMon 미설치
      let effective = fps;
      if (fps > 0) {
        lastGoodFpsRef.current = fps;
        lastGoodAtRef.current = Date.now();
      } else if (
        lastGoodFpsRef.current > 0 &&
        Date.now() - lastGoodAtRef.current < FPS_HOLD_MS
      ) {
        // 간헐적 측정 손실 — 직전 FPS(=직전 지연시간) 일시 유지
        effective = lastGoodFpsRef.current;
      }
      currentFpsRef.current = effective;
      setCurrentFps(effective);
      const st = useMacroStore.getState();
      if (!st.fpsAutoDelayEnabled || !st.sets.some((s) => s.autoDelayPresetId)) return;
      const resolved = resolveAutoDelays(st.sets, effective);
      const sig = autoSig(resolved);
      if (sig === lastAutoSig.current) return; // 딜레이 변동 없음 — 푸시 생략
      lastAutoSig.current = sig;
      void pushConfig(resolved);
      // 검증용 기록 — 콘솔 + 런타임 로그 (대표값: 첫 자동 세트의 딜레이)
      const applied = resolved.find((s) => s.autoDelayPresetId)?.standardDelayMs ?? 0;
      useMacroRuntime.getState().pushAutoDelayLog(effective, applied);
      console.info(`[자동 딜레이] ${effective}fps → ${applied}ms 적용 (${sig})`);
    }).then((u) => {
      if (mounted) unlisten = u;
      else u();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCurrentFps]);

  // 물리 입력 모드 동기화
  useEffect(() => {
    void setPhysicalInput(physicalInput);
  }, [physicalInput]);

  // 활성 창 제한 동기화
  useEffect(() => {
    void setTargetProcess(targetProcess);
  }, [targetProcess]);

  // 최소 사이클 주기 동기화
  useEffect(() => {
    void setMinCycle(minCycleMs);
  }, [minCycleMs]);

  // 다중 실행 모드 동기화
  useEffect(() => {
    void setExecMode(execMode === "exclusive");
  }, [execMode]);

  // 트리거키 중복 허용 동기화
  useEffect(() => {
    void setAllowDupTriggers(allowDuplicateTriggers);
  }, [allowDuplicateTriggers]);

  // 단축키 동기화 — 모드에 따라 개별(ON/OFF) 또는 통합 토글 키만 활성화
  useEffect(() => {
    if (hotkeyMode === "separate") {
      void setHotkeys(hotkeyOn, hotkeyOff);
      void setHotkeyToggle("");
    } else {
      void setHotkeys("", "");
      void setHotkeyToggle(hotkeyToggle);
    }
  }, [hotkeyMode, hotkeyOn, hotkeyOff, hotkeyToggle]);

  // 단축키로 엔진 토글된 경우 UI 상태 반영
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    onRunningChanged((on) => setEngineOn(on)).then((u) => {
      if (mounted) unlisten = u;
      else u();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [setEngineOn]);

  // engineOn 동기화
  useEffect(() => {
    // 엔진을 켜기 직전 최신 구성을 먼저 보장
    void pushConfig(useMacroStore.getState().sets).then(() => setEngineRunning(engineOn));
    if (!engineOn) clear();
  }, [engineOn, clear]);

  return null;
}
