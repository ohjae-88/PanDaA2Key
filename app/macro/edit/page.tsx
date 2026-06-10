"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, RotateCw, Repeat, ToggleRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useMacroStore } from "@/lib/macro/store";
import { KeyCaptureButton } from "@/components/macro/key-capture-button";
import { StepEditor } from "@/components/macro/step-editor";
import { TRIGGER_MODE_DESC, type TriggerMode } from "@/lib/macro/types";

const MODES: { v: TriggerMode; label: string; icon: typeof ArrowRight }[] = [
  { v: "once", label: "반복 없음", icon: ArrowRight },
  { v: "whileHeld", label: "누르는 동안 반복", icon: RotateCw },
  { v: "toggleSame", label: "토글(같은 키)", icon: ToggleRight },
  { v: "toggleAny", label: "토글(아무 키)", icon: Repeat },
];

export default function MacroEditPage() {
  const params = useSearchParams();
  const id = params.get("id");
  const set = useMacroStore((s) => s.sets.find((x) => x.id === id));
  const updateSet = useMacroStore((s) => s.updateSet);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  if (!hydrated) return <div className="text-muted-foreground">로딩 중…</div>;

  if (!set) {
    return (
      <div className="space-y-4">
        <Link href="/macro" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 목록으로
        </Link>
        <div className="py-16 text-center text-muted-foreground">세트를 찾을 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/macro"
          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm font-bold hover:bg-accent/10"
        >
          <ArrowLeft className="h-4 w-4" /> 목록
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-extrabold">
          <span>⌨</span> 세트 편집
        </h1>
        <span className="ml-auto text-xs text-muted-foreground">변경 사항은 자동 저장됩니다.</span>
      </div>

      {/* 기본 설정 */}
      <div className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-bold">이름</Label>
          <Input
            value={set.name}
            onChange={(e) => updateSet(set.id, { name: e.target.value })}
            placeholder="세트 이름"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-bold">트리거 키</Label>
          <div>
            <KeyCaptureButton
              value={set.trigger}
              onCapture={(code) => updateSet(set.id, { trigger: code })}
              placeholder="트리거 지정"
              className="w-full"
            />
          </div>
        </div>

        {/* 매크로 유형 */}
        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-bold">매크로 유형</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = set.mode === m.v;
              return (
                <button
                  key={m.v}
                  type="button"
                  onClick={() => updateSet(set.id, { mode: m.v })}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 text-xs font-bold transition-colors",
                    active
                      ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))]"
                      : "border-input text-muted-foreground hover:text-foreground hover:bg-accent/10"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {m.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{TRIGGER_MODE_DESC[set.mode]}</p>
        </div>

        {/* 트리거 키 통과 */}
        <div className="flex items-center justify-between rounded-md border bg-background/60 px-3 py-2 md:col-span-2">
          <div>
            <Label className="text-xs font-bold">트리거 키 통과</Label>
            <p className="text-[11px] text-muted-foreground">
              켜면 트리거 키가 게임/OS 로도 전달됩니다. 끄면(기본) 트리거 키 입력을 소비합니다.
            </p>
          </div>
          <Switch
            checked={set.passThrough}
            onCheckedChange={(c) => updateSet(set.id, { passThrough: c })}
          />
        </div>
      </div>

      {/* 스텝 편집 */}
      <div className="rounded-lg border bg-card p-4">
        <StepEditor setId={set.id} steps={set.steps} />
      </div>
    </div>
  );
}
