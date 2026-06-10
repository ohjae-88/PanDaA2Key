//! 내장 리소스 추출 — 포터블 단일 exe 지원.
//!
//! interception.dll / install-interception.exe / PresentMon.exe 를 바이너리에 내장하고
//! 앱 시작 시 exe 디렉터리에 추출한다 (합계 ~1.4MB).
//! - NSIS 설치본: 파일이 이미 존재 + 크기 동일 → 추출 생략 (no-op)
//! - 포터블 exe: 첫 실행 시 추출 → 기존 "exe 옆 탐색" 코드가 그대로 동작
//! - 쓰기 실패(권한 등)는 경고만 — 해당 기능(물리 입력/FPS)만 비활성될 뿐 앱은 동작

const FILES: &[(&str, &[u8])] = &[
    ("interception.dll", include_bytes!("../../driver/interception.dll")),
    (
        "install-interception.exe",
        include_bytes!("../../driver/install-interception.exe"),
    ),
    ("PresentMon.exe", include_bytes!("../tools/PresentMon.exe")),
];

/// 누락되거나 크기가 다른 내장 리소스를 exe 디렉터리에 추출.
pub fn extract_all() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else {
        return;
    };
    for (name, bytes) in FILES {
        let path = dir.join(name);
        let needs_write = match std::fs::metadata(&path) {
            Ok(m) => m.len() != bytes.len() as u64,
            Err(_) => true,
        };
        if !needs_write {
            continue;
        }
        match std::fs::write(&path, bytes) {
            Ok(()) => log::info!("리소스 추출: {} ({} bytes)", path.display(), bytes.len()),
            Err(e) => log::warn!("리소스 추출 실패: {} — {e}", path.display()),
        }
    }
}
