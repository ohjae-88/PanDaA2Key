"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { msToFps, type DelayPreset, type FpsRange } from "@/lib/macro/types";

/** 숫자 입력 — 타이핑 중에는 자유 입력, blur/Enter 시 클램핑 후 커밋 */
function RangeNumber({
  value,
  min,
  onCommit,
  className,
}: {
  value: number;
  min: number;
  onCommit: (v: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  // 외부 값 변경(다른 구간 수정으로 인한 재정렬 등) 시 동기화
  useEffect(() => setText(String(value)), [value]);

  function commit() {
    const n = Math.floor(Number(text));
    const v = Number.isFinite(n) ? Math.max(min, n) : value;
    setText(String(v));
    if (v !== value) onCommit(v);
  }

  return (
    <input
      type="number"
      value={text}
      min={min}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={cn(
        "w-16 rounded border border-input bg-background px-1.5 py-0.5 tabular-nums focus:outline-none focus:ring-1 focus:ring-[hsl(var(--cat-macro))]/50",
        className
      )}
    />
  );
}

export function DelayPresetCard({
  preset,
  currentFps = 0,
  onUpdate,
  onRemove,
}: {
  preset: DelayPreset;
  currentFps?: number;
  onUpdate: (patch: { name?: string; ranges?: FpsRange[] }) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const activeRange = preset.ranges.findIndex((r) => currentFps < r.maxFps);

  /** 구간 수정 — maxFps 변경 시 오름차순 재정렬, 마지막 구간은 항상 9999 유지 */
  function updateRange(i: number, patch: Partial<FpsRange>) {
    let next = preset.ranges.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (patch.maxFps !== undefined) {
      next = [...next].sort((a, b) => a.maxFps - b.maxFps);
      if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], maxFps: 9999 };
    }
    onUpdate({ ranges: next });
  }

  function addRange() {
    const last = preset.ranges[preset.ranges.length - 1];
    const prevTop = preset.ranges.length >= 2
      ? preset.ranges[preset.ranges.length - 2].maxFps
      : 0;
    const newTop = prevTop + 60;
    const newRanges = [
      ...preset.ranges.slice(0, -1),
      { delayMs: last?.delayMs ?? 16, maxFps: newTop },
      { maxFps: 9999, delayMs: Math.max(1, (last?.delayMs ?? 16) - 5) },
    ];
    onUpdate({ ranges: newRanges });
  }

  function removeRange(i: number) {
    const newRanges = preset.ranges.filter((_, j) => j !== i);
    if (newRanges.length > 0)
      newRanges[newRanges.length - 1] = { ...newRanges[newRanges.length - 1], maxFps: 9999 };
    onUpdate({ ranges: newRanges });
  }

  return (
    <div className="rounded-lg border bg-background/40">
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title={expanded ? "구간 접기" : "구간 펼치기"}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
        {preset.builtin ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex-1 text-left text-xs font-bold"
          >
            {preset.name}
          </button>
        ) : (
          <input
            value={preset.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="프리셋 이름"
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-bold transition-colors hover:border-input focus:border-input focus:outline-none"
            title="클릭하여 이름 변경"
          />
        )}
        {preset.builtin && (
          <span className="shrink-0 rounded bg-[hsl(var(--cat-macro))]/20 px-1.5 py-0.5 text-[10px] font-bold text-[hsl(var(--cat-macro))]">
            기본
          </span>
        )}
        {!preset.builtin && (
          <span className="shrink-0 rounded border border-input px-1.5 py-0.5 text-[10px] text-muted-foreground">
            편집 가능
          </span>
        )}
        {/* 현재 FPS 구간 표시 */}
        {currentFps > 0 && (
          <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] tabular-nums text-emerald-400">
            {currentFps}fps
          </span>
        )}
        {!preset.builtin && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 text-muted-foreground hover:text-destructive"
            title="프리셋 삭제"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 구간 테이블 */}
      {expanded && (
        <div className="space-y-1.5 border-t px-3 py-2.5">
          {/* 컬럼 헤더 */}
          <div className="flex items-center gap-2 px-2 text-[10px] font-semibold text-muted-foreground">
            <span className="w-28 shrink-0">FPS 구간</span>
            <span className="w-16 text-center">{preset.builtin ? "" : "상한"}</span>
            <span className="w-10" />
            <span className="w-16 text-center">딜레이</span>
          </div>
          {preset.ranges.map((range, i) => {
            const lowerBound = i === 0 ? 0 : preset.ranges[i - 1].maxFps;
            const isActive = activeRange === i;
            return (
              <div
                key={`${preset.id}-${i}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-[11px] transition-colors",
                  isActive && currentFps > 0
                    ? "border border-emerald-500/30 bg-emerald-500/10"
                    : "border border-transparent"
                )}
              >
                {/* 구간 표시 */}
                <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
                  {lowerBound} ~ {range.maxFps === 9999 ? "∞" : range.maxFps} fps
                </span>
                {/* 상한 수정 (마지막 구간 제외) */}
                {!preset.builtin && range.maxFps !== 9999 ? (
                  <RangeNumber
                    value={range.maxFps}
                    min={lowerBound + 1}
                    onCommit={(v) => updateRange(i, { maxFps: v })}
                  />
                ) : (
                  <span className="w-16 text-center text-muted-foreground/50">
                    {range.maxFps === 9999 ? "—" : range.maxFps}
                  </span>
                )}
                <span className="w-10 text-center text-muted-foreground">→</span>
                {/* 딜레이 수정 */}
                {!preset.builtin ? (
                  <RangeNumber
                    value={range.delayMs}
                    min={1}
                    onCommit={(v) => updateRange(i, { delayMs: v })}
                  />
                ) : (
                  <span className="w-16 text-center tabular-nums font-bold text-foreground">{range.delayMs}</span>
                )}
                <span className="text-muted-foreground">ms</span>
                <span className="tabular-nums text-[10px] text-muted-foreground">(≈{msToFps(range.delayMs)}fps)</span>
                {isActive && currentFps > 0 && (
                  <span className="ml-auto text-[10px] font-bold text-emerald-400">← 현재</span>
                )}
                {!preset.builtin && preset.ranges.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRange(i)}
                    className={cn(
                      "shrink-0 text-muted-foreground hover:text-destructive",
                      isActive && currentFps > 0 ? "" : "ml-auto"
                    )}
                    title="이 구간 삭제"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {!preset.builtin && (
            <button
              type="button"
              onClick={addRange}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> 구간 추가
            </button>
          )}
          {preset.builtin && (
            <p className="px-2 text-[10px] text-muted-foreground">
              기본 프리셋은 편집할 수 없습니다. 프리셋 추가로 복사본을 만들어 수정하세요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
