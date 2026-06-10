/**
 * 입력 식별자 ↔ 표시 이름 레지스트리.
 * 식별자는 Rust(keycodes.rs)와 1:1 대응해야 한다.
 */

export type KeyDef = { code: string; label: string };
export type KeyGroup = { name: string; keys: KeyDef[] };

const letters: KeyDef[] = Array.from({ length: 26 }, (_, i) => {
  const c = String.fromCharCode(65 + i);
  return { code: `Key${c}`, label: c };
});

const digits: KeyDef[] = Array.from({ length: 10 }, (_, i) => ({
  code: `Digit${i}`,
  label: String(i),
}));

const functionKeys: KeyDef[] = Array.from({ length: 12 }, (_, i) => ({
  code: `F${i + 1}`,
  label: `F${i + 1}`,
}));

const numpad: KeyDef[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ code: `Numpad${i}`, label: `넘패드 ${i}` })),
  { code: "NumpadAdd", label: "넘패드 +" },
  { code: "NumpadSubtract", label: "넘패드 -" },
  { code: "NumpadMultiply", label: "넘패드 *" },
  { code: "NumpadDivide", label: "넘패드 /" },
  { code: "NumpadDecimal", label: "넘패드 ." },
  { code: "NumpadEnter", label: "넘패드 Enter" },
];

const navigation: KeyDef[] = [
  { code: "ArrowUp", label: "↑" },
  { code: "ArrowDown", label: "↓" },
  { code: "ArrowLeft", label: "←" },
  { code: "ArrowRight", label: "→" },
  { code: "Home", label: "Home" },
  { code: "End", label: "End" },
  { code: "PageUp", label: "PageUp" },
  { code: "PageDown", label: "PageDown" },
  { code: "Insert", label: "Insert" },
  { code: "Delete", label: "Delete" },
];

const controls: KeyDef[] = [
  { code: "Space", label: "Space" },
  { code: "Enter", label: "Enter" },
  { code: "Escape", label: "Esc" },
  { code: "Tab", label: "Tab" },
  { code: "Backspace", label: "Backspace" },
  { code: "CapsLock", label: "CapsLock" },
  { code: "ShiftLeft", label: "Shift(좌)" },
  { code: "ShiftRight", label: "Shift(우)" },
  { code: "ControlLeft", label: "Ctrl(좌)" },
  { code: "ControlRight", label: "Ctrl(우)" },
  { code: "AltLeft", label: "Alt(좌)" },
  { code: "AltRight", label: "Alt(우)" },
];

const symbols: KeyDef[] = [
  { code: "Backquote", label: "`" },
  { code: "Minus", label: "-" },
  { code: "Equal", label: "=" },
  { code: "BracketLeft", label: "[" },
  { code: "BracketRight", label: "]" },
  { code: "Backslash", label: "\\" },
  { code: "Semicolon", label: ";" },
  { code: "Quote", label: "'" },
  { code: "Comma", label: "," },
  { code: "Period", label: "." },
  { code: "Slash", label: "/" },
];

const mouse: KeyDef[] = [
  { code: "MouseLeft", label: "마우스 좌클릭" },
  { code: "MouseRight", label: "마우스 우클릭" },
  { code: "MouseMiddle", label: "마우스 휠클릭" },
  { code: "MouseX1", label: "마우스 X1" },
  { code: "MouseX2", label: "마우스 X2" },
];

export const KEY_GROUPS: KeyGroup[] = [
  { name: "마우스", keys: mouse },
  { name: "문자", keys: letters },
  { name: "숫자", keys: digits },
  { name: "기능키", keys: functionKeys },
  { name: "제어", keys: controls },
  { name: "방향/탐색", keys: navigation },
  { name: "넘패드", keys: numpad },
  { name: "기호", keys: symbols },
];

const CODE_TO_LABEL: Record<string, string> = {};
for (const g of KEY_GROUPS) for (const k of g.keys) CODE_TO_LABEL[k.code] = k.label;

/** 입력 식별자 → 표시 이름. 미등록이면 식별자 그대로 반환. */
export function inputLabel(code: string): string {
  if (!code) return "—";
  return CODE_TO_LABEL[code] ?? code;
}

/** 마우스 입력 여부 */
export function isMouse(code: string): boolean {
  return code.startsWith("Mouse");
}

/** 복합 단축키 토큰(수식키) 표시 이름 */
const MODIFIER_LABEL: Record<string, string> = {
  Ctrl: "Ctrl",
  Control: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
};

/**
 * 복합 단축키 문자열 → 표시 이름.
 * 형식: "Shift+Home", "Ctrl+Shift+KeyK" 처럼 "+" 로 연결.
 * 수식키(Ctrl/Shift/Alt)는 그대로, 나머지는 inputLabel 적용.
 */
export function hotkeyLabel(combo: string): string {
  if (!combo) return "—";
  return combo
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => MODIFIER_LABEL[p] ?? inputLabel(p))
    .join(" + ");
}
