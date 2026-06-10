"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Layers, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMacroStore } from "@/lib/macro/store";
import { inputLabel } from "@/lib/macro/keys";
import { showToast } from "@/lib/utils";

/**
 * 프리셋 패널 — 사전에 매크로 세트 묶음을 정의하고,
 * "선택"으로 멤버는 활성화 / 나머지는 비활성화(로드아웃) 일괄 적용.
 */
export function PresetsPanel() {
  const groups = useMacroStore((s) => s.groups);
  const sets = useMacroStore((s) => s.sets);
  const addGroup = useMacroStore((s) => s.addGroup);
  const removeGroup = useMacroStore((s) => s.removeGroup);
  const renameGroup = useMacroStore((s) => s.renameGroup);
  const toggleGroupMember = useMacroStore((s) => s.toggleGroupMember);
  const applyPreset = useMacroStore((s) => s.applyPreset);

  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-[hsl(var(--cat-macro))]" />
        <span className="font-extrabold">프리셋</span>
        <span className="text-[11px] text-muted-foreground">
          프리셋을 선택하면 멤버 매크로는 활성화, 나머지는 비활성화됩니다.
        </span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setExpanded(addGroup())}>
          <Plus className="h-4 w-4" /> 프리셋 추가
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">
          프리셋이 없습니다. “프리셋 추가”로 만들고 포함할 매크로를 선택하세요.
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = expanded === g.id;
            return (
              <div key={g.id} className="rounded-md border">
                <div className="flex items-center gap-2 p-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : g.id)}
                    className="text-muted-foreground hover:text-foreground"
                    title="포함 매크로 선택"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <Input
                    value={g.name}
                    onChange={(e) => renameGroup(g.id, e.target.value)}
                    className="h-8 max-w-[200px]"
                  />
                  <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {g.memberIds.length}개
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={g.memberIds.length === 0}
                      onClick={() => {
                        applyPreset(g.id);
                        showToast(`프리셋 적용 — '${g.name}'`);
                      }}
                      title="이 프리셋을 적용 (멤버 ON / 나머지 OFF)"
                    >
                      <Play className="h-3.5 w-3.5" /> 선택
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`'${g.name}' 프리셋을 삭제할까요? (매크로는 삭제되지 않음)`)) removeGroup(g.id);
                      }}
                      title="프리셋 삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t p-2">
                    {sets.length === 0 ? (
                      <div className="py-2 text-center text-xs text-muted-foreground">매크로가 없습니다.</div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {sets.map((s) => {
                          const inGroup = g.memberIds.includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => toggleGroupMember(g.id, s.id)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                                inGroup
                                  ? "border-[hsl(var(--cat-macro))] bg-[hsl(var(--cat-macro))]/15 text-[hsl(var(--cat-macro))] font-bold"
                                  : "border-input text-muted-foreground hover:bg-accent/10"
                              )}
                            >
                              <span
                                className={cn(
                                  "flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px]",
                                  inGroup ? "border-current bg-current/20" : "border-input"
                                )}
                              >
                                {inGroup ? "✓" : ""}
                              </span>
                              {s.name}
                              {s.trigger && (
                                <span className="text-[10px] opacity-70">({inputLabel(s.trigger)})</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
