"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type MenuItem =
  | { type: "sep" }
  | {
      type?: "item";
      label: string;
      icon?: React.ReactNode;
      onClick: () => void;
      danger?: boolean;
      active?: boolean;
    };

export type MenuState = {
  x: number;
  y: number;
  /** 위로 뒤집힐 때 기준 y (버튼.top 또는 커서.y). 미설정 시 y 값 사용 */
  yAnchor?: number;
  items: MenuItem[];
} | null;

export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // 바깥 클릭 / ESC 감지
  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 다음 틱부터 바깥 클릭 감지 (여는 클릭이 즉시 닫지 않도록)
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onDown, true);
      window.addEventListener("keydown", onKey, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [state, onClose]);

  /**
   * 뷰포트 경계 보정 — paint 전에 실행되므로 깜빡임 없음.
   * 1. 초기 렌더: visibility:hidden + state.x/y 위치 (JSX)
   * 2. useLayoutEffect: 실제 크기 측정 → 위치 보정 → visibility:visible
   */
  useLayoutEffect(() => {
    if (!state || !ref.current) return;
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = state.x;
    let y = state.y;

    // 아래 공간 부족 → 위로 뒤집기 (yAnchor = 버튼 top 또는 커서 y)
    if (y + h > vh - 4) {
      const anchor = state.yAnchor ?? state.y;
      y = anchor - h - 4;
    }
    // 상단 클립 방지
    if (y < 4) y = 4;

    // 오른쪽 공간 부족 → 왼쪽으로 밀기
    if (x + w > vw - 4) x = vw - w - 4;
    if (x < 4) x = 4;

    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.visibility = "visible";
  }, [state]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      style={{ left: state.x, top: state.y, visibility: "hidden" }}
      className="fixed z-[100] min-w-[180px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((it, i) =>
        "type" in it && it.type === "sep" ? (
          <div key={i} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => {
              onClose();
              (it as Extract<MenuItem, { onClick: () => void }>).onClick();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent/20",
              (it as any).danger && "text-destructive hover:bg-destructive/10",
              (it as any).active && "bg-accent/15 text-[hsl(var(--cat-macro))]"
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center">{(it as any).icon}</span>
            <span className="flex-1">{(it as any).label}</span>
          </button>
        )
      )}
    </div>
  );
}
