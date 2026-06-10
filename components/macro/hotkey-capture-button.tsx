"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { hotkeyLabel } from "@/lib/macro/keys";
import { startKeyCapture, cancelKeyCapture, isTauri } from "@/lib/tauri";

type Props = {
  value: string;
  onCapture: (combo: string) => void;
  placeholder?: string;
  className?: string;
};

/** 단독 누름(Shift/Ctrl/Alt)은 무시하고 본 키와 조합해 캡처. */
const MOD_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * 복합 단축키 캡처 버튼 — 예: Shift+Home, Ctrl+Shift+K.
 * 설정 창이 포커스를 가진 상태에서 DOM(capture phase)으로 잡는다.
 * 수식키만 누르면 대기하고, 본 키가 눌리는 순간 현재 눌린 수식키와 조합해 확정한다.
 * Tauri 에서는 캡처 동안 트리거/단축키 처리를 일시 정지(startKeyCapture).
 */
export function HotkeyCaptureButton({
  value,
  onCapture,
  placeholder = "단축키 지정",
  className,
}: Props) {
  const [capturing, setCapturing] = useState(false);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  useEffect(() => {
    if (!capturing) return;
    if (isTauri()) void startKeyCapture();

    const stop = () => {
      window.removeEventListener("keydown", onKey, true);
      if (isTauri()) void cancelKeyCapture();
      setCapturing(false);
    };

    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stop();
        return;
      }
      // 수식키 단독 누름은 본 키 대기
      if (MOD_KEYS.has(e.key)) return;
      if (!e.code) return;
      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      onCaptureRef.current([...mods, e.code].join("+"));
      stop();
    }

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (isTauri()) void cancelKeyCapture();
    };
  }, [capturing]);

  return (
    <button
      type="button"
      data-capture-ignore
      onClick={() => setCapturing((v) => !v)}
      className={cn(
        "inline-flex h-8 min-w-[112px] items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-bold transition-colors",
        capturing
          ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))] animate-pulse"
          : value
            ? "border-input bg-card hover:bg-accent/10"
            : "border-dashed border-input text-muted-foreground hover:bg-accent/10",
        className
      )}
    >
      {capturing ? (
        <>
          <span>조합 입력…</span>
          <X className="h-3 w-3" />
        </>
      ) : (
        <>
          <Keyboard className="h-3.5 w-3.5" />
          <span>{value ? hotkeyLabel(value) : placeholder}</span>
        </>
      )}
    </button>
  );
}
