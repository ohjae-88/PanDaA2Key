"use client";

import { create } from "zustand";

/** 실행 중(활성) 세트 추적 + FPS 측정값 — 영속화하지 않는 런타임 상태 */
type RuntimeStore = {
  activeIds: Record<string, boolean>;
  setActive: (id: string, active: boolean) => void;
  clear: () => void;
  /** PresentMon / fps 모듈에서 측정된 현재 인게임 FPS (0 = 미측정) */
  currentFps: number;
  setCurrentFps: (fps: number) => void;
  /** 자동 딜레이 적용 이력 (최근 20건) — 검증용 */
  autoDelayLog: { at: number; fps: number; delayMs: number }[];
  pushAutoDelayLog: (fps: number, delayMs: number) => void;
};

export const useMacroRuntime = create<RuntimeStore>((set) => ({
  activeIds: {},
  setActive: (id, active) =>
    set((s) => {
      const next = { ...s.activeIds };
      if (active) next[id] = true;
      else delete next[id];
      return { activeIds: next };
    }),
  clear: () => set({ activeIds: {} }),
  currentFps: 0,
  setCurrentFps: (fps) => set({ currentFps: fps }),
  autoDelayLog: [],
  pushAutoDelayLog: (fps, delayMs) =>
    set((s) => ({
      autoDelayLog: [{ at: Date.now(), fps, delayMs }, ...s.autoDelayLog].slice(0, 20),
    })),
}));
