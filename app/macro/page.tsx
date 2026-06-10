"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Plus,
  Power,
  Square,
  KeyboardOff,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  MonitorCheck,
  Crosshair,
  Settings2,
  Layers,
  Monitor,
  Download,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useMacroStore } from "@/lib/macro/store";
import { useMacroRuntime } from "@/lib/macro/runtime";
import {
  panicStop,
  isTauri,
  physicalAvailable,
  getForegroundProcess,
  listWindows,
  emitOverlayConfig,
  installDriver,
  uninstallDriver,
  openUrl,
} from "@/lib/tauri";
import { showToast } from "@/lib/utils";
import { MacroSetCard } from "@/components/macro/macro-set-card";
import { HotkeyCaptureButton } from "@/components/macro/hotkey-capture-button";
import { SaveLoad } from "@/components/macro/save-load";
import { PresetsPanel } from "@/components/macro/presets-panel";
import { DelayPresetCard } from "@/components/macro/delay-preset-card";

export default function MacroPage() {
  const sets = useMacroStore((s) => s.sets);
  const engineOn = useMacroStore((s) => s.engineOn);
  const setEngineOn = useMacroStore((s) => s.setEngineOn);
  const addSet = useMacroStore((s) => s.addSet);
  const physicalInput = useMacroStore((s) => s.physicalInput);
  const setPhysicalInput = useMacroStore((s) => s.setPhysicalInput);
  const targetProcess = useMacroStore((s) => s.targetProcess);
  const setTargetProcess = useMacroStore((s) => s.setTargetProcess);
  const minCycleMs = useMacroStore((s) => s.minCycleMs);
  const setMinCycleMs = useMacroStore((s) => s.setMinCycleMs);
  const hotkeyMode = useMacroStore((s) => s.hotkeyMode);
  const setHotkeyMode = useMacroStore((s) => s.setHotkeyMode);
  const hotkeyOn = useMacroStore((s) => s.hotkeyOn);
  const hotkeyOff = useMacroStore((s) => s.hotkeyOff);
  const setHotkeys = useMacroStore((s) => s.setHotkeys);
  const hotkeyToggle = useMacroStore((s) => s.hotkeyToggle);
  const setHotkeyToggle = useMacroStore((s) => s.setHotkeyToggle);
  const execMode = useMacroStore((s) => s.execMode);
  const setExecMode = useMacroStore((s) => s.setExecMode);
  const allowDuplicateTriggers = useMacroStore((s) => s.allowDuplicateTriggers);
  const setAllowDupTriggers = useMacroStore((s) => s.setAllowDupTriggers);
  const overlayConfig = useMacroStore((s) => s.overlayConfig);
  const setOverlayConfig = useMacroStore((s) => s.setOverlayConfig);
  const delayPresets = useMacroStore((s) => s.delayPresets);
  const addDelayPreset = useMacroStore((s) => s.addDelayPreset);
  const updateDelayPreset = useMacroStore((s) => s.updateDelayPreset);
  const removeDelayPreset = useMacroStore((s) => s.removeDelayPreset);
  const fpsAutoDelayEnabled = useMacroStore((s) => s.fpsAutoDelayEnabled);
  const setFpsAutoDelayEnabled = useMacroStore((s) => s.setFpsAutoDelayEnabled);
  const currentFps = useMacroRuntime((s) => s.currentFps);
  const autoDelayLog = useMacroRuntime((s) => s.autoDelayLog);
  const activeCount = useMacroRuntime((s) => Object.keys(s.activeIds).length);
  const router = useRouter();

  // ── 설정 모달 draft 타입 ─────────────────────────────────────
  type SettingsDraft = {
    targetProcess: string;
    minCycleMs: number;
    execMode: "concurrent" | "exclusive";
    allowDuplicateTriggers: boolean;
    hotkeyMode: "separate" | "toggle";
    hotkeyOn: string;
    hotkeyOff: string;
    hotkeyToggle: string;
    overlayConfig: {
      accent: string; bgOpacity: number; textScale: number; scale: number;
      engineOnColor: string; engineOffColor: string; activeColor: string;
    };
  };

  const [driverOk, setDriverOk] = useState<boolean | null>(null);
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [installMsg, setInstallMsg] = useState<string>("");
  const [installing, setInstalling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const savedDraftRef = useRef<string>("");
  const [showPresets, setShowPresets] = useState(false);
  const [processList, setProcessList] = useState<string[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);

  async function loadProcessList() {
    setLoadingProcesses(true);
    try {
      const list = await listWindows();
      setProcessList(list);
    } finally {
      setLoadingProcesses(false);
    }
  }

  function buildDraft(): SettingsDraft {
    return {
      targetProcess,
      minCycleMs,
      execMode,
      allowDuplicateTriggers,
      hotkeyMode,
      hotkeyOn,
      hotkeyOff,
      hotkeyToggle,
      overlayConfig: { ...overlayConfig },
    };
  }

  function openSettings() {
    const d = buildDraft();
    savedDraftRef.current = JSON.stringify(d);
    setDraft(d);
    setShowCloseConfirm(false);
    setSettingsOpen(true);
    void loadProcessList();
  }

  function hasDraftChanges(): boolean {
    if (!draft) return false;
    return JSON.stringify(draft) !== savedDraftRef.current;
  }

  function applyDraft() {
    if (!draft) return;
    setTargetProcess(draft.targetProcess);
    setMinCycleMs(draft.minCycleMs);
    setExecMode(draft.execMode);
    setAllowDupTriggers(draft.allowDuplicateTriggers);
    setHotkeyMode(draft.hotkeyMode);
    setHotkeys(draft.hotkeyOn, draft.hotkeyOff);
    setHotkeyToggle(draft.hotkeyToggle);
    setOverlayConfig(draft.overlayConfig);
    void emitOverlayConfig(draft.overlayConfig);
    savedDraftRef.current = JSON.stringify(draft);
    setShowCloseConfirm(false);
    showToast("설정이 적용되었습니다");
  }

  function handleCloseSettings() {
    if (hasDraftChanges()) {
      setShowCloseConfirm(true);
    } else {
      setSettingsOpen(false);
      setDraft(null);
    }
  }

  function closeWithSave() {
    applyDraft();
    setSettingsOpen(false);
    setDraft(null);
    setShowCloseConfirm(false);
    showToast("설정 저장 및 닫기");
  }

  function closeWithoutSave() {
    // 오버레이 프리뷰 되돌리기
    if (draft) {
      const orig = JSON.parse(savedDraftRef.current) as SettingsDraft;
      if (JSON.stringify(draft.overlayConfig) !== JSON.stringify(orig.overlayConfig)) {
        void emitOverlayConfig(overlayConfig);
      }
    }
    setSettingsOpen(false);
    setDraft(null);
    setShowCloseConfirm(false);
  }

  async function fillCurrentWindow() {
    const p = await getForegroundProcess();
    if (p) {
      setDraft((d) => d ? { ...d, targetProcess: p } : d);
      showToast(`현재 창: ${p}`);
    } else {
      showToast("현재 창을 가져올 수 없습니다");
    }
  }

  // 오버레이 draft 실시간 프리뷰
  function patchDraftOverlay(patch: Partial<SettingsDraft["overlayConfig"]>) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d.overlayConfig, ...patch };
      void emitOverlayConfig(next);
      return { ...d, overlayConfig: next };
    });
  }

  // ESC = 긴급 정지 (단축키 캡처 중이면 HotkeyCaptureButton이 먼저 소비)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.repeat && !driverDialogOpen && !settingsOpen) {
        void panicStop();
        showToast("긴급 정지 (ESC)");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [driverDialogOpen, settingsOpen]);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Interception 드라이버 가용성 확인 (마운트 + 물리 모드 토글 시)
  useEffect(() => {
    let alive = true;
    physicalAvailable().then((ok) => alive && setDriverOk(ok));
    return () => {
      alive = false;
    };
  }, [physicalInput]);

  function togglePhysical() {
    const next = !physicalInput;
    setPhysicalInput(next);
    if (next) {
      physicalAvailable().then((ok) => {
        setDriverOk(ok);
        if (ok) {
          showToast("물리 입력 모드 ON — 드라이버로 주입");
        } else {
          // 드라이버 미설치 → 설치 안내 팝업
          setInstallMsg("");
          setDriverDialogOpen(true);
        }
      });
    } else {
      showToast("물리 입력 모드 OFF");
    }
  }

  async function handleInstallDriver() {
    setInstalling(true);
    const msg = await installDriver();
    setInstallMsg(msg);
    setInstalling(false);
  }

  const usableCount = sets.filter((s) => s.enabled && s.trigger && s.steps.some((x) => x.input)).length;

  function openEdit(id: string) {
    router.push(`/macro/edit?id=${encodeURIComponent(id)}`);
  }
  function onAdd() {
    const id = addSet();
    openEdit(id);
  }
  function toggleEngine() {
    const next = !engineOn;
    if (next && usableCount === 0) {
      showToast("실행 가능한 매크로 세트가 없습니다.");
      return;
    }
    setEngineOn(next);
    showToast(next ? "엔진 ON — 트리거 감지 시작" : "엔진 OFF");
  }

  if (!hydrated) return <div className="text-muted-foreground">로딩 중…</div>;

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <span>⌨</span> 매크로
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus className="h-4 w-4" /> 매크로 추가
          </Button>
          <SaveLoad />
          <Button
            size="sm"
            variant={showPresets ? "default" : "outline"}
            onClick={() => setShowPresets((v) => !v)}
            title="프리셋 관리 — 매크로 세트 활성화/비활성화 로드아웃"
          >
            <Layers className="h-4 w-4" /> 프리셋
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={openSettings}
            title="활성 창 제한 · 단축키 · 최소 주기"
          >
            <Settings2 className="h-4 w-4" /> 설정
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void panicStop();
              showToast("모든 매크로 정지");
            }}
            title="실행 중인 모든 매크로 즉시 정지 (단축키: ESC)"
          >
            <Square className="h-4 w-4" /> 긴급 정지
            <kbd className="ml-1 rounded border border-input bg-muted px-1 text-[10px] font-normal text-muted-foreground">ESC</kbd>
          </Button>
          {/* 물리 입력(드라이버) 토글 */}
          <button
            type="button"
            onClick={togglePhysical}
            title="Interception 드라이버로 주입 — 게임이 실제 키보드 입력으로 인식 (드라이버 설치 필요)"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold transition-colors",
              physicalInput
                ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
                : "border-input text-muted-foreground hover:text-foreground"
            )}
          >
            <Cpu className="h-3.5 w-3.5" />
            물리 입력
          </button>
          {/* 엔진 마스터 토글 */}
          <button
            type="button"
            onClick={toggleEngine}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-extrabold transition-colors",
              engineOn
                ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))]"
                : "border-input text-muted-foreground hover:text-foreground"
            )}
          >
            <Power className={cn("h-4 w-4", engineOn && "animate-pulse")} />
            {engineOn ? "엔진 ON" : "엔진 OFF"}
          </button>
        </div>
      </div>

      {/* 상태 줄 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-bold",
            engineOn
              ? "border-[hsl(var(--cat-macro))]/40 text-[hsl(var(--cat-macro))]"
              : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              engineOn ? "bg-[hsl(var(--cat-macro))] animate-pulse" : "bg-muted"
            )}
          />
          {engineOn ? `감지 중 · 실행 ${activeCount}` : "정지"}
        </span>
        <span className="text-muted-foreground">
          사용 가능 세트 {usableCount} / 전체 {sets.length}
        </span>
        {!isTauri() && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 px-2.5 py-1 font-bold text-amber-500">
            <KeyboardOff className="h-3 w-3" /> 브라우저 모드 — 실제 입력 주입은 앱(.exe)에서만 동작
          </span>
        )}
        {isTauri() && physicalInput && (
          driverOk ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 px-2.5 py-1 font-bold text-emerald-400">
              <ShieldCheck className="h-3 w-3" /> 물리 입력 — 드라이버 활성(실제 키보드로 인식)
            </span>
          ) : (
            <button
              type="button"
              onClick={() => { setInstallMsg(""); setDriverDialogOpen(true); }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-amber-500/40 px-2.5 py-1 font-bold text-amber-500 transition-colors hover:border-amber-500/70 hover:bg-amber-500/10"
              title="클릭하면 드라이버 설치 안내"
            >
              <ShieldAlert className="h-3 w-3" /> 드라이버 미설치 — 클릭하여 설치
            </button>
          )
        )}
      </div>

      {/* 설정 모달 */}
      {draft && (
        <Dialog open={settingsOpen} onOpenChange={(open) => { if (!open) handleCloseSettings(); }}>
          <DialogContent className="max-w-3xl overflow-hidden p-0">
            <div className="flex flex-col max-h-[90vh]">
            <DialogHeader className="px-6 pt-6 pb-4 border-b">
              <DialogTitle>설정</DialogTitle>
              <DialogDescription>매크로 엔진 동작 방식과 오버레이를 구성합니다.</DialogDescription>
            </DialogHeader>

            <div className="overflow-y-auto flex-1 px-6 py-5">
            <div className="space-y-0 rounded-lg border bg-card">

          {/* ── 섹션 1: 활성 창 제한 + 반복 주기 ───────────── */}
          <div className="grid grid-cols-1 gap-5 p-4 md:grid-cols-3">

            {/* 활성 창 제한 */}
            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-xs font-bold">
                  <MonitorCheck className="h-3.5 w-3.5" /> 활성 창 제한
                </Label>
                <span className={cn(
                  "text-[10px] font-semibold rounded-full border px-2 py-0.5 tabular-nums",
                  draft.targetProcess
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-input text-muted-foreground"
                )}>
                  {draft.targetProcess ? `제한 중 — ${draft.targetProcess}` : "제한 없음 (모든 창에서 동작)"}
                </span>
              </div>

              {/* 입력 + 버튼 행 */}
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Input
                    value={draft.targetProcess}
                    onChange={(e) => setDraft((d) => d ? { ...d, targetProcess: e.target.value } : d)}
                    placeholder="예: AION2.exe   (비우면 모든 창에서 동작)"
                    className="h-8"
                    list="running-proc-datalist"
                  />
                  <datalist id="running-proc-datalist">
                    {processList.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <Button
                  size="sm" variant="outline" className="shrink-0"
                  onClick={() => void loadProcessList()}
                  disabled={loadingProcesses}
                  title="실행 중인 앱 목록 새로고침 (클릭 후 입력창에서 선택)"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingProcesses && "animate-spin")} />
                </Button>
                <Button
                  size="sm" variant="outline" className="shrink-0"
                  onClick={fillCurrentWindow}
                  title="현재 포그라운드 창의 프로세스명 자동 입력"
                >
                  <Crosshair className="h-3.5 w-3.5" /> 현재 창
                </Button>
              </div>

              {/* 프리셋 버튼 행 */}
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px]"
                  onClick={() => setDraft((d) => d ? { ...d, targetProcess: "AION2.exe" } : d)}
                >
                  기본값 (AION2.exe)
                </Button>
                {draft.targetProcess && (
                  <Button
                    size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground"
                    onClick={() => setDraft((d) => d ? { ...d, targetProcess: "" } : d)}
                  >
                    제한없음 (해제)
                  </Button>
                )}
              </div>

              <p className="text-[11px] text-muted-foreground">
                지정한 프로그램이 <strong className="text-foreground">포그라운드(활성 창)</strong>일 때만 매크로가 동작합니다.
                새로고침 버튼을 누른 뒤 입력창을 클릭하면 실행 중인 앱 목록에서 선택할 수 있습니다.
              </p>
            </div>

            {/* 반복 최소 주기 */}
            <div className="space-y-2">
              <Label className="text-xs font-bold">반복 최소 주기</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={1} step={1}
                  value={draft.minCycleMs}
                  onChange={(e) => setDraft((d) => d ? { ...d, minCycleMs: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : d)}
                  className="h-8 w-20 tabular-nums"
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
              {/* fps 환산 */}
              <div className="text-[11px] tabular-nums text-muted-foreground">
                ≈ <strong className="text-foreground">{(1000 / draft.minCycleMs).toFixed(1)}</strong>fps
              </div>
              {/* 빠른 프리셋 */}
              <div className="flex flex-wrap gap-1">
                {([10, 16, 30, 50] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setDraft((d) => d ? { ...d, minCycleMs: v } : d)}
                    className={cn(
                      "rounded border px-2.5 py-0.5 text-[11px] font-bold transition-colors",
                      draft.minCycleMs === v
                        ? "border-[hsl(var(--cat-macro))]/60 bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))]"
                        : "border-input text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                    )}
                  >
                    {v}ms{v === 16 ? " ★" : ""}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                반복 모드 한 사이클 최소 시간.<br />
                작을수록 빠르지만 렉 유발 가능 (권장 16ms = 62.5fps).
              </p>
            </div>
          </div>

          <div className="border-t mx-4" />

          {/* ── 섹션 2: 다중 실행 모드 ──────────────────────── */}
          <div className="space-y-3 p-4">
            <div>
              <Label className="text-xs font-bold">다중 실행 모드</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                두 개 이상의 매크로 키를 동시에 누르고 있을 때의 동작 방식입니다.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {/* 동시 실행 */}
              <button
                type="button"
                onClick={() => setDraft((d) => d ? { ...d, execMode: "concurrent" } : d)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  draft.execMode === "concurrent"
                    ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/10"
                    : "border-input hover:bg-accent/10"
                )}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={cn("text-xs font-bold", draft.execMode === "concurrent" && "text-[hsl(var(--cat-macro))]")}>
                    동시 실행
                  </span>
                  {draft.execMode === "concurrent" && (
                    <span className="rounded bg-[hsl(var(--cat-macro))]/20 px-1.5 py-0.5 text-[10px] font-bold text-[hsl(var(--cat-macro))]">사용 중</span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  매크로A 실행 중(누르고 있는 중) 매크로B 키를 누르면{" "}
                  <strong className="text-foreground">A·B가 동시에 작동</strong>됩니다.
                </p>
              </button>

              {/* 순차 실행 */}
              <button
                type="button"
                onClick={() => setDraft((d) => d ? { ...d, execMode: "exclusive" } : d)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  draft.execMode === "exclusive"
                    ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/10"
                    : "border-input hover:bg-accent/10"
                )}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={cn("text-xs font-bold", draft.execMode === "exclusive" && "text-[hsl(var(--cat-macro))]")}>
                    순차 실행 (권장)
                  </span>
                  {draft.execMode === "exclusive" && (
                    <span className="rounded bg-[hsl(var(--cat-macro))]/20 px-1.5 py-0.5 text-[10px] font-bold text-[hsl(var(--cat-macro))]">사용 중</span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  매크로A 실행 중(누르고 있는 중) 매크로B 키를 누르면{" "}
                  <strong className="text-foreground">A가 일시정지</strong>되고 B가 먼저 실행됩니다.
                  B 입력 종료 시, 계속 누르고 있던{" "}
                  <strong className="text-foreground">A가 자동 재개</strong>됩니다.
                </p>
              </button>
            </div>
          </div>

          <div className="border-t mx-4" />

          {/* ── 섹션 2b: 트리거키 중복 허용 ─────────────────── */}
          <div className="space-y-3 p-4">
            <div>
              <Label className="text-xs font-bold">트리거키 중복 허용</Label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                같은 트리거 키에 여러 매크로가 할당된 경우의 동작 방식입니다.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setDraft((d) => d ? { ...d, allowDuplicateTriggers: false } : d)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  !draft.allowDuplicateTriggers
                    ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/10"
                    : "border-input hover:bg-accent/10"
                )}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={cn("text-xs font-bold", !draft.allowDuplicateTriggers && "text-[hsl(var(--cat-macro))]")}>
                    단일 실행 (권장)
                  </span>
                  {!draft.allowDuplicateTriggers && (
                    <span className="rounded bg-[hsl(var(--cat-macro))]/20 px-1.5 py-0.5 text-[10px] font-bold text-[hsl(var(--cat-macro))]">사용 중</span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  같은 트리거 키는 <strong className="text-foreground">가장 마지막에 활성화된 세트 하나</strong>만 동작합니다.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setDraft((d) => d ? { ...d, allowDuplicateTriggers: true } : d)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  draft.allowDuplicateTriggers
                    ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/10"
                    : "border-input hover:bg-accent/10"
                )}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className={cn("text-xs font-bold", draft.allowDuplicateTriggers && "text-[hsl(var(--cat-macro))]")}>
                    중복 실행
                  </span>
                  {draft.allowDuplicateTriggers && (
                    <span className="rounded bg-[hsl(var(--cat-macro))]/20 px-1.5 py-0.5 text-[10px] font-bold text-[hsl(var(--cat-macro))]">사용 중</span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  같은 트리거 키에 할당된 매크로가 <strong className="text-foreground">모두 동시 실행</strong>됩니다.
                  위 다중 실행 모드가 순차 실행이어도 항상 동시 실행됩니다.
                </p>
              </button>
            </div>
          </div>

          <div className="border-t mx-4" />

          {/* ── 섹션 3: 전체 ON/OFF 단축키 ──────────────────── */}
          <div className="space-y-3 p-4">
            <Label className="text-xs font-bold">전체 ON/OFF 단축키</Label>
            <div className="flex gap-2">
              {(
                [
                  { v: "separate", label: "개별 단축키", desc: "ON 키 / OFF 키 따로 지정" },
                  { v: "toggle",   label: "통합 토글",   desc: "한 키로 ON↔OFF 전환" },
                ] as const
              ).map((m) => (
                <button
                  key={m.v}
                  type="button"
                  onClick={() => setDraft((d) => d ? { ...d, hotkeyMode: m.v } : d)}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-left transition-colors",
                    draft.hotkeyMode === m.v
                      ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/15"
                      : "border-input hover:bg-accent/10"
                  )}
                >
                  <div className={cn("text-xs font-bold", draft.hotkeyMode === m.v && "text-[hsl(var(--cat-macro))]")}>
                    {m.label}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{m.desc}</div>
                </button>
              ))}
            </div>

            {draft.hotkeyMode === "separate" && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-8 text-right text-xs text-muted-foreground">ON</span>
                  <HotkeyCaptureButton value={draft.hotkeyOn} onCapture={(c) => setDraft((d) => d ? { ...d, hotkeyOn: c } : d)} placeholder="ON 단축키" />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-8 text-right text-xs text-muted-foreground">OFF</span>
                  <HotkeyCaptureButton value={draft.hotkeyOff} onCapture={(c) => setDraft((d) => d ? { ...d, hotkeyOff: c } : d)} placeholder="OFF 단축키" />
                </div>
                <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d ? { ...d, hotkeyOn: "Home", hotkeyOff: "End" } : d)}>기본값 (Home / End)</Button>
              </div>
            )}
            {draft.hotkeyMode === "toggle" && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-8 text-right text-xs text-muted-foreground">토글</span>
                  <HotkeyCaptureButton value={draft.hotkeyToggle} onCapture={(c) => setDraft((d) => d ? { ...d, hotkeyToggle: c } : d)} placeholder="토글 단축키" />
                </div>
                <Button size="sm" variant="ghost" onClick={() => setDraft((d) => d ? { ...d, hotkeyToggle: "Home" } : d)}>기본값 (Home)</Button>
              </div>
            )}
            {(() => {
              const triggers = new Set(sets.filter((s) => s.enabled && s.trigger).map((s) => s.trigger));
              const hotkeys = draft.hotkeyMode === "separate"
                ? [draft.hotkeyOn, draft.hotkeyOff].filter(Boolean)
                : [draft.hotkeyToggle].filter(Boolean);
              const conflicts = hotkeys.filter((k) => triggers.has(k));
              return conflicts.length > 0 ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    단축키({conflicts.join(", ")})가 활성화된 매크로 트리거와 겹칩니다.
                    겹치는 키를 누르면 단축키와 매크로가 동시에 발동될 수 있습니다. 다른 키를 사용하세요.
                  </span>
                </div>
              ) : null;
            })()}
            <p className="text-[11px] text-muted-foreground">
              엔진이 꺼진 상태에서도 동작하는 전역 단축키입니다. 수식키 조합 가능(예: Shift+Home).
              버튼을 누른 뒤 원하는 키를 입력하면 자동 등록됩니다.
            </p>
          </div>

          <div className="border-t mx-4" />

          {/* ── 섹션 4: 오버레이 표시 ───────────────────────── */}
          <div className="space-y-3 p-4">
            <Label className="flex items-center gap-1.5 text-xs font-bold">
              <Monitor className="h-3.5 w-3.5" /> 오버레이 표시
            </Label>

            {/* 색상 */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">색상</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    { key: "accent",        label: "FPS 숫자",   value: draft.overlayConfig.accent,        onChange: (v: string) => patchDraftOverlay({ accent: v }) },
                    { key: "engineOnColor", label: "엔진 ON",    value: draft.overlayConfig.engineOnColor,  onChange: (v: string) => patchDraftOverlay({ engineOnColor: v }) },
                    { key: "engineOffColor",label: "엔진 OFF",   value: draft.overlayConfig.engineOffColor, onChange: (v: string) => patchDraftOverlay({ engineOffColor: v }) },
                    { key: "activeColor",   label: "실행 중 강조", value: draft.overlayConfig.activeColor,   onChange: (v: string) => patchDraftOverlay({ activeColor: v }) },
                  ] as const
                ).map((c) => (
                  <div key={c.key} className="flex items-center gap-2 rounded-md border bg-background/40 px-2 py-1.5">
                    <input
                      type="color"
                      value={c.value}
                      onChange={(e) => c.onChange(e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <div>
                      <div className="text-[11px] font-semibold">{c.label}</div>
                      <div className="text-[10px] tabular-nums text-muted-foreground">{c.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 슬라이더 */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">크기 및 투명도</p>
              <div className="space-y-2">
                {(
                  [
                    { label: "배경 투명도", min: 0,   max: 1,   step: 0.05, value: draft.overlayConfig.bgOpacity,  fmt: (v: number) => `${Math.round(v * 100)}%`,  onChange: (v: number) => patchDraftOverlay({ bgOpacity: v }) },
                    { label: "텍스트 크기", min: 0.6, max: 2.5, step: 0.1,  value: draft.overlayConfig.textScale,  fmt: (v: number) => `${v.toFixed(1)}x`,           onChange: (v: number) => patchDraftOverlay({ textScale: v }) },
                    { label: "전체 스케일", min: 0.5, max: 3,   step: 0.1,  value: draft.overlayConfig.scale,      fmt: (v: number) => `${v.toFixed(1)}x`,           onChange: (v: number) => patchDraftOverlay({ scale: v }) },
                  ] as const
                ).map((s) => (
                  <div key={s.label} className="rounded-md border bg-background/40 px-3 py-2">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold">{s.label}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{s.fmt(s.value)}</span>
                    </div>
                    <input
                      type="range" min={s.min} max={s.max} step={s.step} value={s.value}
                      onChange={(e) => s.onChange(Number(e.target.value))}
                      className="h-2 w-full accent-[hsl(var(--cat-macro))]"
                    />
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              오버레이가 열려 있으면 즉시 반영됩니다. 창 위치·크기는 이동·조절 시 자동 저장됩니다.
            </p>
          </div>

          <div className="border-t mx-4" />

          {/* ── 섹션 5: FPS 자동 딜레이 프리셋 ─────────────── */}
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label className="flex items-center gap-1.5 text-xs font-bold">
                  <Activity className="h-3.5 w-3.5" /> FPS 자동 딜레이
                </Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  인게임 FPS 구간별 딜레이를 정의합니다. 매크로 편집기에서 세트별 지연 모드를 <strong className="text-foreground">자동</strong>으로 설정하면 적용됩니다.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {fpsAutoDelayEnabled && currentFps > 0 && (
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold tabular-nums text-emerald-400">
                    현재 {currentFps} fps
                  </span>
                )}
                <label className="flex items-center gap-1.5 text-[11px] font-bold">
                  <Switch checked={fpsAutoDelayEnabled} onCheckedChange={setFpsAutoDelayEnabled} />
                  {fpsAutoDelayEnabled ? "ON" : "OFF"}
                </label>
              </div>
            </div>

            {!fpsAutoDelayEnabled && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
                꺼짐 — 자동 프리셋이 지정된 세트도 표준/개별 지연으로 동작하며 FPS 측정도 중단됩니다 (오버레이 표시는 별도).
              </p>
            )}

            <div className={cn("space-y-2", !fpsAutoDelayEnabled && "pointer-events-none opacity-50")}>
              {delayPresets.map((preset) => (
                <DelayPresetCard
                  key={preset.id}
                  preset={preset}
                  currentFps={currentFps}
                  onUpdate={(patch) => updateDelayPreset(preset.id, patch)}
                  onRemove={() => removeDelayPreset(preset.id)}
                />
              ))}
            </div>

            <Button
              size="sm"
              variant="outline"
              disabled={!fpsAutoDelayEnabled}
              onClick={() => addDelayPreset(`프리셋 ${delayPresets.length}`)}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> 프리셋 추가
            </Button>
            <p className="text-[11px] text-muted-foreground">
              <strong className="text-foreground">자동 (권장)</strong>은 항상 보존됩니다. 프리셋 이름을 클릭하면 구간을 펼쳐 확인하거나 편집할 수 있습니다.
              FPS 미측정 시에는 60fps 로 가정하여 적용됩니다.
            </p>

            {/* 적용 이력 — 검증용 */}
            {autoDelayLog.length > 0 && (
              <div className="rounded-md border bg-background/40 px-3 py-2">
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">자동 딜레이 적용 이력 (최근 {Math.min(autoDelayLog.length, 5)}건)</p>
                <div className="space-y-0.5">
                  {autoDelayLog.slice(0, 5).map((entry, i) => (
                    <div key={entry.at} className={cn("flex items-center gap-2 text-[11px] tabular-nums", i === 0 ? "text-foreground" : "text-muted-foreground")}>
                      <span className="w-16">{new Date(entry.at).toLocaleTimeString("ko-KR", { hour12: false })}</span>
                      <span className="w-16 text-emerald-400">{entry.fps} fps</span>
                      <span>→</span>
                      <span className="font-bold">{entry.delayMs}ms</span>
                      {i === 0 && <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-400">현재</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t mx-4" />

          {/* ── 섹션 6: 드라이버 관리 ───────────────────────── */}
          <div className="space-y-2 p-4">
            <Label className="flex items-center gap-1.5 text-xs font-bold">
              <Cpu className="h-3.5 w-3.5" /> Interception 드라이버
            </Label>
            <div className="flex items-center justify-between gap-3 rounded-md border bg-background/40 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                물리 입력 모드용 커널 드라이버입니다.
                {driverOk
                  ? " 현재 활성 상태입니다."
                  : " 현재 비활성(미설치 또는 재부팅 대기) 상태입니다."}
                {" "}제거 후에는 재부팅이 필요하며, 물리 입력 모드는 사용할 수 없게 됩니다.
              </p>
              <div className="flex shrink-0 gap-1.5">
                {!driverOk && (
                  <Button
                    size="sm" variant="outline" className="h-7 text-[11px]"
                    onClick={() => { setInstallMsg(""); setDriverDialogOpen(true); }}
                  >
                    설치
                  </Button>
                )}
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-[11px] text-destructive hover:bg-destructive/10"
                  onClick={async () => {
                    if (!confirm("Interception 드라이버를 제거할까요?\n물리 입력 모드를 사용할 수 없게 되며, 완전 제거에는 재부팅이 필요합니다.")) return;
                    const msg = await uninstallDriver();
                    showToast(msg);
                    setDriverOk(await physicalAvailable());
                  }}
                >
                  드라이버 제거
                </Button>
              </div>
            </div>
          </div>

            </div>
            </div>
            <DialogFooter className="px-6 py-4 border-t">
              {showCloseConfirm ? (
                <div className="flex w-full items-center justify-between gap-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                  <span className="text-sm text-amber-400">변경사항이 적용되지 않았습니다.</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={closeWithoutSave}>저장하지 않고 닫기</Button>
                    <Button onClick={closeWithSave}>저장 후 닫기</Button>
                  </div>
                </div>
              ) : (
                <>
                  <Button variant="outline" onClick={handleCloseSettings}>닫기</Button>
                  <Button onClick={applyDraft}>적용</Button>
                </>
              )}
            </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 프리셋 관리 */}
      {showPresets && <PresetsPanel />}

      {/* 세트 목록 */}
      {sets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <span className="text-4xl">⌨</span>
          <div className="text-sm">아직 매크로 세트가 없습니다.</div>
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" /> 첫 매크로 만들기
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sets.map((s) => (
            <MacroSetCard key={s.id} set={s} onEdit={openEdit} />
          ))}
        </div>
      )}

      {/* 안내 */}
      <div className="rounded-lg border bg-card/50 p-3 text-xs text-muted-foreground">
        <p className="font-bold text-foreground">
          {execMode === "exclusive" ? "순차 실행(권장)" : "동시 혼합 실행"}
        </p>
        <p className="mt-1">
          {execMode === "exclusive"
            ? "매크로 실행 키를 추가 입력 시 진행 중이던 매크로는 일시정지되고, 추가한 매크로가 끝나면 (트리거가 눌린 상태일 경우) 직전 매크로가 재개됩니다."
            : "여러 세트가 동시에 활성화됩니다. 예: A키(누르는 동안 반복)로 1번 실행 중 B키로 2번을 함께 실행하고, B를 떼면 2번만 멈추고 A가 눌린 동안 1번은 계속됩니다."}
        </p>
        <p className="mt-1">동일 트리거는 하나의 세트만 활성화됩니다(중복 시 기존 자동 비활성화).</p>
      </div>

      {/* ── 드라이버 설치 안내 다이얼로그 ─────────────────────── */}
      {/* installing 중에는 외부 클릭으로 닫히지 않도록 */}
      <Dialog open={driverDialogOpen} onOpenChange={(v) => { if (!v && installing) return; setDriverDialogOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Interception 드라이버 미설치
            </DialogTitle>
            <DialogDescription className="space-y-1.5 pt-1">
              <p>
                <strong>물리 입력 모드</strong>는 Interception 커널 드라이버가 필요합니다.
                프로그램을 설치한 경우 드라이버가 함께 설치되었을 수 있으나,
                <strong> 재부팅이 완료되지 않으면 인식되지 않습니다.</strong>
              </p>
              <p className="text-[11px] text-muted-foreground">
                재부팅 후에도 미인식 시 아래 자동 설치를 실행하거나 GitHub에서 수동으로 설치하세요.
              </p>
            </DialogDescription>
          </DialogHeader>

          {installMsg && (
            <p className={cn(
              "rounded-md bg-card px-3 py-2 text-xs font-medium",
              installMsg.startsWith("설치기가") ? "text-emerald-400" : "text-destructive"
            )}>
              {installMsg}
            </p>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => void openUrl("https://github.com/oblitum/Interception/releases")}
              className="gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" /> GitHub 수동 설치
            </Button>
            <Button
              onClick={() => void handleInstallDriver()}
              disabled={installing}
              className="gap-1.5"
            >
              {installing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {installing ? "실행 중…" : "드라이버 자동 설치 (UAC)"}
            </Button>
            <Button variant="outline" onClick={() => setDriverDialogOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
