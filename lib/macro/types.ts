/** 트리거 동작 모드 — Rust(macro_engine.rs)의 TriggerMode 와 1:1 (serde camelCase) */
export type TriggerMode =
  /** 1회 */
  | "once"
  /** 누르는 동안 반복 */
  | "whileHeld"
  /** 한번 클릭 시 무한 반복, 같은 키 다시 누르면 멈춤 */
  | "toggleSame"
  /** 한번 클릭 시 무한 반복, 아무 키나 누르면 멈춤 */
  | "toggleAny";

/**
 * 스텝 동작
 * - tap     : 누르고 떼기 (한 카드로 완결 — 가장 흔한 경우)
 * - press   : 누르기(유지) — 떼기 전까지 눌린 채 유지
 * - release : 때기 — 유지 중인 키를 뗌
 * - delay   : 지연 — 키 없이 대기 (카드 사이 간격)
 */
export type StepAction = "tap" | "press" | "release" | "delay";

/**
 * 매크로 한 스텝(카드).
 *
 * - tap: input 을 누른 뒤 holdMs 만큼 유지하고 뗌.
 * - press: input 을 누른 채 유지(이미 눌려있으면 유지).
 * - release: 유지 중인 input 을 뗌.
 * - delay: delayMs 만큼 대기.
 *
 * 지연은 별도 카드로 카드 사이에 배치한다. (예: ⬇Ctrl  350ms  ⬇Tab  ⬆Tab  ⬆Ctrl)
 * 누르기/때기를 분리하면 키를 누른 채 다른 키를 입력할 수 있고,
 * 때기 없이 끝나는(눌린 채 남는) 키는 다음 반복 사이클까지 계속 눌린 상태로 지속된다.
 */
export type MacroStep = {
  id: string;
  /** 입력 식별자 (keys.ts) — delay 는 "" */
  input: string;
  /** 동작: 탭 / 누르기 / 때기 / 지연 */
  action: StepAction;
  /** tap 의 누름 유지 시간(ms) */
  holdMs: number;
  /** delay 의 대기 시간(ms) */
  delayMs: number;
};

export const STEP_ACTION_LABEL: Record<StepAction, string> = {
  tap: "탭(누르고 떼기)",
  press: "누르기(유지)",
  release: "때기",
  delay: "지연",
};

export const isKeyStep = (s: MacroStep) => s.action !== "delay";

/**
 * 시퀀스 종료 시점에 떼지 않고 눌린 채 남는 키 목록(입력 순서).
 * 반복 모드에서는 다음 사이클까지 계속 눌린 상태로 지속된다.
 */
export function leftoverHeld(steps: MacroStep[]): string[] {
  const order: string[] = [];
  const held = new Set<string>();
  for (const s of steps) {
    if (!s.input) continue;
    if (s.action === "press") {
      if (!held.has(s.input)) {
        held.add(s.input);
        order.push(s.input);
      }
    } else {
      // tap, release 모두 종료 후 키는 떼진 상태
      held.delete(s.input);
    }
  }
  return order.filter((c) => held.has(c));
}

/** FPS → 딜레이 매핑 구간 */
export type FpsRange = {
  /** 이 구간의 상한(exclusive). 마지막 구간은 9999 = "무제한". maxFps 오름차순 정렬 필수 */
  maxFps: number;
  /** 이 구간에서 사용할 딜레이(ms) */
  delayMs: number;
};

/** FPS 기반 자동 딜레이 프리셋 */
export type DelayPreset = {
  id: string;
  name: string;
  /** true = 기본 제공, 삭제·이름 변경 불가 */
  builtin?: true;
  /** FPS 구간별 딜레이, maxFps 오름차순 정렬 */
  ranges: FpsRange[];
};

export const DEFAULT_DELAY_PRESET_ID = "__recommended__" as const;

export const DEFAULT_DELAY_PRESET: DelayPreset = {
  id: DEFAULT_DELAY_PRESET_ID,
  name: "자동 (권장)",
  builtin: true,
  ranges: [
    { maxFps: 30,   delayMs: 40 },
    { maxFps: 60,   delayMs: 25 },
    { maxFps: 90,   delayMs: 12 },
    { maxFps: 144,  delayMs: 7  },
    { maxFps: 9999, delayMs: 4  },
  ],
};

/** FPS 미측정(0 이하) 시 가정값 — 일반적인 60fps 기준 구간 적용 */
export const FALLBACK_FPS = 60;

/** ms → fps 환산 문자열 (소수 1자리, 불필요한 .0 제거). 예: 16 → "62.5", 25 → "40" */
export function msToFps(ms: number): string {
  if (ms <= 0) return "∞";
  return String(parseFloat((1000 / ms).toFixed(1)));
}

/** 현재 FPS 에 맞는 딜레이(ms) 반환. fps<=0(미측정)이면 FALLBACK_FPS 가정 */
export function resolvePresetDelay(preset: DelayPreset, fps: number): number {
  const f = fps > 0 ? fps : FALLBACK_FPS;
  const range = preset.ranges.find((r) => f < r.maxFps) ?? preset.ranges[preset.ranges.length - 1];
  return range?.delayMs ?? 16;
}

/** 매크로 세트 */
export type MacroSet = {
  id: string;
  name: string;
  /** 트리거 입력 식별자 */
  trigger: string;
  mode: TriggerMode;
  /** 트리거 키를 게임/OS 로 통과시킬지 (false = 소비) */
  passThrough: boolean;
  enabled: boolean;
  /** 표준 지연 사용 — true 면 모든 지연 카드가 standardDelayMs 로 일괄 적용 */
  useStandardDelay: boolean;
  /** 표준 지연 값(ms) */
  standardDelayMs: number;
  /** FPS 자동 딜레이 프리셋 ID. null = 자동 아님 */
  autoDelayPresetId: string | null;
  steps: MacroStep[];
};

/** 매크로 그룹 — 여러 매크로를 묶어 일괄 ON/OFF (다대다: 한 매크로가 여러 그룹에 포함 가능) */
export type MacroGroup = {
  id: string;
  name: string;
  /** 소속 매크로 세트 id 목록 */
  memberIds: string[];
};

/** 전체 ON/OFF 단축키 모드 */
export type HotkeyMode =
  /** ON 단축키 / OFF 단축키 개별 설정 */
  | "separate"
  /** 한 키로 ON↔OFF 토글 */
  | "toggle";

/** 다중 실행 모드 */
export type ExecMode =
  /** 동시 실행 — 여러 세트가 함께 실행 (예1) */
  | "concurrent"
  /** 배타 실행 — 새 매크로 시작 시 기존은 일시정지, 끝나면 재개 (예2) */
  | "exclusive";

/** 오버레이 시각 설정 — 메인에서 조절, 오버레이 창에 반영 */
export type OverlayConfig = {
  /** FPS 값 색 (#rrggbb) */
  accent: string;
  /** 패널 배경 불투명도 0~1 */
  bgOpacity: number;
  /** 텍스트 배율 0.6~2.5 */
  textScale: number;
  /** 전체 크기 배율 0.5~3 */
  scale: number;
  /** 엔진 ON(대기) 색 */
  engineOnColor: string;
  /** 엔진 OFF 색 */
  engineOffColor: string;
  /** 실행중(매크로 active) 강조색 — 배경+테두리 */
  activeColor: string;
};

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  accent: "#34d399",
  bgOpacity: 0.55,
  textScale: 1,
  scale: 1,
  engineOnColor: "#34d399",
  engineOffColor: "#9ca3af",
  activeColor: "#fbbf24",
};

export type MacroState = {
  sets: MacroSet[];
  /** 매크로 그룹 (다대다) */
  groups: MacroGroup[];
  /** 엔진 On/Off (트리거 감지 활성화) */
  engineOn: boolean;
  /** 물리 입력(Interception 드라이버) 모드 — 게임이 실제 키보드 입력으로 인식 */
  physicalInput: boolean;
  /** 활성 창 제한 — 비우면 제한 없음, 입력 시 해당 프로세스명(예: game.exe)일 때만 동작 */
  targetProcess: string;
  /** 반복 모드 최소 사이클 주기(ms) */
  minCycleMs: number;
  /** 단축키 모드: 개별(separate) 또는 통합 토글(toggle) */
  hotkeyMode: HotkeyMode;
  /** 전체 ON 단축키 (키 식별자) — separate 모드 전용 */
  hotkeyOn: string;
  /** 전체 OFF 단축키 (키 식별자) — separate 모드 전용 */
  hotkeyOff: string;
  /** 통합 토글 단축키 (키 식별자) — toggle 모드 전용 */
  hotkeyToggle: string;
  /** 다중 실행 모드 */
  execMode: ExecMode;
  /** 오버레이 시각 설정 */
  overlayConfig: OverlayConfig;
  /** 오버레이 창 위치 (없으면 기본 우상단) */
  overlayPos: { x: number; y: number } | null;
  /** 오버레이 창 크기 (없으면 기본) */
  overlaySize: { w: number; h: number } | null;
  /** 같은 트리거에 여러 매크로 동시 실행 허용 */
  allowDuplicateTriggers: boolean;
  /** FPS 기반 자동 딜레이 프리셋 목록. 항상 DEFAULT_DELAY_PRESET 포함 */
  delayPresets: DelayPreset[];
  /** FPS 자동 딜레이 전역 ON/OFF — OFF 시 자동 프리셋 지정 세트도 표준/개별 지연으로 동작 */
  fpsAutoDelayEnabled: boolean;
};

/** Rust 로 보낼 직렬화 형태 — UI 전용 필드(step.id) 제외 */
export type MacroSetPayload = {
  id: string;
  name: string;
  trigger: string;
  mode: TriggerMode;
  passThrough: boolean;
  enabled: boolean;
  steps: { input: string; action: StepAction; holdMs: number; delayMs: number }[];
};

export const TRIGGER_MODE_LABEL: Record<TriggerMode, string> = {
  once: "1회",
  whileHeld: "누르는 동안 반복",
  toggleSame: "토글 (같은 키로 멈춤)",
  toggleAny: "토글 (아무 키로 멈춤)",
};

export const TRIGGER_MODE_DESC: Record<TriggerMode, string> = {
  once: "트리거를 누르면 스텝을 한 번 실행합니다.",
  whileHeld: "트리거를 누르고 있는 동안 스텝을 반복합니다.",
  toggleSame: "한 번 누르면 무한 반복, 같은 트리거 키를 다시 누르면 멈춥니다.",
  toggleAny: "한 번 누르면 무한 반복, 아무 키나 누르면 멈춥니다.",
};
