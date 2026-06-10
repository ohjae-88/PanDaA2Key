mod fps;
mod inject;
mod keycodes;
mod macro_engine;
mod resources;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

/// 종료 진행 플래그 — true 시 CloseRequested 의 prevent_close 스킵
struct ExitFlag(AtomicBool);

/// 오버레이 윈도우 라벨
const OVERLAY_LABEL: &str = "overlay";

/// FPS 자동 딜레이 사용 중 — true 면 오버레이를 닫아도 FPS 모니터 유지
static FPS_AUTO: AtomicBool = AtomicBool::new(false);

/// 앱 버전 — 프론트엔드 표시용
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// 메인 윈도우 always-on-top 토글
#[tauri::command]
fn set_always_on_top(window: tauri::Window, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

/// 메인 윈도우 표시
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| e.to_string())?;
        let _ = w.unminimize();
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 앱 완전 종료 — 트레이/숨김 우회
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    if let Some(flag) = app.try_state::<ExitFlag>() {
        flag.0.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

/// 메인 윈도우 숨김 (트레이로 최소화)
#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

// ── 오버레이 윈도우 ──────────────────────────────────────────────

/// 오버레이 윈도우 열기 — 투명/테두리없음/항상위/작업표시줄숨김. 이미 있으면 포커스만.
#[tauri::command]
async fn open_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize, WebviewUrl, WebviewWindowBuilder};
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let (w_size, h_size) = (220.0_f64, 96.0_f64);
    let win = WebviewWindowBuilder::new(&app, OVERLAY_LABEL, WebviewUrl::App("overlay/".into()))
        .title("PANDA KEY 오버레이")
        .inner_size(w_size, h_size)
        .min_inner_size(140.0, 70.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(false)
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| format!("overlay build: {e}"))?;

    // 기본 위치 — 모니터 우상단
    if let Ok(Some(monitor)) = win.current_monitor() {
        let sz = monitor.size();
        let scale = monitor.scale_factor();
        let mw = sz.width as f64 / scale;
        let x = (mw - w_size - 24.0).max(0.0);
        let _ = win.set_position(LogicalPosition::new(x, 48.0));
    }
    let _ = win.set_size(LogicalSize::new(w_size, h_size));
    let _ = app.emit("overlay-state-changed", true);
    // 인게임 FPS 모니터 시작 (PresentMon 있으면 실측)
    fps::start(app.clone());
    Ok(())
}

/// 오버레이 윈도우 닫기 — FPS 자동 딜레이 사용 중이면 모니터는 유지
#[tauri::command]
fn close_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if !FPS_AUTO.load(Ordering::SeqCst) {
        fps::stop();
    }
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        w.close().map_err(|e| e.to_string())?;
        let _ = app.emit("overlay-state-changed", false);
    }
    Ok(())
}

/// FPS 자동 딜레이 사용 여부 — ON 시 오버레이 없이도 FPS 모니터 시작/유지,
/// OFF 시 오버레이도 닫혀 있으면 모니터 정지
#[tauri::command]
fn fps_set_auto(app: tauri::AppHandle, on: bool) {
    FPS_AUTO.store(on, Ordering::SeqCst);
    if on {
        fps::start(app);
    } else if app.get_webview_window(OVERLAY_LABEL).is_none() {
        fps::stop();
    }
}

/// FPS 모니터 보장 — 필요한 상태(자동 딜레이 사용 또는 오버레이 열림)인데
/// 모니터가 죽어 있으면(PresentMon 비정상 종료 등) 재시작. 워치독용, 동작 중이면 no-op.
#[tauri::command]
fn fps_ensure(app: tauri::AppHandle) {
    if fps::is_running() {
        return;
    }
    if FPS_AUTO.load(Ordering::SeqCst) || app.get_webview_window(OVERLAY_LABEL).is_some() {
        fps::start(app);
    }
}

/// PresentMon(FPS 실측) 사용 가능 여부
#[tauri::command]
fn fps_available() -> bool {
    fps::is_available()
}

/// 오버레이 토글 — 열려 있으면 닫고, 없으면 연다. 반환=열림 여부.
#[tauri::command]
async fn toggle_overlay(app: tauri::AppHandle) -> Result<bool, String> {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        close_overlay(app)?;
        Ok(false)
    } else {
        open_overlay(app).await?;
        Ok(true)
    }
}

/// 오버레이 열림 여부
#[tauri::command]
fn is_overlay_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window(OVERLAY_LABEL).is_some()
}

/// 오버레이 클릭 통과 (true=마우스 입력을 아래 창/게임으로 통과)
#[tauri::command]
fn set_overlay_passthrough(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        w.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── 매크로 커맨드 ────────────────────────────────────────────────

/// 매크로 세트 구성 푸시 (프론트 상태 변경 시마다 호출)
#[tauri::command]
fn macro_set_config(sets: Vec<macro_engine::MacroSet>) {
    macro_engine::set_config(sets);
}

/// 엔진 On/Off — On 시 트리거 감지 시작
#[tauri::command]
fn macro_set_running(on: bool) {
    macro_engine::set_running(on);
}

#[tauri::command]
fn macro_is_running() -> bool {
    macro_engine::is_running()
}

/// 모든 활성 매크로 즉시 정지 (엔진 On 유지) — 긴급 정지
#[tauri::command]
fn macro_panic_stop() {
    macro_engine::panic_stop();
}

/// 키 캡처 시작 — 다음 입력 1건을 `macro-key-captured` 이벤트로 전달
#[tauri::command]
fn macro_start_capture() {
    macro_engine::start_capture();
}

#[tauri::command]
fn macro_cancel_capture() {
    macro_engine::cancel_capture();
}

/// 물리 입력(Interception 드라이버) 모드 ON/OFF
#[tauri::command]
fn macro_set_physical(on: bool) {
    inject::set_physical(on);
}

/// Interception 드라이버 사용 가능 여부 (dll + 드라이버 설치)
#[tauri::command]
fn macro_physical_available() -> bool {
    inject::interception_available()
}

/// 활성 창 제한 — 빈 문자열이면 제한 없음
#[tauri::command]
fn macro_set_target(name: String) {
    macro_engine::set_target(name);
}

/// 현재 포그라운드 창 프로세스명
#[tauri::command]
fn macro_foreground_process() -> Option<String> {
    macro_engine::foreground_process()
}

/// 반복 모드 최소 사이클 주기(ms)
#[tauri::command]
fn macro_set_min_cycle(ms: u32) {
    macro_engine::set_min_cycle(ms);
}

/// 다중 실행 모드 — true=배타(일시정지/재개), false=동시
#[tauri::command]
fn macro_set_exec_mode(exclusive: bool) {
    macro_engine::set_exec_mode(exclusive);
}

/// 트리거키 중복 허용 — ON 시 같은 트리거 여러 세트를 항상 동시 실행
#[tauri::command]
fn macro_set_allow_dup_triggers(on: bool) {
    macro_engine::set_allow_dup_triggers(on);
}

/// 전체 ON/OFF 단축키 (키 식별자, null = 해제)
#[tauri::command]
fn macro_set_hotkeys(on: Option<String>, off: Option<String>) {
    macro_engine::set_hotkeys(on, off);
}

/// 통합 토글 단축키 (키 식별자, null = 해제)
#[tauri::command]
fn macro_set_hotkey_toggle(toggle: Option<String>) {
    macro_engine::set_hotkey_toggle(toggle);
}

/// 실행 중인 창 프로세스명 목록 (타이틀 있는 visible 창, 중복 제거)
#[tauri::command]
fn macro_list_windows() -> Vec<String> {
    macro_engine::list_windows()
}

/// Interception 드라이버 설치 — ShellExecuteW("runas") 로 UAC 직접 상승.
/// UAC 프롬프트가 해제될 때까지 블로킹 후 결과 반환.
/// install-interception.exe 가 exe 디렉터리에 있어야 함.
#[tauri::command]
fn install_driver() -> Result<String, String> {
    let installer = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or_else(|| "exe 디렉터리를 확인할 수 없습니다".to_string())?
        .join("install-interception.exe");

    if !installer.exists() {
        return Err(
            "install-interception.exe 를 찾을 수 없습니다. 프로그램을 재설치해 주세요.".into(),
        );
    }

    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let verb = HSTRING::from("runas");
        let file = HSTRING::from(installer.to_string_lossy().as_ref());
        let params = HSTRING::from("/install");

        // ShellExecuteW: UAC 승인/거부 시까지 블로킹 후 반환.
        // 반환값 > 32 = 성공(설치기 실행됨), <= 32 = 오류코드.
        let result = unsafe { ShellExecuteW(None, &verb, &file, &params, None, SW_SHOWNORMAL) };
        let code = result.0 as isize;

        return if code > 32 {
            Ok("설치기가 실행되었습니다. 완료 후 재부팅이 필요합니다.".into())
        } else if code == 5 {
            Err("UAC에서 취소되었습니다.".into())
        } else {
            Err(format!("설치기 실행 실패 (오류 코드: {code})"))
        };
    }

    #[allow(unreachable_code)]
    Err("Windows 전용 기능입니다.".into())
}

/// Interception 드라이버 제거 — 앱이 관리자 권한으로 실행되므로 직접 ExecWait.
/// 완전 제거에는 재부팅 필요.
#[tauri::command]
fn uninstall_driver() -> Result<String, String> {
    let installer = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or_else(|| "exe 디렉터리를 확인할 수 없습니다".to_string())?
        .join("install-interception.exe");

    if !installer.exists() {
        return Err("install-interception.exe 를 찾을 수 없습니다.".into());
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let status = std::process::Command::new(&installer)
            .arg("/uninstall")
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("제거기 실행 실패: {e}"))?;
        return if status.success() {
            Ok("드라이버 제거가 완료되었습니다. 재부팅 후 완전히 적용됩니다.".into())
        } else {
            Err(format!("제거기 종료 코드: {:?}", status.code()))
        };
    }

    #[allow(unreachable_code)]
    Err("Windows 전용 기능입니다.".into())
}

/// 업데이트 실패 로그를 앱 로그 디렉터리에 저장. 저장된 파일 전체 경로를 반환.
#[tauri::command]
fn save_update_error_log(app: tauri::AppHandle, content: String) -> Result<String, String> {
    use tauri::Manager;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("로그 디렉터리 조회 실패: {e}"))?;
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("로그 디렉터리 생성 실패: {e}"))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let path = log_dir.join(format!("update-error-{ts}.txt"));
    std::fs::write(&path, content.as_bytes()).map_err(|e| format!("파일 쓰기 실패: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// 기본 브라우저로 URL 열기 (ShellExecuteW "open")
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let verb = HSTRING::from("open");
        let file = HSTRING::from(url.as_str());
        unsafe { ShellExecuteW(None, &verb, &file, None, None, SW_SHOWNORMAL) };
    }
    Ok(())
}

/// WebView2 런타임 부재 확인 — 포터블 exe 의 유일한 외부 의존성.
/// 없으면 안내 메시지박스 + 다운로드 페이지를 열고 true(중단) 반환.
fn webview2_missing() -> bool {
    if tauri::webview_version().is_ok() {
        return false;
    }
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK, SW_SHOWNORMAL};
        let title = HSTRING::from("PANDA KEY — WebView2 필요");
        let text = HSTRING::from(
            "이 프로그램을 실행하려면 Microsoft Edge WebView2 런타임이 필요합니다.\n\n\
             확인을 누르면 다운로드 페이지가 열립니다.\n\
             설치 후 프로그램을 다시 실행해 주세요.",
        );
        MessageBoxW(None, &text, &title, MB_OK | MB_ICONERROR);
        let verb = HSTRING::from("open");
        let url = HSTRING::from("https://developer.microsoft.com/microsoft-edge/webview2/");
        ShellExecuteW(None, &verb, &url, None, None, SW_SHOWNORMAL);
    }
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebView2 없으면 안내 후 종료 (포터블 배포 대응)
    if webview2_missing() {
        return;
    }
    // 내장 리소스(드라이버 dll/설치기, PresentMon) 추출 — 포터블 단일 exe 지원
    resources::extract_all();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                // 로그 파일 1개만 유지 — 디스크 무한 누적 방지(경량/안정)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .manage(ExitFlag(AtomicBool::new(false)))
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            // 매크로 엔진 초기화 — 저수준 후킹 스레드 설치 (running=false 로 대기)
            macro_engine::init(app.handle().clone());

            // 트레이 아이콘 + 메뉴
            let open_main = MenuItem::with_id(app, "open_main", "프로그램 열기", true, None::<&str>)?;
            let panic = MenuItem::with_id(app, "panic", "긴급 정지", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_main, &panic, &sep, &quit])?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("PANDA KEY")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open_main" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "panic" => macro_engine::panic_stop(),
                    "quit" => {
                        if let Some(flag) = app.try_state::<ExitFlag>() {
                            flag.0.store(true, Ordering::SeqCst);
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let visible = w.is_visible().unwrap_or(false);
                            if visible {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            let _ = (open_main, panic, sep, quit);

            // X 클릭 시 트레이로 숨김 (백그라운드 매크로 유지). 종료는 트레이 메뉴/exit_app.
            if let Some(main_win) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let exiting = app_handle
                            .try_state::<ExitFlag>()
                            .map(|f| f.0.load(Ordering::SeqCst))
                            .unwrap_or(false);
                        if exiting {
                            return;
                        }
                        // 닫기 보류 → 프론트에 선택 다이얼로그 표시(종료/트레이/취소)
                        api.prevent_close();
                        let _ = app_handle.emit("main-close-requested", ());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            set_always_on_top,
            show_main_window,
            hide_main_window,
            exit_app,
            open_overlay,
            close_overlay,
            toggle_overlay,
            is_overlay_open,
            set_overlay_passthrough,
            fps_available,
            fps_set_auto,
            fps_ensure,
            macro_set_config,
            macro_set_running,
            macro_is_running,
            macro_panic_stop,
            macro_start_capture,
            macro_cancel_capture,
            macro_set_physical,
            macro_physical_available,
            macro_set_target,
            macro_foreground_process,
            macro_set_min_cycle,
            macro_set_exec_mode,
            macro_set_allow_dup_triggers,
            macro_set_hotkeys,
            macro_set_hotkey_toggle,
            macro_list_windows,
            install_driver,
            uninstall_driver,
            save_update_error_log,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
