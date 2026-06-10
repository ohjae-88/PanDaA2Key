import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 짧은 화면 토스트 표시 — body에 1.2s 후 자동 제거. */
let _toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(msg: string): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById("__pk_toast__") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "__pk_toast__";
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:32px",
      "transform:translateX(-50%)",
      "background:rgba(20,20,28,0.92)",
      "color:#34d399",
      "border:1px solid rgba(52,211,153,0.5)",
      "padding:8px 14px",
      "border-radius:8px",
      "font-size:12px",
      "font-weight:700",
      "z-index:2147483647",
      "pointer-events:none",
      "box-shadow:0 4px 12px rgba(0,0,0,0.4)",
      "transition:opacity 0.18s ease",
    ].join(";");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    if (!el) return;
    el.style.opacity = "0";
    _toastTimer = setTimeout(() => {
      el?.remove();
      _toastTimer = null;
    }, 250);
  }, 1200);
}
