"use client";

/**
 * 인앱 업데이트 — tauri-plugin-updater 래퍼.
 * 호출 흐름: checkForUpdate() → 사용자 확인 → downloadAndInstall() → 앱 재시작
 * (통합_Ver.5.5.4 프로젝트에서 포팅)
 */

import { isTauri, saveUpdateErrorLog } from "@/lib/tauri";

export type UpdateInfo = {
  available: boolean;
  currentVersion: string;
  newVersion?: string;
  notes?: string;
};

export type InstallResult =
  | { ok: true }
  | { ok: false; error: string; errorLogPath: string | null };

type UpdateEvent =
  | { event: "Started"; data: { contentLength?: number | null } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

type UpdatePluginUpdate = {
  version: string;
  body?: string;
  downloadAndInstall: (cb: (e: UpdateEvent) => void) => Promise<void>;
};

type UpdaterPlugin = {
  check: () => Promise<UpdatePluginUpdate | null>;
};

async function loadUpdater(): Promise<UpdaterPlugin | null> {
  try {
    const m = await import("@tauri-apps/plugin-updater");
    return m as unknown as UpdaterPlugin;
  } catch {
    return null;
  }
}

async function loadProcess(): Promise<{ relaunch: () => Promise<void> } | null> {
  try {
    const m = await import("@tauri-apps/plugin-process");
    return m as unknown as { relaunch: () => Promise<void> };
  } catch {
    return null;
  }
}

/** 업데이트 실패 시 사용자에게 전달할 로그 파일 내용 생성. */
function buildErrorLog(e: unknown, ctx: { currentVersion: string; newVersion: string }): string {
  const ts = new Date().toLocaleString("ko-KR", { hour12: false });
  const errorStr =
    e instanceof Error
      ? `${e.name}: ${e.message}\n\n스택 트레이스:\n${e.stack ?? "(없음)"}`
      : String(e);

  return [
    "============================================================",
    "  PANDA KEY — 자동 업데이트 실패 로그",
    "============================================================",
    "",
    `생성 시각  : ${ts}`,
    `현재 버전  : v${ctx.currentVersion}`,
    `업데이트 대상: v${ctx.newVersion}`,
    "",
    "------------------------------------------------------------",
    "  오류 내용",
    "------------------------------------------------------------",
    errorStr,
    "",
    "------------------------------------------------------------",
    "  안내",
    "------------------------------------------------------------",
    "이 파일을 개발자(GitHub Issues)에 첨부해 주시면",
    "원인 파악에 큰 도움이 됩니다.",
    "  https://github.com/ohjae-88/PanDaA2Key/issues",
    "",
    "직접 다운로드:",
    "  https://github.com/ohjae-88/PanDaA2Key/releases/latest",
  ].join("\n");
}

/** 업데이트 확인. 가능 시 정보 반환, 없으면 available=false. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  try {
    const mod = await loadUpdater();
    if (!mod) return null;
    // 15초 타임아웃 — 콜백 유실로 프로미스가 영구 대기하는 것 방지
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
    const update = await Promise.race([mod.check(), timeout]);
    const appMod = await import("@tauri-apps/api/app");
    const currentVersion = await appMod.getVersion();
    if (!update) return { available: false, currentVersion };
    return {
      available: true,
      currentVersion,
      newVersion: update.version,
      notes: update.body,
    };
  } catch (e) {
    console.warn("updater check failed", e);
    return null;
  }
}

/** 다운로드 + 설치 + 재시작. 실패 시 로그 파일 저장 후 경로 반환. */
export async function downloadAndInstall(
  onProgress?: (downloaded: number, total: number | null) => void
): Promise<InstallResult> {
  if (!isTauri()) return { ok: false, error: "비-Tauri 환경", errorLogPath: null };

  let newVersion = "확인 불가";

  try {
    const mod = await loadUpdater();
    if (!mod) return { ok: false, error: "업데이터 플러그인 로드 실패", errorLogPath: null };
    const update = await mod.check();
    if (!update) return { ok: false, error: "업데이트 정보를 가져올 수 없음", errorLogPath: null };

    newVersion = update.version;

    let downloaded = 0;
    let total: number | null = null;
    await update.downloadAndInstall((event: UpdateEvent) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onProgress?.(downloaded, total);
      }
    });

    const procMod = await loadProcess();
    if (procMod) await procMod.relaunch();
    return { ok: true };
  } catch (e) {
    const errorStr = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("updater install failed", e);

    let errorLogPath: string | null = null;
    try {
      const appMod = await import("@tauri-apps/api/app");
      const currentVersion = await appMod.getVersion().catch(() => "unknown");
      const logContent = buildErrorLog(e, { currentVersion, newVersion });
      errorLogPath = await saveUpdateErrorLog(logContent);
    } catch {
      // 로그 저장 실패 — 무시
    }

    return { ok: false, error: errorStr, errorLogPath };
  }
}
