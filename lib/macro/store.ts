"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  DelayPreset,
  FpsRange,
  HotkeyMode,
  MacroGroup,
  MacroSet,
  MacroState,
  MacroStep,
  OverlayConfig,
  StepAction,
  TriggerMode,
} from "./types";
import { DEFAULT_DELAY_PRESET, DEFAULT_DELAY_PRESET_ID, DEFAULT_OVERLAY_CONFIG } from "./types";
import type { MacroExport } from "./io";

/**
 * localStorage 디바운스 래퍼 — 연속 편집(스텝 수정 등)마다 전체 상태를
 * 동기 직렬화·기록하는 비용을 700ms 로 묶어 1회만 기록.
 * 창 닫힘/숨김 시에는 보류분을 즉시 플러시해 유실 방지.
 */
function makeDebouncedStorage(delayMs = 700) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: string } | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      try {
        localStorage.setItem(pending.name, pending.value);
      } catch {
        // 저장 실패(quota 등) — 다음 쓰기에서 재시도
      }
      pending = null;
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  return {
    getItem: (name: string): string | null => {
      if (typeof window === "undefined") return null;
      // 쓰기 보류 중이면 최신 보류값 반환 (rehydrate 일관성)
      if (pending && pending.name === name) return pending.value;
      return localStorage.getItem(name);
    },
    setItem: (name: string, value: string): void => {
      if (typeof window === "undefined") return;
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    removeItem: (name: string): void => {
      if (typeof window === "undefined") return;
      if (pending?.name === name) pending = null;
      localStorage.removeItem(name);
    },
  };
}

let _seq = 0;
function uid(prefix: string): string {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

const clampMs = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

export function newStep(action: StepAction = "tap", input = ""): MacroStep {
  return {
    id: uid("step"),
    input: action === "delay" ? "" : input,
    action,
    holdMs: action === "tap" ? 30 : 0,
    delayMs: action === "delay" ? 50 : 0,
  };
}

export function newSet(name: string): MacroSet {
  return {
    id: uid("set"),
    name,
    trigger: "",
    mode: "whileHeld",
    passThrough: false,
    enabled: true,
    useStandardDelay: false,
    standardDelayMs: 50,
    autoDelayPresetId: null,
    // 기본: 탭 한 카드 (가장 흔한 경우)
    steps: [newStep("tap")],
  };
}

export function newGroup(name: string): MacroGroup {
  return { id: uid("grp"), name, memberIds: [] };
}

/** 동일 트리거 중복 제거 — allowDup=true 이면 비활성화 생략 */
function dedupeTrigger(sets: MacroSet[], winnerId: string, allowDup: boolean): MacroSet[] {
  if (allowDup) return sets;
  const w = sets.find((s) => s.id === winnerId);
  if (!w || !w.enabled || !w.trigger) return sets;
  return sets.map((s) =>
    s.id !== winnerId && s.enabled && s.trigger && s.trigger === w.trigger
      ? { ...s, enabled: false }
      : s
  );
}

/** 전역 중복 제거 — allowDup=true 이면 생략 */
function dedupeAll(sets: MacroSet[], allowDup: boolean): MacroSet[] {
  if (allowDup) return sets;
  const keep = new Map<string, string>();
  sets.forEach((s) => {
    if (s.enabled && s.trigger) keep.set(s.trigger, s.id);
  });
  return sets.map((s) =>
    s.enabled && s.trigger && keep.get(s.trigger) !== s.id ? { ...s, enabled: false } : s
  );
}

/** 녹화/임시 스텝({action,input?,delayMs?})을 MacroStep 으로 변환 */
export function toMacroSteps(
  raw: { action: StepAction; input?: string; holdMs?: number; delayMs?: number }[]
): MacroStep[] {
  return raw.map((r) => ({
    id: uid("step"),
    input: r.action === "delay" ? "" : r.input ?? "",
    action: r.action,
    holdMs: r.action === "tap" ? clampMs(r.holdMs) : 0,
    delayMs: r.action === "delay" ? clampMs(r.delayMs) : 0,
  }));
}

/** 구버전 스텝을 현재 스키마로 변환 — 후행 지연을 별도 delay 카드로 분리 */
function migrateStep(raw: any): MacroStep[] {
  const input = typeof raw?.input === "string" ? raw.input : "";
  if (raw && raw.action === "delay") {
    return [{ id: uid("step"), input: "", action: "delay", holdMs: 0, delayMs: clampMs(raw.delayMs) }];
  }
  if (raw && (raw.action === "tap" || raw.action === "press" || raw.action === "release")) {
    const out: MacroStep[] = [
      {
        id: typeof raw.id === "string" ? raw.id : uid("step"),
        input,
        action: raw.action,
        holdMs: raw.action === "tap" ? clampMs(raw.holdMs) : 0,
        delayMs: 0,
      },
    ];
    // 직전 버전의 후행 delayMs → 별도 지연 카드
    const trailing = clampMs(raw.delayMs);
    if (trailing > 0) {
      out.push({ id: uid("step"), input: "", action: "delay", holdMs: 0, delayMs: trailing });
    }
    return out;
  }
  // 레거시: { input, pressMs, releaseMs } → tap(holdMs=pressMs) + delay(releaseMs)
  const out: MacroStep[] = [
    { id: uid("step"), input, action: "tap", holdMs: clampMs(raw?.pressMs), delayMs: 0 },
  ];
  const rel = clampMs(raw?.releaseMs);
  if (rel > 0) out.push({ id: uid("step"), input: "", action: "delay", holdMs: 0, delayMs: rel });
  return out;
}

type Store = MacroState & {
  addSet: () => string;
  duplicateSet: (id: string) => void;
  removeSet: (id: string) => void;
  updateSet: (id: string, patch: Partial<Omit<MacroSet, "id" | "steps">>) => void;
  toggleEnabled: (id: string) => void;
  setExecMode: (mode: "concurrent" | "exclusive") => void;
  setAllowDupTriggers: (on: boolean) => void;

  // 자동 딜레이 프리셋 CRUD
  addDelayPreset: (name: string) => string;
  updateDelayPreset: (id: string, patch: { name?: string; ranges?: FpsRange[] }) => void;
  removeDelayPreset: (id: string) => void;
  setAutoDelayPreset: (setId: string, presetId: string | null) => void;
  setFpsAutoDelayEnabled: (on: boolean) => void;
  /** 메인 페이지 카드 드래그 순서 변경 — fromId 를 toId 위치로 이동 */
  reorderSets: (fromId: string, toId: string) => void;

  // 프리셋 (다대다)
  addGroup: (name?: string) => string;
  removeGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  toggleGroupMember: (groupId: string, setId: string) => void;
  setGroupMembers: (groupId: string, memberIds: string[]) => void;
  setGroupEnabled: (groupId: string, enabled: boolean) => void;
  /** 프리셋 적용 — 멤버 세트는 활성화, 나머지는 비활성화(로드아웃) */
  applyPreset: (groupId: string) => void;

  addStep: (setId: string, action?: StepAction) => string;
  insertStepAt: (setId: string, index: number, action?: StepAction) => string;
  addKeyPair: (setId: string) => void;
  duplicateStep: (setId: string, stepId: string) => void;
  setSteps: (setId: string, steps: MacroStep[]) => void;
  appendSteps: (setId: string, steps: MacroStep[]) => void;
  /** 모든 지연 카드의 시간을 일괄 적용 */
  setAllDelays: (setId: string, ms: number) => void;
  /** 모든 지연 + 탭(누르기) 시간을 일괄 적용 */
  setAllStepTimes: (setId: string, ms: number) => void;
  updateStep: (setId: string, stepId: string, patch: Partial<Omit<MacroStep, "id">>) => void;
  removeStep: (setId: string, stepId: string) => void;
  moveStep: (setId: string, stepId: string, dir: -1 | 1) => void;

  setEngineOn: (on: boolean) => void;
  setPhysicalInput: (on: boolean) => void;
  setTargetProcess: (name: string) => void;
  setMinCycleMs: (ms: number) => void;
  setHotkeyMode: (mode: HotkeyMode) => void;
  setHotkeys: (on: string, off: string) => void;
  setHotkeyToggle: (key: string) => void;
  applyImport: (payload: MacroExport, mode: "replace" | "merge") => void;

  // 오버레이
  setOverlayConfig: (patch: Partial<OverlayConfig>) => void;
  setOverlayPos: (x: number, y: number) => void;
  setOverlaySize: (w: number, h: number) => void;
};

export const useMacroStore = create<Store>()(
  persist(
    (set, get) => ({
      sets: [],
      groups: [],
      engineOn: false,
      physicalInput: false,
      targetProcess: "",
      minCycleMs: 16,
      hotkeyMode: "separate" as HotkeyMode,
      hotkeyOn: "Home",
      hotkeyOff: "End",
      hotkeyToggle: "",
      execMode: "concurrent",
      allowDuplicateTriggers: false,
      overlayConfig: DEFAULT_OVERLAY_CONFIG,
      overlayPos: null,
      overlaySize: null,
      delayPresets: [DEFAULT_DELAY_PRESET],
      fpsAutoDelayEnabled: true,

      addSet: () => {
        const s = newSet(`매크로 ${get().sets.length + 1}`);
        set((st) => ({ sets: [...st.sets, s] }));
        return s.id;
      },

      duplicateSet: (id) =>
        set((st) => {
          const src = st.sets.find((x) => x.id === id);
          if (!src) return st;
          const copy: MacroSet = {
            ...src,
            id: uid("set"),
            name: `${src.name} 복사본`,
            steps: src.steps.map((step) => ({ ...step, id: uid("step") })),
          };
          const idx = st.sets.findIndex((x) => x.id === id);
          const next = st.sets.slice();
          next.splice(idx + 1, 0, copy);
          return { sets: next };
        }),

      removeSet: (id) =>
        set((st) => ({
          sets: st.sets.filter((x) => x.id !== id),
          groups: st.groups.map((g) => ({
            ...g,
            memberIds: g.memberIds.filter((m) => m !== id),
          })),
        })),

      updateSet: (id, patch) =>
        set((st) => {
          let sets = st.sets.map((x) => (x.id === id ? { ...x, ...patch } : x));
          // 트리거/활성 변경 시 동일 트리거 중복 비활성화 (이 세트 우선)
          if (patch.trigger !== undefined || patch.enabled !== undefined) {
            sets = dedupeTrigger(sets, id, st.allowDuplicateTriggers);
          }
          return { sets };
        }),

      toggleEnabled: (id) =>
        set((st) => {
          let sets = st.sets.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x));
          sets = dedupeTrigger(sets, id, st.allowDuplicateTriggers);
          return { sets };
        }),

      setExecMode: (mode) => set({ execMode: mode }),
      setAllowDupTriggers: (on) => set({ allowDuplicateTriggers: on }),

      addDelayPreset: (name) => {
        const p: DelayPreset = {
          id: uid("dlp"),
          name: name.trim() || `프리셋 ${get().delayPresets.length}`,
          ranges: [...DEFAULT_DELAY_PRESET.ranges],
        };
        set((st) => ({ delayPresets: [...st.delayPresets, p] }));
        return p.id;
      },

      updateDelayPreset: (id, patch) =>
        set((st) => ({
          delayPresets: st.delayPresets.map((p) =>
            p.id === id && !p.builtin ? { ...p, ...patch } : p
          ),
        })),

      removeDelayPreset: (id) =>
        set((st) => ({
          delayPresets: st.delayPresets.filter((p) => p.id !== id || !!p.builtin),
          sets: st.sets.map((s) =>
            s.autoDelayPresetId === id
              ? { ...s, autoDelayPresetId: DEFAULT_DELAY_PRESET_ID }
              : s
          ),
        })),

      setAutoDelayPreset: (setId, presetId) =>
        set((st) => ({
          sets: st.sets.map((s) =>
            s.id === setId ? { ...s, autoDelayPresetId: presetId } : s
          ),
        })),

      setFpsAutoDelayEnabled: (on) => set({ fpsAutoDelayEnabled: on }),

      reorderSets: (fromId, toId) =>
        set((st) => {
          if (fromId === toId) return st;
          const from = st.sets.findIndex((s) => s.id === fromId);
          const to = st.sets.findIndex((s) => s.id === toId);
          if (from < 0 || to < 0) return st;
          const next = st.sets.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { sets: next };
        }),

      // ── 프리셋 ─────────────────────────────────────────────
      addGroup: (name) => {
        const g = newGroup(name?.trim() || `그룹 ${get().groups.length + 1}`);
        set((st) => ({ groups: [...st.groups, g] }));
        return g.id;
      },
      removeGroup: (groupId) =>
        set((st) => ({ groups: st.groups.filter((g) => g.id !== groupId) })),
      renameGroup: (groupId, name) =>
        set((st) => ({
          groups: st.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
        })),
      toggleGroupMember: (groupId, setId) =>
        set((st) => ({
          groups: st.groups.map((g) => {
            if (g.id !== groupId) return g;
            const has = g.memberIds.includes(setId);
            return {
              ...g,
              memberIds: has ? g.memberIds.filter((m) => m !== setId) : [...g.memberIds, setId],
            };
          }),
        })),
      setGroupMembers: (groupId, memberIds) =>
        set((st) => ({
          groups: st.groups.map((g) => (g.id === groupId ? { ...g, memberIds } : g)),
        })),
      setGroupEnabled: (groupId, enabled) =>
        set((st) => {
          const g = st.groups.find((x) => x.id === groupId);
          if (!g) return st;
          const ids = new Set(g.memberIds);
          let sets = st.sets.map((x) => (ids.has(x.id) ? { ...x, enabled } : x));
          if (enabled) sets = dedupeAll(sets, st.allowDuplicateTriggers);
          return { sets };
        }),
      applyPreset: (groupId) =>
        set((st) => {
          const g = st.groups.find((x) => x.id === groupId);
          if (!g) return st;
          const ids = new Set(g.memberIds);
          // 멤버는 활성화, 비멤버는 비활성화 (로드아웃 적용)
          let sets = st.sets.map((x) => ({ ...x, enabled: ids.has(x.id) }));
          sets = dedupeAll(sets, st.allowDuplicateTriggers);
          return { sets };
        }),

      addStep: (setId, action = "tap") => {
        const step = newStep(action);
        set((st) => ({
          sets: st.sets.map((x) =>
            x.id === setId ? { ...x, steps: [...x.steps, step] } : x
          ),
        }));
        return step.id;
      },

      insertStepAt: (setId, index, action = "tap") => {
        const step = newStep(action);
        set((st) => ({
          sets: st.sets.map((x) => {
            if (x.id !== setId) return x;
            const steps = x.steps.slice();
            const i = Math.max(0, Math.min(steps.length, index));
            steps.splice(i, 0, step);
            return { ...x, steps };
          }),
        }));
        return step.id;
      },

      // 누르기 + 때기 한 쌍 추가 (같은 키 지정 편의)
      addKeyPair: (setId) =>
        set((st) => ({
          sets: st.sets.map((x) =>
            x.id === setId
              ? { ...x, steps: [...x.steps, newStep("press"), newStep("release")] }
              : x
          ),
        })),

      updateStep: (setId, stepId, patch) =>
        set((st) => ({
          sets: st.sets.map((x) =>
            x.id === setId
              ? {
                  ...x,
                  steps: x.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
                }
              : x
          ),
        })),

      removeStep: (setId, stepId) =>
        set((st) => ({
          sets: st.sets.map((x) =>
            x.id === setId ? { ...x, steps: x.steps.filter((s) => s.id !== stepId) } : x
          ),
        })),

      duplicateStep: (setId, stepId) =>
        set((st) => ({
          sets: st.sets.map((x) => {
            if (x.id !== setId) return x;
            const idx = x.steps.findIndex((s) => s.id === stepId);
            if (idx < 0) return x;
            const steps = x.steps.slice();
            steps.splice(idx + 1, 0, { ...x.steps[idx], id: uid("step") });
            return { ...x, steps };
          }),
        })),

      setSteps: (setId, steps) =>
        set((st) => ({
          sets: st.sets.map((x) => (x.id === setId ? { ...x, steps } : x)),
        })),

      appendSteps: (setId, steps) =>
        set((st) => ({
          sets: st.sets.map((x) =>
            x.id === setId ? { ...x, steps: [...x.steps, ...steps] } : x
          ),
        })),

      setAllDelays: (setId, ms) =>
        set((st) => ({
          sets: st.sets.map((x) =>
            x.id === setId
              ? {
                  ...x,
                  steps: x.steps.map((s) =>
                    s.action === "delay" ? { ...s, delayMs: clampMs(ms) } : s
                  ),
                }
              : x
          ),
        })),

      setAllStepTimes: (setId, ms) =>
        set((st) => ({
          sets: st.sets.map((x) =>
            x.id === setId
              ? {
                  ...x,
                  steps: x.steps.map((s) =>
                    s.action === "delay"
                      ? { ...s, delayMs: clampMs(ms) }
                      : s.action === "tap"
                        ? { ...s, holdMs: clampMs(ms) }
                        : s
                  ),
                }
              : x
          ),
        })),

      moveStep: (setId, stepId, dir) =>
        set((st) => ({
          sets: st.sets.map((x) => {
            if (x.id !== setId) return x;
            const idx = x.steps.findIndex((s) => s.id === stepId);
            const to = idx + dir;
            if (idx < 0 || to < 0 || to >= x.steps.length) return x;
            const steps = x.steps.slice();
            const [moved] = steps.splice(idx, 1);
            steps.splice(to, 0, moved);
            return { ...x, steps };
          }),
        })),

      setEngineOn: (on) => set({ engineOn: on }),
      setPhysicalInput: (on) => set({ physicalInput: on }),
      setTargetProcess: (name) => set({ targetProcess: name }),
      setMinCycleMs: (ms) => set({ minCycleMs: Math.max(1, Math.floor(ms) || 1) }),
      setHotkeyMode: (mode) => set({ hotkeyMode: mode }),
      setHotkeys: (on, off) => set({ hotkeyOn: on, hotkeyOff: off }),
      setHotkeyToggle: (key) => set({ hotkeyToggle: key }),

      setOverlayConfig: (patch) =>
        set((st) => ({ overlayConfig: { ...st.overlayConfig, ...patch } })),
      setOverlayPos: (x, y) => set({ overlayPos: { x, y } }),
      setOverlaySize: (w, h) => set({ overlaySize: { w, h } }),

      applyImport: (payload, mode) =>
        set((st) =>
          mode === "merge"
            ? { sets: [...st.sets, ...payload.sets], groups: [...st.groups, ...payload.groups] }
            : {
                sets: payload.sets,
                groups: payload.groups,
                physicalInput: payload.settings.physicalInput,
                targetProcess: payload.settings.targetProcess,
                minCycleMs: payload.settings.minCycleMs,
                hotkeyOn: payload.settings.hotkeyOn,
                hotkeyOff: payload.settings.hotkeyOff,
                hotkeyMode: payload.settings.hotkeyMode ?? st.hotkeyMode,
                hotkeyToggle: payload.settings.hotkeyToggle ?? st.hotkeyToggle,
                execMode: payload.settings.execMode,
                allowDuplicateTriggers: payload.settings.allowDuplicateTriggers ?? st.allowDuplicateTriggers,
                fpsAutoDelayEnabled: payload.settings.fpsAutoDelayEnabled ?? st.fpsAutoDelayEnabled,
                overlayConfig: payload.settings.overlayConfig
                  ? { ...DEFAULT_OVERLAY_CONFIG, ...payload.settings.overlayConfig }
                  : st.overlayConfig,
                engineOn: false,
              }
        ),
    }),
    {
      name: "panda-key",
      storage: createJSONStorage(() => makeDebouncedStorage()),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 엔진은 항상 꺼진 상태로 부팅 — 의도치 않은 자동 실행 방지
        state.engineOn = false;
        state.physicalInput = state.physicalInput ?? false;
        state.targetProcess = state.targetProcess ?? "";
        state.minCycleMs = state.minCycleMs ?? 16;
        state.hotkeyMode = state.hotkeyMode ?? "separate";
        state.hotkeyOn = state.hotkeyOn ?? "Home";
        state.hotkeyOff = state.hotkeyOff ?? "End";
        state.hotkeyToggle = state.hotkeyToggle ?? "";
        state.execMode = state.execMode ?? "concurrent";
        state.allowDuplicateTriggers = state.allowDuplicateTriggers ?? false;
        state.overlayConfig = { ...DEFAULT_OVERLAY_CONFIG, ...(state.overlayConfig ?? {}) };
        state.overlayPos = state.overlayPos ?? null;
        state.overlaySize = state.overlaySize ?? null;
        state.groups = Array.isArray(state.groups) ? state.groups : [];
        // 딜레이 프리셋 마이그레이션: builtin 프리셋 항상 최신 상태로 유지
        const presets: DelayPreset[] = Array.isArray(state.delayPresets) ? state.delayPresets : [];
        const hasBuiltin = presets.some((p) => p.id === DEFAULT_DELAY_PRESET_ID);
        state.delayPresets = hasBuiltin
          ? presets.map((p) => (p.id === DEFAULT_DELAY_PRESET_ID ? DEFAULT_DELAY_PRESET : p))
          : [DEFAULT_DELAY_PRESET, ...presets];
        state.fpsAutoDelayEnabled = state.fpsAutoDelayEnabled ?? true;
        // 스텝 스키마 마이그레이션 (레거시 pressMs/releaseMs → 누르기/때기 분리)
        if (Array.isArray(state.sets)) {
          // 레거시 단일 group 문자열 → 그룹 엔티티로 승격 (그룹이 아직 없을 때만)
          if (state.groups.length === 0) {
            const byName = new Map<string, string[]>();
            for (const s of state.sets) {
              const g = (s as any).group;
              if (typeof g === "string" && g) {
                if (!byName.has(g)) byName.set(g, []);
                byName.get(g)!.push(s.id);
              }
            }
            state.groups = Array.from(byName.entries()).map(([name, memberIds]) => ({
              id: `grp_${name}_${memberIds.length}`,
              name,
              memberIds,
            }));
          }
          state.sets = state.sets.map((s) => {
            const { group: _drop, ...rest } = s as any;
            return {
              ...rest,
              useStandardDelay: rest.useStandardDelay ?? false,
              standardDelayMs: clampMs(rest.standardDelayMs ?? 50),
              autoDelayPresetId: rest.autoDelayPresetId ?? null,
              steps: Array.isArray(rest.steps) ? rest.steps.flatMap((raw: any) => migrateStep(raw)) : [],
            };
          });
        }
      },
    }
  )
);

export const MODE_VALUES: TriggerMode[] = ["once", "whileHeld", "toggleSame", "toggleAny"];
