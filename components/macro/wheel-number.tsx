"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: number;
  onChange: (v: number) => void;
  /** 마우스 휠 1회전당 증감 (기본 1) */
  wheelStep?: number;
  min?: number;
};

/**
 * 숫자 입력 — 입력 위에서 **마우스 휠을 굴리면 1단위(wheelStep)** 로 증감.
 * (네이티브 wheel 리스너 passive:false 로 페이지 스크롤 방지)
 */
export function WheelNumber({ value, onChange, wheelStep = 1, min = 0, className, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const cur = Number(el.value) || 0;
      cb.current(Math.max(min, cur + dir * wheelStep));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [min, wheelStep]);

  return (
    <input
      ref={ref}
      type="number"
      min={min}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || 0)))}
      className={cn("tabular-nums", className)}
      {...rest}
    />
  );
}
