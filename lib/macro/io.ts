import type {
  ExecMode,
  HotkeyMode,
  MacroGroup,
  MacroSet,
  MacroState,
  MacroStep,
  OverlayConfig,
  StepAction,
  TriggerMode,
} from "./types";
import { DEFAULT_OVERLAY_CONFIG } from "./types";

/** 내보내기 파일 포맷 */
export type MacroExport = {
  _kind: "panda-key";
  version: number;
  exportedAt: string;
  sets: MacroSet[];
  groups: MacroGroup[];
  settings: {
    physicalInput: boolean;
    targetProcess: string;
    minCycleMs: number;
    hotkeyOn: string;
    hotkeyOff: string;
    hotkeyMode: HotkeyMode;
    hotkeyToggle: string;
    execMode: ExecMode;
    allowDuplicateTriggers: boolean;
    overlayConfig: OverlayConfig;
    fpsAutoDelayEnabled: boolean;
  };
};

let _io = 0;
function uid(prefix: string): string {
  _io += 1;
  return `${prefix}_${_io.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const clampMs = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
const VALID_MODES: TriggerMode[] = ["once", "whileHeld", "toggleSame", "toggleAny"];
const VALID_ACTIONS: StepAction[] = ["tap", "press", "release", "delay"];

function normalizeStep(raw: any): MacroStep {
  const action: StepAction = VALID_ACTIONS.includes(raw?.action) ? raw.action : "tap";
  return {
    id: uid("step"),
    input: action === "delay" ? "" : typeof raw?.input === "string" ? raw.input : "",
    action,
    holdMs: action === "tap" ? clampMs(raw?.holdMs) : 0,
    delayMs: action === "delay" ? clampMs(raw?.delayMs) : 0,
  };
}

function normalizeSet(raw: any, idx: number): MacroSet {
  return {
    id: uid("set"),
    name: typeof raw?.name === "string" && raw.name ? raw.name : `매크로 ${idx + 1}`,
    trigger: typeof raw?.trigger === "string" ? raw.trigger : "",
    mode: VALID_MODES.includes(raw?.mode) ? raw.mode : "whileHeld",
    passThrough: !!raw?.passThrough,
    enabled: raw?.enabled !== false,
    useStandardDelay: !!raw?.useStandardDelay,
    standardDelayMs: clampMs(raw?.standardDelayMs ?? 50),
    autoDelayPresetId: typeof raw?.autoDelayPresetId === "string" ? raw.autoDelayPresetId : null,
    steps: Array.isArray(raw?.steps) ? raw.steps.map(normalizeStep) : [],
  };
}

function normalizeGroup(raw: any, idMap: Map<string, string>, idx: number): MacroGroup {
  const members = Array.isArray(raw?.memberIds) ? raw.memberIds : [];
  return {
    id: uid("grp"),
    name: typeof raw?.name === "string" && raw.name ? raw.name : `그룹 ${idx + 1}`,
    memberIds: members
      .map((m: any) => idMap.get(m))
      .filter((x: string | undefined): x is string => !!x),
  };
}

/** 현재 상태 → 내보내기 객체 */
export function buildExport(state: MacroState): MacroExport {
  return {
    _kind: "panda-key",
    version: 2,
    exportedAt: new Date().toISOString(),
    sets: state.sets,
    groups: state.groups,
    settings: {
      physicalInput: state.physicalInput,
      targetProcess: state.targetProcess,
      minCycleMs: state.minCycleMs,
      hotkeyOn: state.hotkeyOn,
      hotkeyOff: state.hotkeyOff,
      hotkeyMode: state.hotkeyMode,
      hotkeyToggle: state.hotkeyToggle,
      execMode: state.execMode,
      allowDuplicateTriggers: state.allowDuplicateTriggers,
      overlayConfig: state.overlayConfig,
      fpsAutoDelayEnabled: state.fpsAutoDelayEnabled,
    },
  };
}

/** 파일 텍스트 → 검증·정규화된 내보내기 객체. 실패 시 throw. */
export function parseImport(text: string): MacroExport {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("JSON 파싱 실패 — 올바른 파일이 아닙니다.");
  }
  if (!obj || obj._kind !== "panda-key") {
    throw new Error("PANDA KEY 매크로 파일이 아닙니다.");
  }
  if (!Array.isArray(obj.sets)) {
    throw new Error("세트 데이터가 없습니다.");
  }
  // 세트 정규화 + (구→신) id 매핑 — 그룹 멤버 참조 재연결용
  const idMap = new Map<string, string>();
  const sets = obj.sets.map((s: any, i: number) => {
    const ns = normalizeSet(s, i);
    if (typeof s?.id === "string") idMap.set(s.id, ns.id);
    return ns;
  });
  const groups: MacroGroup[] = Array.isArray(obj.groups)
    ? obj.groups.map((g: any, i: number) => normalizeGroup(g, idMap, i))
    : [];
  const st = obj.settings ?? {};
  const overlayRaw = st.overlayConfig ?? {};
  const overlayConfig: OverlayConfig = { ...DEFAULT_OVERLAY_CONFIG, ...Object.fromEntries(
    Object.entries(overlayRaw).filter(([, v]) => v !== undefined && v !== null)
  ) };
  return {
    _kind: "panda-key",
    version: Number(obj.version) || 1,
    exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
    sets,
    groups,
    settings: {
      physicalInput: !!st.physicalInput,
      targetProcess: typeof st.targetProcess === "string" ? st.targetProcess : "",
      minCycleMs: Math.max(1, Math.floor(Number(st.minCycleMs) || 16)),
      hotkeyOn: typeof st.hotkeyOn === "string" ? st.hotkeyOn : "Home",
      hotkeyOff: typeof st.hotkeyOff === "string" ? st.hotkeyOff : "End",
      hotkeyMode: st.hotkeyMode === "toggle" ? "toggle" : "separate",
      hotkeyToggle: typeof st.hotkeyToggle === "string" ? st.hotkeyToggle : "",
      execMode: st.execMode === "exclusive" ? "exclusive" : "concurrent",
      allowDuplicateTriggers: !!st.allowDuplicateTriggers,
      overlayConfig,
      fpsAutoDelayEnabled: st.fpsAutoDelayEnabled !== false,
    },
  };
}

/** 내보내기 파일명 (panda-key-macros-YYYYMMDD-HHmm.json) */
export function exportFileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `panda-key-macros-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
