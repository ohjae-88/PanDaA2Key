"use client";

import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showToast } from "@/lib/utils";
import { useMacroStore } from "@/lib/macro/store";
import { buildExport, parseImport, exportFileName } from "@/lib/macro/io";

export function SaveLoad() {
  const applyImport = useMacroStore((s) => s.applyImport);
  const fileRef = useRef<HTMLInputElement>(null);

  function doExport() {
    const data = buildExport(useMacroStore.getState());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`내보내기 완료 (세트 ${data.sets.length}개)`);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = parseImport(String(reader.result));
        const has = useMacroStore.getState().sets.length > 0;
        let mode: "replace" | "merge" = "replace";
        if (has) {
          const replace = window.confirm(
            `불러올 세트 ${payload.sets.length}개.\n\n확인 = 기존 매크로 교체\n취소 = 기존에 추가(병합)`
          );
          mode = replace ? "replace" : "merge";
        }
        applyImport(payload, mode);
        showToast(`불러오기 완료 (${mode === "replace" ? "교체" : "추가"} · ${payload.sets.length}개)`);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "불러오기 실패");
      }
    };
    reader.readAsText(file);
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={doExport} data-capture-ignore title="현재 매크로/설정을 파일로 저장">
        <Download className="h-4 w-4" /> 내보내기
      </Button>
      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} data-capture-ignore title="파일에서 매크로/설정 불러오기">
        <Upload className="h-4 w-4" /> 불러오기
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={onPick}
        className="hidden"
      />
    </>
  );
}
