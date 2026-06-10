"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Monitor, MousePointerClick, Pin, PinOff, RefreshCw } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { showToast } from "@/lib/utils";
import {
  setAlwaysOnTop,
  toggleOverlay,
  setOverlayPassthrough,
  isOverlayOpen,
  onOverlayStateChanged,
} from "@/lib/tauri";
import { useUpdateStore } from "@/lib/update-store";

export function SiteHeader() {
  const [onTop, setOnTop] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [passthrough, setPassthrough] = useState(false);
  const { check, checking, info, openDialog } = useUpdateStore();

  useEffect(() => {
    void setAlwaysOnTop(onTop);
  }, [onTop]);

  // 오버레이 상태 구독 + 초기값
  useEffect(() => {
    let alive = true;
    void isOverlayOpen().then((o) => alive && setOverlayOpen(o));
    let un: (() => void) | undefined;
    onOverlayStateChanged((open) => {
      setOverlayOpen(open);
      if (!open) setPassthrough(false);
    }).then((u) => {
      if (alive) un = u;
      else u();
    });
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  async function onToggleOverlay() {
    const open = await toggleOverlay();
    setOverlayOpen(open);
    if (!open) setPassthrough(false);
    showToast(open ? "오버레이 열림" : "오버레이 닫힘");
  }
  function onTogglePassthrough() {
    const next = !passthrough;
    setPassthrough(next);
    void setOverlayPassthrough(next);
    showToast(next ? "오버레이 클릭 통과 ON — 마우스가 게임으로 전달" : "오버레이 클릭 통과 OFF");
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-3 px-4">
        <Link href="/macro" className="flex items-center gap-2 font-bold">
          <span className="text-xl">🐼</span>
          <span>PANDA KEY</span>
        </Link>
        {/* 버전 + 업데이트 확인 버튼 */}
        <button
          type="button"
          onClick={() => (info?.available ? openDialog() : void check(false))}
          disabled={checking}
          title={info?.available ? `새 버전 v${info.newVersion} — 클릭하여 설치` : "업데이트 확인"}
          className={cn(
            "relative flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-accent/20 disabled:opacity-60",
            info?.available ? "font-bold text-emerald-400" : "text-muted-foreground"
          )}
        >
          <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
          <span>Ver.{process.env.NEXT_PUBLIC_APP_VERSION}</span>
          {info?.available && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-background" />
          )}
        </button>

        <div className="mx-2 h-6 w-px bg-border" />

        <nav className="flex items-center gap-2">
          <div
            className={cn(
              "flex rounded-md border overflow-hidden border-current text-[hsl(var(--cat-macro))] bg-current/10"
            )}
          >
            <span className="px-3 py-1.5 text-sm font-semibold text-[hsl(var(--cat-macro))]">
              ⌨ 매크로
            </span>
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* 오버레이 토글 */}
          <button
            type="button"
            onClick={onToggleOverlay}
            title="인게임 오버레이 — FPS · 엔진 ON/OFF 표시"
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-bold transition-colors",
              overlayOpen
                ? "border-current text-[hsl(var(--cat-macro))] bg-current/10"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Monitor className="h-3.5 w-3.5" />
            오버레이
          </button>
          {/* 오버레이 클릭 통과 (열렸을 때만) */}
          {overlayOpen && (
            <button
              type="button"
              onClick={onTogglePassthrough}
              title="ON 시 오버레이가 마우스 클릭을 게임으로 통과(창 이동 불가)"
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-bold transition-colors",
                passthrough
                  ? "border-current text-[hsl(var(--cat-macro))] bg-current/10"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
              클릭 통과
            </button>
          )}

          <div className="mx-1 h-6 w-px bg-border" />

          <button
            type="button"
            onClick={() => setOnTop((v) => !v)}
            title={onTop ? "항상 위 해제" : "항상 위 고정"}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-bold transition-colors",
              onTop
                ? "border-current text-[hsl(var(--cat-macro))] bg-current/10"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {onTop ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
            항상 위
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
