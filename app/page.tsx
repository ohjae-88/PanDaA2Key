"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 정적 export 호환 — / → /macro 클라이언트 리다이렉트
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/macro");
  }, [router]);
  return null;
}
