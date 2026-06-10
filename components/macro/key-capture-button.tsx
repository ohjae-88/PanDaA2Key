"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputLabel } from "@/lib/macro/keys";
import { captureNextInput } from "@/lib/macro/capture";

type Props = {
  value: string;
  onCapture: (code: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * 키/마우스 입력 캡처 버튼.
 * DOM(capture phase) + 네이티브 후킹을 함께 사용 → 키보드는 물론
 * 마우스 좌/우/휠/사이드버튼까지 트리거로 지정 가능.
 */
export function KeyCaptureButton({ value, onCapture, placeholder = "키 지정", className }: Props) {
  const [capturing, setCapturing] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;

  function start() {
    if (capturing) {
      cancelRef.current?.();
      cancelRef.current = null;
      setCapturing(false);
      return;
    }
    setCapturing(true);
    cancelRef.current = captureNextInput(
      (code) => {
        onCaptureRef.current(code);
        cancelRef.current = null;
        setCapturing(false);
      },
      () => {
        cancelRef.current = null;
        setCapturing(false);
      }
    );
  }

  useEffect(() => {
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, []);

  return (
    <button
      type="button"
      data-capture-btn
      data-capture-ignore
      onClick={start}
      className={cn(
        "inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-bold transition-colors",
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
          <span>입력 대기…</span>
          <X className="h-3 w-3" />
        </>
      ) : (
        <>
          <Keyboard className="h-3.5 w-3.5" />
          <span>{value ? inputLabel(value) : placeholder}</span>
        </>
      )}
    </button>
  );
}
