# 아이콘

이 디렉토리에는 다음 파일이 필요합니다 (`tauri.conf.json` 참조):

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (macOS, 빌드 시 생성 가능)
- `icon.ico` (Windows)

## 빠른 생성

1024x1024 PNG 원본 하나만 준비하면 Tauri CLI가 자동으로 생성:

```
npx @tauri-apps/cli icon path/to/source.png
```

생성된 파일들이 이 디렉토리에 자동 배치됩니다.

## 임시 아이콘

Tauri CLI를 처음 실행하면 기본 아이콘이 자동 생성되므로, 별도 준비 없이도 개발/빌드 가능합니다.
프로덕션 배포 전에는 위 명령으로 커스텀 아이콘으로 교체 권장.
