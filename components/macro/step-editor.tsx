"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Circle,
  Clock,
  Copy,
  Keyboard,
  MousePointer2,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { WheelNumber } from "@/components/macro/wheel-number";
import { useMacroStore, toMacroSteps } from "@/lib/macro/store";
import { useMacroRuntime } from "@/lib/macro/runtime";
import { inputLabel, isMouse } from "@/lib/macro/keys";
import { leftoverHeld, msToFps, resolvePresetDelay, type MacroStep, type StepAction } from "@/lib/macro/types";
import { captureNextInput, startRecording, type RecordedStep } from "@/lib/macro/capture";
import { ContextMenu, type MenuItem, type MenuState } from "@/components/macro/context-menu";

const MOUSE_SHORT: Record<string, string> = {
  MouseLeft: "좌클릭",
  MouseRight: "우클릭",
  MouseMiddle: "휠",
  MouseX1: "X1",
  MouseX2: "X2",
};
function cardLabel(code: string): string {
  if (!code) return "키?";
  if (isMouse(code)) return MOUSE_SHORT[code] ?? code;
  return inputLabel(code);
}

function ActionArrow({ action }: { action: StepAction }) {
  if (action === "press") return <ArrowDown className="h-3 w-3" />;
  if (action === "release") return <ArrowUp className="h-3 w-3" />;
  return <ArrowDownUp className="h-3 w-3" />;
}

export function StepEditor({ setId, steps }: { setId: string; steps: MacroStep[] }) {
  const set = useMacroStore((s) => s.sets.find((x) => x.id === setId));
  const updateSet = useMacroStore((s) => s.updateSet);
  const updateStep = useMacroStore((s) => s.updateStep);
  const removeStep = useMacroStore((s) => s.removeStep);
  const insertStepAt = useMacroStore((s) => s.insertStepAt);
  const duplicateStep = useMacroStore((s) => s.duplicateStep);
  const setSteps = useMacroStore((s) => s.setSteps);
  const appendSteps = useMacroStore((s) => s.appendSteps);
  const setAllStepTimes = useMacroStore((s) => s.setAllStepTimes);
  const setAutoDelayPreset = useMacroStore((s) => s.setAutoDelayPreset);
  const delayPresets = useMacroStore((s) => s.delayPresets);
  const fpsAutoEnabled = useMacroStore((s) => s.fpsAutoDelayEnabled);
  const currentFps = useMacroRuntime((s) => s.currentFps);

  const autoPresetId = set?.autoDelayPresetId ?? null;
  // 전역 OFF 시 자동 프리셋 무시 — 표준/개별 지연으로 동작
  const effectiveAutoId = fpsAutoEnabled ? autoPresetId : null;
  const activePreset = effectiveAutoId ? delayPresets.find((p) => p.id === effectiveAutoId) : null;
  const autoDelayMs = activePreset ? resolvePresetDelay(activePreset, currentFps) : null;
  // 자동 모드이면 표준 지연도 true 로 취급 (카드 표시용)
  const stdOn = !!set?.useStandardDelay || !!effectiveAutoId;
  const stdMs = autoDelayMs ?? (set?.standardDelayMs ?? 50);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: "delay" | "hold" } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recLive, setRecLive] = useState<RecordedStep[]>([]);
  const [recFixed, setRecFixed] = useState(false);
  const [recFixedMs, setRecFixedMs] = useState(50);
  const [bulkMs, setBulkMs] = useState(50);
  const [menu, setMenu] = useState<MenuState>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const captureCancel = useRef<(() => void) | null>(null);
  const recStop = useRef<(() => void) | null>(null);

  const held = leftoverHeld(steps);

  // ── 선택 ─────────────────────────────────────────────────
  const selectOnly = (id: string) => {
    setSelectedIds(new Set([id]));
    setAnchorId(id);
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setAnchorId(id);
  };
  const selectRange = (toId: string) => {
    const a = anchorId ? steps.findIndex((s) => s.id === anchorId) : -1;
    const b = steps.findIndex((s) => s.id === toId);
    if (a < 0 || b < 0) {
      selectOnly(toId);
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelectedIds(new Set(steps.slice(lo, hi + 1).map((s) => s.id)));
  };
  const onCardClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey) selectRange(id);
    else if (e.ctrlKey || e.metaKey) toggleSelect(id);
    else selectOnly(id);
  };

  const insertIndex = () => {
    if (selectedIds.size === 0) return steps.length;
    let m = -1;
    steps.forEach((s, i) => {
      if (selectedIds.has(s.id) && i > m) m = i;
    });
    return m + 1;
  };

  // ── 키 캡처 ───────────────────────────────────────────────
  function captureKey(id: string) {
    captureCancel.current?.();
    setCapturingId(id);
    captureCancel.current = captureNextInput(
      (code) => {
        updateStep(setId, id, { input: code });
        setCapturingId(null);
        captureCancel.current = null;
      },
      () => {
        setCapturingId(null);
        captureCancel.current = null;
      }
    );
  }
  function addKeyStep(action: "press" | "release" | "tap", forceEnd = false) {
    const id = insertStepAt(setId, forceEnd ? steps.length : insertIndex(), action);
    selectOnly(id);
    captureKey(id);
  }
  function addDelayStep(forceEnd = false) {
    const id = insertStepAt(setId, forceEnd ? steps.length : insertIndex(), "delay");
    selectOnly(id);
    if (!stdOn) setEditing({ id, field: "delay" });
  }

  function deleteSelected() {
    if (selectedIds.size === 0) return;
    setSteps(setId, steps.filter((s) => !selectedIds.has(s.id)));
    setSelectedIds(new Set());
    setAnchorId(null);
  }

  // ── Del 키로 선택 삭제 ───────────────────────────────────
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      if (editing || capturingId || recording) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, steps, editing, capturingId, recording, setId]);

  // ── 녹화 ─────────────────────────────────────────────────
  function startRec() {
    if (recording) return;
    setRecording(true);
    setRecLive([]);
    setSelectedIds(new Set());
    recStop.current = startRecording(
      (recorded) => {
        if (recorded.length) appendSteps(setId, toMacroSteps(recorded));
        setRecording(false);
        setRecLive([]);
        recStop.current = null;
      },
      {
        fixedDelayMs: recFixed ? recFixedMs : null,
        onProgress: (steps) => setRecLive(steps),
      }
    );
  }
  function stopRec() {
    recStop.current?.();
  }

  // ── 드래그 정렬 (삽입 지점 강조) ─────────────────────────
  function onCardDragOver(e: React.DragEvent, index: number) {
    if (!dragId) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    setDropIndex(before ? index : index + 1);
  }
  function commitDrop() {
    if (dragId == null || dropIndex == null) {
      setDragId(null);
      setDropIndex(null);
      return;
    }
    const from = steps.findIndex((s) => s.id === dragId);
    if (from >= 0) {
      let to = dropIndex;
      const arr = steps.slice();
      const [m] = arr.splice(from, 1);
      if (from < to) to -= 1;
      to = Math.max(0, Math.min(arr.length, to));
      arr.splice(to, 0, m);
      setSteps(setId, arr);
    }
    setDragId(null);
    setDropIndex(null);
  }

  // ── 추가 메뉴 ("+" 버튼) — 끝에 추가 ──────────────────────
  function openAddMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      yAnchor: r.top, // 아래 공간 부족 시 버튼 위로 뒤집기
      items: [
        { label: "누르기 추가", icon: <ArrowDown className="h-3.5 w-3.5" />, onClick: () => addKeyStep("press", true) },
        { label: "때기 추가", icon: <ArrowUp className="h-3.5 w-3.5" />, onClick: () => addKeyStep("release", true) },
        { label: "탭 추가", icon: <ArrowDownUp className="h-3.5 w-3.5" />, onClick: () => addKeyStep("tap", true) },
        { label: "지연 추가", icon: <Clock className="h-3.5 w-3.5" />, onClick: () => addDelayStep(true) },
        { type: "sep" },
        { label: "녹화", icon: <Circle className="h-3.5 w-3.5 fill-current" />, onClick: startRec },
      ],
    });
  }

  // ── 컨텍스트 메뉴 ────────────────────────────────────────
  function openEmptyMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      yAnchor: e.clientY,
      items: [
        { label: "누르기 추가", icon: <ArrowDown className="h-3.5 w-3.5" />, onClick: () => addKeyStep("press") },
        { label: "때기 추가", icon: <ArrowUp className="h-3.5 w-3.5" />, onClick: () => addKeyStep("release") },
        { label: "탭 추가", icon: <ArrowDownUp className="h-3.5 w-3.5" />, onClick: () => addKeyStep("tap") },
        { label: "지연 추가", icon: <Clock className="h-3.5 w-3.5" />, onClick: () => addDelayStep() },
        { type: "sep" },
        { label: "입력 녹화 시작", icon: <Circle className="h-3.5 w-3.5 fill-current" />, onClick: startRec },
      ],
    });
  }
  function openStepMenu(e: React.MouseEvent, step: MacroStep) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.has(step.id)) selectOnly(step.id);
    const multi = selectedIds.has(step.id) && selectedIds.size > 1;
    const items: MenuItem[] = [];
    if (!multi) {
      if (step.action === "delay") {
        if (!stdOn)
          items.push({ label: "지연시간 편집", icon: <Clock className="h-3.5 w-3.5" />, onClick: () => setEditing({ id: step.id, field: "delay" }) });
      } else {
        items.push({ label: "키 변경", icon: <Keyboard className="h-3.5 w-3.5" />, onClick: () => captureKey(step.id) });
        items.push({ type: "sep" });
        items.push({ label: "동작: 누르기", icon: <ArrowDown className="h-3.5 w-3.5" />, active: step.action === "press", onClick: () => updateStep(setId, step.id, { action: "press" }) });
        items.push({ label: "동작: 때기", icon: <ArrowUp className="h-3.5 w-3.5" />, active: step.action === "release", onClick: () => updateStep(setId, step.id, { action: "release" }) });
        items.push({ label: "동작: 탭", icon: <ArrowDownUp className="h-3.5 w-3.5" />, active: step.action === "tap", onClick: () => updateStep(setId, step.id, { action: "tap", holdMs: step.holdMs || 30 }) });
        if (step.action === "tap")
          items.push({ label: "누름시간 편집", icon: <Clock className="h-3.5 w-3.5" />, onClick: () => setEditing({ id: step.id, field: "hold" }) });
      }
      items.push({ type: "sep" });
      items.push({ label: "복제", icon: <Copy className="h-3.5 w-3.5" />, onClick: () => duplicateStep(setId, step.id) });
    }
    items.push({
      label: multi ? `선택 삭제 (${selectedIds.size}개)` : "삭제",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      onClick: () => (multi ? deleteSelected() : removeStep(setId, step.id)),
    });
    setMenu({ x: e.clientX, y: e.clientY, yAnchor: e.clientY, items });
  }

  const renderInline = (step: MacroStep, field: "delay" | "hold") => (
    <WheelNumber
      autoFocus
      data-capture-ignore
      data-rec-ignore
      value={field === "delay" ? step.delayMs : step.holdMs}
      onChange={(v) =>
        updateStep(setId, step.id, { [field === "delay" ? "delayMs" : "holdMs"]: v })
      }
      onBlur={() => setEditing(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") setEditing(null);
      }}
      onClick={(e) => e.stopPropagation()}
      className="h-6 w-16 rounded border bg-input px-1 text-center text-xs"
    />
  );

  const Indicator = ({ active }: { active: boolean }) => (
    <div className="flex w-1 shrink-0 items-stretch">
      <div className={cn("w-full rounded-full transition-colors", active ? "bg-[hsl(var(--cat-macro))]" : "bg-transparent")} />
    </div>
  );

  return (
    <div className="space-y-3">
      {/* 툴바 1 — 추가/녹화 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-bold">
          스텝 ({steps.length}){selectedIds.size > 0 && <span className="text-[hsl(var(--cat-macro))]"> · 선택 {selectedIds.size}</span>}
        </span>
        <Button size="xs" variant="outline" onClick={() => addKeyStep("press")} data-capture-ignore>
          <ArrowDown className="h-3 w-3" /> 누르기
        </Button>
        <Button size="xs" variant="outline" onClick={() => addKeyStep("release")} data-capture-ignore>
          <ArrowUp className="h-3 w-3" /> 때기
        </Button>
        <Button size="xs" variant="outline" onClick={() => addKeyStep("tap")} data-capture-ignore>
          <ArrowDownUp className="h-3 w-3" /> 탭
        </Button>
        <Button size="xs" variant="outline" onClick={() => addDelayStep()} data-capture-ignore>
          <Clock className="h-3 w-3" /> 지연
        </Button>
        {selectedIds.size > 0 && (
          <Button size="xs" variant="ghost" className="text-destructive hover:text-destructive" onClick={deleteSelected} data-capture-ignore>
            <Trash2 className="h-3 w-3" /> 선택 삭제
          </Button>
        )}

        <span className="mx-1 h-5 w-px bg-border" />

        {recording ? (
          <Button size="xs" variant="destructive" onClick={stopRec} data-rec-ignore>
            <Square className="h-3 w-3 fill-current" /> 정지
          </Button>
        ) : (
          <Button size="xs" onClick={startRec} data-capture-ignore>
            <Circle className="h-3 w-3 fill-current" /> 녹화
          </Button>
        )}
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground" data-capture-ignore data-rec-ignore>
          <input type="checkbox" checked={recFixed} onChange={(e) => setRecFixed(e.target.checked)} className="h-3 w-3 accent-[hsl(var(--cat-macro))]" />
          녹화 지연 고정
        </label>
        <WheelNumber
          disabled={!recFixed}
          value={recFixedMs}
          onChange={(v) => setRecFixedMs(v)}
          className="h-7 w-16 rounded-md border border-input bg-input px-2 text-sm disabled:opacity-50"
          data-capture-ignore
          data-rec-ignore
        />
        <span className="text-[11px] text-muted-foreground">ms</span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        좌클릭 선택 · Ctrl+클릭 개별 · Shift+클릭 범위 · Del 선택 삭제 · 드래그 순서변경 · 우클릭 편집 ·
        시간 클릭 후 마우스 휠로 ±1 · 추가 위치는 선택 카드 뒤(선택 없으면 끝)
      </p>

      {/* 툴바 2 — 지연 옵션 */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card/50 px-3 py-2">
        {/* 지연 모드 선택 */}
        <div className="flex items-center gap-1.5" data-capture-ignore>
          <span className="text-[11px] font-bold text-muted-foreground">지연 모드</span>
          {/* 개별 */}
          <button
            type="button"
            onClick={() => { setAutoDelayPreset(setId, null); updateSet(setId, { useStandardDelay: false }); }}
            className={cn(
              "rounded border px-2 py-0.5 text-[11px] font-bold transition-colors",
              !autoPresetId && !set?.useStandardDelay
                ? "border-[hsl(var(--cat-macro))]/60 bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))]"
                : "border-input text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >개별</button>
          {/* 표준 고정 */}
          <button
            type="button"
            onClick={() => { setAutoDelayPreset(setId, null); updateSet(setId, { useStandardDelay: true }); }}
            className={cn(
              "rounded border px-2 py-0.5 text-[11px] font-bold transition-colors",
              !autoPresetId && !!set?.useStandardDelay
                ? "border-[hsl(var(--cat-macro))]/60 bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))]"
                : "border-input text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >표준</button>
          {/* 자동 프리셋들 */}
          {delayPresets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setAutoDelayPreset(setId, p.id)}
              className={cn(
                "rounded border px-2 py-0.5 text-[11px] font-bold transition-colors",
                autoPresetId === p.id
                  ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
                  : "border-input text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              )}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* 표준 고정 모드: 값 입력 */}
        {!autoPresetId && set?.useStandardDelay && (
          <div className="flex items-center gap-1">
            <WheelNumber
              value={set.standardDelayMs}
              onChange={(v) => updateSet(setId, { standardDelayMs: v })}
              className="h-7 w-20 rounded-md border border-input bg-input px-2 text-sm"
              data-capture-ignore
            />
            <span className="text-[11px] tabular-nums text-muted-foreground">
              ms (≈ {msToFps(set.standardDelayMs)}fps · 모든 지연 일괄 적용)
            </span>
          </div>
        )}
        {/* 자동 프리셋 지정됐지만 전역 OFF — 안내 */}
        {autoPresetId && !fpsAutoEnabled && (
          <span className="text-[11px] text-amber-400">
            FPS 자동 딜레이가 설정에서 꺼져 있어 표준/개별 지연으로 동작합니다
          </span>
        )}
        {/* 자동 모드: 현재 FPS + 적용 딜레이 표시 — 값 변동에도 가로폭 고정 */}
        {autoPresetId && activePreset && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className={cn("inline-block w-[88px] text-right tabular-nums font-bold", currentFps > 0 ? "text-emerald-400" : "text-amber-400")}>
              {currentFps > 0 ? `${currentFps} fps` : "측정 전 (60 가정)"}
            </span>
            <span className="shrink-0 text-muted-foreground">→</span>
            <span className="inline-block w-[110px] font-bold text-foreground tabular-nums">
              {autoDelayMs}ms ({msToFps(autoDelayMs ?? 0)}fps)
            </span>
            <span className="shrink-0 text-muted-foreground">자동 적용 중</span>
          </div>
        )}
        <span className="mx-1 h-5 w-px bg-border" />
        <span className="text-[11px] text-muted-foreground">일괄수정:</span>
        <WheelNumber
          value={bulkMs}
          onChange={(v) => setBulkMs(v)}
          className="h-7 w-20 rounded-md border border-input bg-input px-2 text-sm"
          data-capture-ignore
        />
        <Button size="xs" variant="outline" onClick={() => setAllStepTimes(setId, bulkMs)} data-capture-ignore title="모든 지연 + 탭(누르기) 시간을 일괄 적용">
          모든 지연·누르기에 적용
        </Button>
      </div>

      {/* 녹화 배너 — 실시간 입력 표시 */}
      {recording && (
        <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-bold text-destructive">
            <Circle className="h-3 w-3 animate-pulse fill-current" />
            입력 녹화 중… (ESC 또는 정지로 종료){recFixed && ` · 지연 고정 ${recFixedMs}ms`}
            <span className="ml-auto font-normal text-muted-foreground">
              {recLive.filter((s) => s.action !== "delay").length}개 입력
            </span>
          </div>
          {/* 라이브 시퀀스 */}
          <div className="flex flex-wrap items-center gap-1">
            {recLive.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">키/마우스를 입력하면 여기에 실시간 표시됩니다…</span>
            ) : (
              recLive.map((s, i) =>
                s.action === "delay" ? (
                  <span
                    key={i}
                    className="rounded bg-card px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground"
                  >
                    {s.delayMs}ms
                  </span>
                ) : (
                  <span
                    key={i}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                      s.action === "press"
                        ? "bg-[hsl(var(--cat-macro))]/20 text-[hsl(var(--cat-macro))]"
                        : "bg-secondary text-muted-foreground"
                    )}
                    title={s.action === "press" ? "누르기" : "때기"}
                  >
                    {s.action === "press" ? "⬇" : "⬆"}
                    {cardLabel(s.input ?? "")}
                  </span>
                )
              )
            )}
          </div>
        </div>
      )}

      {/* 타임라인 */}
      <div
        onContextMenu={openEmptyMenu}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedIds(new Set());
            setAnchorId(null);
          }
        }}
        onDragOver={(e) => {
          if (dragId && steps.length === 0) {
            e.preventDefault();
            setDropIndex(0);
          }
        }}
        onDrop={commitDrop}
        className="flex min-h-[120px] flex-wrap items-stretch gap-0.5 rounded-md border bg-background/40 p-3"
      >
        {steps.length === 0 && (
          <div className="flex w-full items-center justify-center py-8 text-center text-xs text-muted-foreground">
            비어 있음 — 위 버튼 또는 이 영역 우클릭으로 스텝을 추가하세요.
          </div>
        )}

        {(() => {
          const maxDelay = Math.max(
            ...steps.filter((s) => s.action === "delay").map((s) => (stdOn ? stdMs : s.delayMs)),
            100
          );
          return steps.map((step, i) => {
          const selected = selectedIds.has(step.id);
          const capturing = capturingId === step.id;
          const isEditing = editing?.id === step.id;
          const isDelay = step.action === "delay";
          const common = cn(
            "relative flex flex-col items-center justify-center rounded-md border transition-colors select-none",
            dragId === step.id ? "opacity-40" : "cursor-grab",
            selected && "ring-2 ring-[hsl(var(--cat-macro))]"
          );

          return (
            <Fragment key={step.id}>
              <Indicator active={dropIndex === i && dragId !== step.id} />
              {isDelay ? (
                <div
                  draggable={!isEditing}
                  onDragStart={() => setDragId(step.id)}
                  onDragOver={(e) => onCardDragOver(e, i)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropIndex(null);
                  }}
                  onDrop={commitDrop}
                  onClick={(e) => onCardClick(e, step.id)}
                  onDoubleClick={() => !stdOn && setEditing({ id: step.id, field: "delay" })}
                  onContextMenu={(e) => openStepMenu(e, step)}
                  title={`≈ ${msToFps(stdOn ? stdMs : step.delayMs)}fps${stdOn ? " · 표준 지연 적용 중" : " · 더블클릭하여 시간 편집"}`}
                  className={cn(common, "min-w-[46px] overflow-hidden px-1.5 py-1", "bg-card text-muted-foreground")}
                >
                  <Clock className="mb-0.5 h-3 w-3 opacity-60" />
                  {isEditing && !stdOn ? (
                    renderInline(step, "delay")
                  ) : (
                    <span className="text-xs font-bold tabular-nums text-foreground">{stdOn ? stdMs : step.delayMs}</span>
                  )}
                  <span className="text-[9px] leading-none">ms</span>
                  <span className="text-[8px] leading-none tabular-nums opacity-70">{msToFps(stdOn ? stdMs : step.delayMs)}fps</span>
                  {/* 타임라인 바 — 지연 시간 비율 시각화 */}
                  <div
                    className="absolute bottom-0 left-0 h-[3px] rounded-full bg-[hsl(var(--cat-macro))]/50 transition-all duration-200"
                    style={{ width: `${Math.min(100, ((stdOn ? stdMs : step.delayMs) / maxDelay) * 100)}%` }}
                  />
                </div>
              ) : (
                <div
                  draggable={!isEditing}
                  onDragStart={() => setDragId(step.id)}
                  onDragOver={(e) => onCardDragOver(e, i)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropIndex(null);
                  }}
                  onDrop={commitDrop}
                  onClick={(e) => onCardClick(e, step.id)}
                  onDoubleClick={() => captureKey(step.id)}
                  onContextMenu={(e) => openStepMenu(e, step)}
                  title="클릭 선택(Ctrl/Shift) · 더블클릭 키변경 · 우클릭 편집"
                  className={cn(
                    common,
                    "min-w-[52px] gap-0.5 px-1.5 py-1",
                    "border-rose-800/70 bg-gradient-to-b from-rose-900/80 to-rose-950/80 text-rose-50",
                    capturing && "animate-pulse ring-2 ring-[hsl(var(--cat-macro))]"
                  )}
                >
                  <div className="flex items-center gap-0.5 font-bold leading-none">
                    {isMouse(step.input) && <MousePointer2 className="h-2.5 w-2.5" />}
                    <span className="text-xs">{capturing ? "입력…" : cardLabel(step.input)}</span>
                  </div>
                  <div className="flex items-center gap-0.5 text-rose-200/80">
                    <ActionArrow action={step.action} />
                    {step.action === "tap" &&
                      (isEditing ? (
                        renderInline(step, "hold")
                      ) : (
                        <span
                          className="cursor-text rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-bold tabular-nums hover:bg-black/60"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing({ id: step.id, field: "hold" });
                          }}
                          title="누름시간(ms) — 클릭하여 편집(휠로 ±1)"
                        >
                          {step.holdMs}ms
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </Fragment>
          );
        })})()}

        {steps.length > 0 && <Indicator active={dropIndex === steps.length} />}

        {!recording && (
          <button
            type="button"
            data-capture-ignore
            onClick={openAddMenu}
            onContextMenu={openAddMenu}
            onDragOver={(e) => {
              if (dragId) {
                e.preventDefault();
                setDropIndex(steps.length);
              }
            }}
            onDrop={commitDrop}
            title="스텝 추가 — 누르기 / 때기 / 탭 / 지연 / 녹화 선택"
            className="flex min-w-[40px] items-center justify-center rounded-md border border-dashed border-input text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 지속 누름 안내 */}
      {held.length > 0 && (
        <div className="rounded-md border border-[hsl(var(--cat-macro))]/40 bg-[hsl(var(--cat-macro))]/10 px-3 py-2 text-[11px] text-foreground">
          <span className="font-bold text-[hsl(var(--cat-macro))]">지속 누름</span> — 끝까지 떼지
          않는 키: <span className="font-bold">{held.map((c) => cardLabel(c)).join(", ")}</span>
          <span className="text-muted-foreground"> (반복 시 다음 사이클까지 유지, 정지 시 떼짐)</span>
        </div>
      )}

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
