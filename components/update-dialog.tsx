"use client";

import { Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useUpdateStore, RELEASES_URL } from "@/lib/update-store";
import { openUrl } from "@/lib/tauri";

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/** 업데이트 다이얼로그 — 신규 버전 안내 + 다운로드 진행 + 실패 폴백 */
export function UpdateDialog() {
  const { info, open, installing, progress, failed, errorLogPath, install, closeDialog } =
    useUpdateStore();

  const pct =
    progress && progress.total
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !installing) closeDialog(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-[hsl(var(--cat-macro))]" />
            {failed ? "업데이트 확인 실패" : "새 버전 업데이트"}
          </DialogTitle>
          <DialogDescription>
            {failed ? (
              <>
                업데이트 서버에 연결할 수 없거나 설치에 실패했습니다.
                아래 버튼으로 직접 다운로드할 수 있습니다.
                {errorLogPath && (
                  <span className="mt-1 block text-[11px]">
                    오류 로그: <span className="break-all tabular-nums">{errorLogPath}</span>
                  </span>
                )}
              </>
            ) : info?.available ? (
              <>
                <strong className="text-foreground">v{info.currentVersion}</strong>
                {" → "}
                <strong className="text-[hsl(var(--cat-macro))]">v{info.newVersion}</strong>
                {" 으로 업데이트할 수 있습니다."}
              </>
            ) : (
              "업데이트 정보를 확인 중입니다."
            )}
          </DialogDescription>
        </DialogHeader>

        {/* 릴리즈 노트 */}
        {!failed && info?.notes && (
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
            {info.notes}
          </div>
        )}

        {/* 진행률 */}
        {installing && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                다운로드 중…
              </span>
              <span className="tabular-nums">
                {progress
                  ? progress.total
                    ? `${fmtMB(progress.downloaded)} / ${fmtMB(progress.total)} MB (${pct}%)`
                    : `${fmtMB(progress.downloaded)} MB`
                  : "준비 중…"}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[hsl(var(--cat-macro))] transition-all duration-200"
                style={{ width: `${pct ?? 5}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              완료되면 자동으로 재시작됩니다. 창을 닫지 마세요.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          {failed ? (
            <>
              <Button variant="ghost" onClick={closeDialog}>닫기</Button>
              <Button onClick={() => void openUrl(RELEASES_URL)} className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" /> 직접 다운로드
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={closeDialog} disabled={installing}>
                나중에
              </Button>
              <Button onClick={() => void install()} disabled={installing} className="gap-1.5">
                {installing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {installing ? "설치 중…" : "다운로드 및 설치"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
