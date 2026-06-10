"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, GripVertical, Pencil, Power, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMacroStore } from "@/lib/macro/store";
import { useMacroRuntime } from "@/lib/macro/runtime";
import { inputLabel } from "@/lib/macro/keys";
import {
  TRIGGER_MODE_LABEL,
  TRIGGER_MODE_DESC,
  type MacroSet,
  type TriggerMode,
} from "@/lib/macro/types";
import { MODE_VALUES } from "@/lib/macro/store";
import { KeyCaptureButton } from "@/components/macro/key-capture-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export function MacroSetCard({ set, onEdit }: { set: MacroSet; onEdit: (id: string) => void }) {
  const toggleEnabled = useMacroStore((s) => s.toggleEnabled);
  const duplicateSet = useMacroStore((s) => s.duplicateSet);
  const removeSet = useMacroStore((s) => s.removeSet);
  const updateSet = useMacroStore((s) => s.updateSet);
  const reorderSets = useMacroStore((s) => s.reorderSets);
  const active = useMacroRuntime((s) => !!s.activeIds[set.id]);

  const [draggable, setDraggable] = useState(false);
  const [over, setOver] = useState(false);

  const stepCount = set.steps.filter((s) => s.input).length;
  const incomplete = !set.trigger || stepCount === 0;

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", set.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        setDraggable(false);
        setOver(false);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const from = e.dataTransfer.getData("text/plain");
        if (from && from !== set.id) reorderSets(from, set.id);
      }}
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors",
        active && "border-[hsl(var(--cat-macro))] shadow-[0_0_0_1px_hsl(var(--cat-macro))]",
        over && "border-[hsl(var(--cat-macro))] ring-2 ring-[hsl(var(--cat-macro))]/40",
        !set.enabled && "opacity-60"
      )}
    >
      <div className="flex gap-2">
        {/* 좌: 정보 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* 드래그 핸들 — 순서 변경 */}
            <button
              type="button"
              aria-label="드래그하여 순서 변경"
              title="드래그하여 순서 변경"
              className="shrink-0 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
              onMouseDown={() => setDraggable(true)}
              onMouseUp={() => setDraggable(false)}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            {/* 실행 표시등 */}
            <span
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                active ? "bg-[hsl(var(--cat-macro))] animate-pulse" : "bg-muted"
              )}
              title={active ? "실행 중" : "대기"}
            />
            <span className="truncate text-lg font-extrabold">{set.name}</span>
            {active && (
              <span className="rounded-full bg-[hsl(var(--cat-macro))]/15 px-2 py-0.5 text-[10px] font-bold text-[hsl(var(--cat-macro))]">
                실행 중
              </span>
            )}
            {incomplete && (
              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive">
                미완성
              </span>
            )}
          </div>

          {/* 트리거 · 모드 · 스텝 — 한 행 */}
          <div className="mt-2 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs">
            <span className="flex shrink-0 items-center gap-1">
              <span className="text-muted-foreground">트리거 </span>
              {/* 클릭 시 트리거 키 즉시 재지정 */}
              <KeyCaptureButton
                value={set.trigger}
                onCapture={(code) => updateSet(set.id, { trigger: code })}
                placeholder="미지정"
                className="h-6 min-w-[64px] px-2 text-[hsl(var(--cat-macro))]"
              />
            </span>
            <span className="text-border">·</span>
            <span className="flex min-w-0 items-center gap-1">
              <span className="text-muted-foreground">모드 </span>
              {/* 클릭 시 모드 변경 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={TRIGGER_MODE_DESC[set.mode]}
                    className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-input bg-card px-2 text-xs font-bold transition-colors hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--cat-macro))]/40 data-[state=open]:border-[hsl(var(--cat-macro))]/60 data-[state=open]:bg-[hsl(var(--cat-macro))]/10"
                  >
                    <span className="truncate">{TRIGGER_MODE_LABEL[set.mode]}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  {MODE_VALUES.map((m) => (
                    <DropdownMenuItem
                      key={m}
                      onClick={() => updateSet(set.id, { mode: m })}
                      className={cn(
                        "cursor-pointer items-start gap-2 py-2",
                        set.mode === m && "bg-[hsl(var(--cat-macro))]/10"
                      )}
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--cat-macro))]",
                          set.mode !== m && "invisible"
                        )}
                      />
                      <span className="min-w-0">
                        <span className={cn("block text-xs font-bold", set.mode === m && "text-[hsl(var(--cat-macro))]")}>
                          {TRIGGER_MODE_LABEL[m]}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {TRIGGER_MODE_DESC[m]}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
            <span className="text-border">·</span>
            <span className="shrink-0">
              <span className="text-muted-foreground">스텝 </span>
              <span className="font-bold tabular-nums">{stepCount}</span>
            </span>
            {!set.passThrough && (
              <span className="ml-auto shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                소비
              </span>
            )}
          </div>

          {/* 적용 키 미리보기 — 최대 2행 */}
          {stepCount > 0 && (
            <div className="mt-2 flex max-h-[3.75rem] flex-wrap content-start gap-1.5 overflow-hidden">
              {set.steps
                .filter((s) => s.input)
                .map((s) => (
                  <span
                    key={s.id}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-semibold tabular-nums leading-tight",
                      s.action === "press"
                        ? "bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))]"
                        : s.action === "release"
                          ? "bg-secondary text-muted-foreground"
                          : "bg-secondary"
                    )}
                    title={
                      s.action === "tap"
                        ? `탭 · 누름 ${s.holdMs}ms`
                        : s.action === "press"
                          ? "누르기(유지)"
                          : "때기"
                    }
                  >
                    {s.action === "tap" ? "⬍" : s.action === "press" ? "⬇" : "⬆"}
                    {inputLabel(s.input)}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* 우: 액션 버튼 분할 (아이콘만) — On/Off · 편집 · 복사 · 삭제 */}
        <div className="flex shrink-0 flex-col gap-1 self-stretch border-l border-border pl-2">
          {/* 활성화 On/Off */}
          <button
            type="button"
            onClick={() => toggleEnabled(set.id)}
            title={set.enabled ? "활성화됨 — 클릭 시 OFF" : "비활성화됨 — 클릭 시 ON"}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
              set.enabled
                ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))]"
                : "border-input text-muted-foreground hover:text-foreground"
            )}
          >
            <Power className="h-4 w-4" />
          </button>
          {/* 편집 */}
          <button
            type="button"
            onClick={() => onEdit(set.id)}
            title="세트 편집"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-foreground transition-colors hover:bg-accent/10"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {/* 복사 */}
          <button
            type="button"
            onClick={() => duplicateSet(set.id)}
            title="세트 복사"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-foreground transition-colors hover:bg-accent/10"
          >
            <Copy className="h-4 w-4" />
          </button>
          {/* 삭제 */}
          <button
            type="button"
            onClick={() => {
              if (confirm(`'${set.name}' 세트를 삭제할까요?`)) removeSet(set.id);
            }}
            title="세트 삭제"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
