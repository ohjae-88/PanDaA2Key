"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import { MacroEngineRuntime } from "@/components/macro/engine-runtime";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { isTauri, openOverlay, onMainCloseRequested, exitApp, hideMainWindow } from "@/lib/tauri";
import { FirstRunSetup } from "@/components/first-run-setup";
import { UpdateDialog } from "@/components/update-dialog";
import { useUpdateStore } from "@/lib/update-store";

/**
 * 앱 셸 — 라우트별 레이아웃 분기.
 * - 오버레이 윈도우(/overlay): 헤더/런타임/토스트 없이 투명 콘텐츠만.
 * - 메인: 헤더 + 콘텐츠 + 시작 시 오버레이 자동 ON + X 종료 선택 다이얼로그.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isOverlay = pathname?.startsWith("/overlay");
  const [closeOpen, setCloseOpen] = useState(false);
  const checkUpdate = useUpdateStore((s) => s.check);

  // 앱 시작 시 업데이트 자동 확인 (2초 딜레이 — 초기화와 경쟁 방지, silent)
  useEffect(() => {
    if (isOverlay || !isTauri()) return;
    const t = setTimeout(() => void checkUpdate(true), 2000);
    return () => clearTimeout(t);
  }, [isOverlay, checkUpdate]);

  // 메인 전용: 시작 시 오버레이 자동 ON + X 닫기 요청 구독 (오버레이 창에선 비활성)
  useEffect(() => {
    if (isOverlay || !isTauri()) return;
    void openOverlay();
    let alive = true;
    let un: (() => void) | undefined;
    onMainCloseRequested(() => setCloseOpen(true)).then((u) => (alive ? (un = u) : u()));
    return () => {
      alive = false;
      un?.();
    };
  }, [isOverlay]);

  if (isOverlay) {
    return <Suspense fallback={null}>{children}</Suspense>;
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-5">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      <MacroEngineRuntime />
      <Toaster />
      <FirstRunSetup />
      <UpdateDialog />

      {/* 메인 창 X — 종료 / 트레이 최소화 / 취소 */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>프로그램을 종료할까요?</DialogTitle>
            <DialogDescription>
              완전히 종료하거나, 트레이로 최소화해 백그라운드에서 매크로를 유지할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="ghost" onClick={() => setCloseOpen(false)}>
              취소
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setCloseOpen(false);
                void hideMainWindow();
              }}
            >
              트레이로 최소화
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setCloseOpen(false);
                void exitApp();
              }}
            >
              종료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
