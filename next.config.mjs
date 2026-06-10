import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Tauri 정적 export — webview가 bundled HTML 로드
  output: "export",
  images: { unoptimized: true },
  // Tauri는 trailing slash 라우팅을 선호
  trailingSlash: true,
  // 빌드 시 package.json 버전 주입 → 프론트엔드에서 process.env.NEXT_PUBLIC_APP_VERSION 사용
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
