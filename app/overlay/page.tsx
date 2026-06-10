"use client";

import { useEffect, useState } from "react";
import { Gauge, MousePointerClick, Power, X } from "lucide-react";
import {
  isEngineRunning,
  onRunningChanged,
  onFps,
  onOverlayConfig,
  onSetActive,
  setEngineRunning,
  setOverlayPassthrough,
  closeOverlay,
  fpsEnsure,
} from "@/lib/tauri";
import { useMacroStore } from "@/lib/macro/store";
import { DEFAULT_OVERLAY_CONFIG, type OverlayConfig } from "@/lib/macro/types";

/** Rust open_overlay 기본 내부 크기와 일치 (스케일 1 기준) */
const BASE_W = 220;
const BASE_H = 96;

export default function OverlayPage() {
  const [fps, setFps] = useState<number | null>(null);
  const [engineOn, setEngineOn] = useState(false);
  const [activeMap, setActiveMap] = useState<Map<string, string>>(new Map());
  const [cfg, setCfg] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [pass, setPass] = useState(false);

  const activeCount = activeMap.size;
  const activeNames = Array.from(activeMap.values());

  // 배경 투명화
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { h: html.style.background, b: body.style.background, o: body.style.overflow };
    html.style.background = "transparent";
    body.style.background = "transparent";
    body.style.overflow = "hidden";
    return () => {
      html.style.background = prev.h;
      body.style.background = prev.b;
      body.style.overflow = prev.o;
    };
  }, []);

  // FPS 모니터 워치독 — 오버레이가 열려 있는 동안 모니터가 죽으면 10초 주기로 재시작 보장
  useEffect(() => {
    const t = setInterval(() => void fpsEnsure(), 10_000);
    return () => clearInterval(t);
  }, []);

  // 설정 초기값 + 메인 푸시 구독
  useEffect(() => {
    setCfg(useMacroStore.getState().overlayConfig ?? DEFAULT_OVERLAY_CONFIG);
    let alive = true;
    let un: (() => void) | undefined;
    onOverlayConfig((c) => setCfg(c)).then((u) => (alive ? (un = u) : u()));
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  // FPS
  useEffect(() => {
    let alive = true;
    let un: (() => void) | undefined;
    onFps((v) => setFps(v)).then((u) => (alive ? (un = u) : u()));
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  // 엔진 ON/OFF
  useEffect(() => {
    let alive = true;
    void isEngineRunning().then((on) => alive && setEngineOn(on));
    let un: (() => void) | undefined;
    onRunningChanged((on) => setEngineOn(on)).then((u) => (alive ? (un = u) : u()));
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  // 실행중 매크로 추적 (active count)
  useEffect(() => {
    let alive = true;
    let un: (() => void) | undefined;
    onSetActive((id, active) =>
      setActiveMap((prev) => {
        const n = new Map(prev);
        if (active) {
          const name = useMacroStore.getState().sets.find((s) => s.id === id)?.name ?? id;
          n.set(id, name);
        } else {
          n.delete(id);
        }
        return n;
      })
    ).then((u) => (alive ? (un = u) : u()));
    return () => {
      alive = false;
      un?.();
    };
  }, []);
  // 엔진 OFF 시 실행중 표시 초기화
  useEffect(() => {
    if (!engineOn) setActiveMap(new Map());
  }, [engineOn]);

  // 위치 복원 + 이동/리사이즈 저장
  useEffect(() => {
    let alive = true;
    const unsubs: Array<() => void> = [];
    (async () => {
      try {
        const { getCurrentWindow, PhysicalPosition } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const st = useMacroStore.getState();
        if (st.overlayPos) await win.setPosition(new PhysicalPosition(st.overlayPos.x, st.overlayPos.y));
        if (!alive) return;
        const offMoved = await win.onMoved(({ payload }) =>
          useMacroStore.getState().setOverlayPos(payload.x, payload.y)
        );
        const offResized = await win.onResized(({ payload }) => {
          const sf = window.devicePixelRatio || 1;
          useMacroStore.getState().setOverlaySize(payload.width / sf, payload.height / sf);
        });
        unsubs.push(offMoved, offResized);
      } catch {
        /* 브라우저 폴백 */
      }
    })();
    return () => {
      alive = false;
      unsubs.forEach((f) => f());
    };
  }, []);

  // 스케일 → 창 크기
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
        if (cancelled) return;
        await getCurrentWindow().setSize(new LogicalSize(BASE_W * cfg.scale, BASE_H * cfg.scale));
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cfg.scale]);

  function togglePass() {
    const next = !pass;
    setPass(next);
    void setOverlayPassthrough(next);
  }

  function toggleEngine() {
    const next = !engineOn;
    setEngineOn(next);
    void setEngineRunning(next);
  }

  const panelBg = `rgba(0,0,0,${cfg.bgOpacity})`;
  const valueFont = `${1.25 * cfg.textScale}rem`;
  const labelFont = `${0.5625 * cfg.textScale}rem`;

  // 엔진 카드 상태: 실행중 > ON > OFF
  const isActive = activeCount > 0;
  const engColor = isActive ? cfg.activeColor : engineOn ? cfg.engineOnColor : cfg.engineOffColor;
  const engBg = isActive ? `${cfg.activeColor}33` : engineOn ? `${cfg.engineOnColor}22` : panelBg;
  const engBorder = isActive ? `1px solid ${cfg.activeColor}` : "1px solid transparent";
  const engText = engineOn ? "ON" : "OFF";

  return (
    <div
      className="group flex select-none flex-col gap-1 p-2 text-white"
      style={{ width: BASE_W, height: BASE_H, transform: `scale(${cfg.scale})`, transformOrigin: "top left" }}
    >
      {/* 제목창 — 평소 숨김, 마우스 오버(활성) 시 표시 */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-1 rounded-md px-2 py-1 opacity-0 backdrop-blur transition-opacity duration-150 group-hover:opacity-100"
        style={{ background: panelBg }}
      >
        <span data-tauri-drag-region className="flex-1 cursor-move text-[11px] font-bold text-white/80">
          🐼 PANDA KEY
        </span>
        {/* 클릭 통과 토글 (X 왼쪽) */}
        <button
          type="button"
          onClick={togglePass}
          title={pass ? "클릭 통과 ON (해제는 메인 창에서)" : "클릭 통과 — 마우스를 게임으로 전달"}
          className="rounded p-0.5 transition-colors hover:bg-white/10"
          style={{ color: pass ? cfg.activeColor : "rgba(255,255,255,0.7)" }}
        >
          <MousePointerClick className="h-3.5 w-3.5" />
        </button>
        {/* 닫기 */}
        <button
          type="button"
          onClick={() => void closeOverlay()}
          title="오버레이 닫기"
          className="rounded p-0.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 지표 */}
      <div className="grid flex-1 grid-cols-2 gap-1">
        {/* FPS */}
        <div
          className="flex flex-col items-center justify-center rounded-md backdrop-blur"
          style={{ background: panelBg }}
          title={
            fps != null && fps < 0
              ? "PresentMon 미설치 — 인게임 FPS 측정 불가"
              : "포그라운드 게임 실측 FPS (PresentMon)"
          }
        >
          <div
            className="flex items-center gap-1 font-bold uppercase tracking-wide text-white/50"
            style={{ fontSize: labelFont }}
          >
            <Gauge className="h-2.5 w-2.5" /> FPS
          </div>
          <div className="font-extrabold leading-none tabular-nums" style={{ fontSize: valueFont, color: cfg.accent }}>
            {fps == null ? "…" : fps < 0 ? "—" : Math.round(fps)}
          </div>
        </div>
        {/* 엔진 (OFF / ON / 실행중) — 클릭으로 ON↔OFF 전환 */}
        <button
          type="button"
          onClick={toggleEngine}
          className="flex flex-col items-center justify-center rounded-md backdrop-blur transition-colors w-full h-full cursor-pointer hover:brightness-110 active:brightness-90"
          style={{ background: engBg, border: engBorder }}
          title={isActive ? activeNames.join(" / ") : engineOn ? "클릭하여 엔진 OFF" : "클릭하여 엔진 ON"}
        >
          <div
            className="flex items-center gap-1 font-bold uppercase tracking-wide text-white/50"
            style={{ fontSize: labelFont }}
          >
            <Power className="h-2.5 w-2.5" /> 엔진
          </div>
          {isActive ? (
            <div className="flex w-full flex-col items-center gap-0.5 overflow-hidden px-1">
              {activeNames.slice(0, 2).map((name, i) => {
                const isMore = i === 1 && activeNames.length > 2;
                return (
                  <div
                    key={i}
                    className="w-full truncate text-center font-bold leading-tight"
                    style={{ fontSize: `${0.68 * cfg.textScale}rem`, color: engColor }}
                  >
                    {isMore ? `+${activeNames.length - 1}개` : name}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="font-extrabold leading-none tabular-nums" style={{ fontSize: valueFont, color: engColor }}>
              {engText}
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
