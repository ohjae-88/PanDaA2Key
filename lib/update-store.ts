"use client";

/**
 * 업데이트 전역 상태 (zustand).
 * - AppShell: 앱 시작 시 자동 확인
 * - SiteHeader: 수동 확인 버튼
 * - UpdateDialog: 설치 다이얼로그
 */

import { create } from "zustand";
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from "./updater";
import { showToast } from "./utils";

export type UpdateProgress = { downloaded: number; total: number | null };

export const RELEASES_URL = "https://github.com/ohjae-88/PanDaA2Key/releases/latest";

type UpdateState = {
  /** null = 아직 확인 안 함 */
  info: UpdateInfo | null;
  open: boolean;
  checking: boolean;
  installing: boolean;
  progress: UpdateProgress | null;
  failed: boolean;
  errorLogPath: string | null;

  /** 업데이트 확인. 신규 버전 있으면 다이얼로그 자동 오픈. */
  check: (silent?: boolean) => Promise<void>;
  /** 다운로드 + 설치 + 재시작 */
  install: () => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  info: null,
  open: false,
  checking: false,
  installing: false,
  progress: null,
  failed: false,
  errorLogPath: null,

  check: async (silent = false) => {
    if (get().checking) return;
    set({ checking: true, failed: false, errorLogPath: null });
    try {
      const info = await checkForUpdate();
      if (!info) {
        if (!silent) set({ failed: true, open: true, checking: false });
        else set({ checking: false });
        return;
      }
      set({ info, checking: false });
      if (info.available) {
        set({ open: true });
      } else if (!silent) {
        showToast(`최신 버전입니다. (v${info.currentVersion})`);
      }
    } catch {
      if (!silent) set({ failed: true, open: true, checking: false });
      else set({ checking: false });
    }
  },

  install: async () => {
    set({ installing: true, progress: { downloaded: 0, total: null }, failed: false, errorLogPath: null });
    try {
      const result = await downloadAndInstall((downloaded, total) => {
        set({ progress: { downloaded, total } });
      });
      if (!result.ok) {
        set({ failed: true, installing: false, progress: null, errorLogPath: result.errorLogPath });
      }
      // 성공 시 앱이 재시작되므로 상태 초기화 불필요
    } catch {
      set({ failed: true, installing: false, progress: null, errorLogPath: null });
    }
  },

  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false, failed: false, errorLogPath: null }),
}));
