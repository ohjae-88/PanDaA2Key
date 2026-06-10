//! 매크로 실행 엔진.
//!
//! 구조
//! - Windows 저수준 후킹(WH_KEYBOARD_LL / WH_MOUSE_LL)으로 트리거 키의 누르기/때기 감지
//! - 우리가 주입한 입력은 dwExtraInfo 서명(INJECT_SIGNATURE)으로 구분해 무시 (재귀 차단)
//! - 트리거 감지 시 세트별 워커 스레드가 스텝 시퀀스를 SendInput 으로 주입
//! - 여러 세트가 동시에 활성화될 수 있어 혼합 실행이 자연스럽게 지원됨
//!   (A 누름→1번 반복 중 B 누름→2번 실행, B 때기→2번 종료 후 1번 지속)
//!
//! 후킹 스레드는 앱 시작 시 1회 설치되어 프로세스 종료까지 유지된다.
//! `running` 플래그가 트리거 처리, `capture` 플래그가 키 캡처를 게이트한다.

use serde::Deserialize;

/// 트리거 동작 모드
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    /// 1회
    Once,
    /// 누르는 동안 반복
    WhileHeld,
    /// 한번 클릭 시 무한 반복, 같은 키 다시 누르면 멈춤
    ToggleSame,
    /// 한번 클릭 시 무한 반복, 아무 키나 누르면 멈춤
    ToggleAny,
}

/// 스텝 동작 — 탭(누르고 떼기) / 누르기(유지) / 때기 / 지연
#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepAction {
    Tap,
    Press,
    Release,
    /// 지연 — 키 없이 delay_ms 만큼 대기 (시퀀스 사이 간격)
    Delay,
}

/// 매크로 한 스텝 — 키/버튼 동작 또는 지연.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroStep {
    pub input: String,
    pub action: StepAction,
    /// tap 의 누름 유지 시간(ms) — 그 외 미사용
    pub hold_ms: u64,
    /// delay 의 대기 시간(ms) — 그 외 미사용
    pub delay_ms: u64,
}

/// 매크로 세트
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroSet {
    pub id: String,
    /// 프론트 식별용 — Rust 엔진에서는 사용하지 않음 (직렬화 계약 유지)
    #[allow(dead_code)]
    pub name: String,
    /// 트리거 입력 이름 (keys.ts 식별자)
    pub trigger: String,
    pub mode: TriggerMode,
    /// 트리거 키를 게임/OS 로 통과시킬지 여부 (false = 소비)
    pub pass_through: bool,
    pub enabled: bool,
    pub steps: Vec<MacroStep>,
}

#[cfg(windows)]
mod platform {
    use super::{MacroSet, StepAction, TriggerMode};
    use crate::inject;
    use crate::keycodes::{self, InputKind, MouseBtn};
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::{Arc, Condvar, Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{BOOL, CloseHandle, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowThreadProcessId,
        IsWindowVisible,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
        HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL,
        WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN,
        WM_MBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN,
        WM_XBUTTONUP,
    };

    /// 주입 입력 서명 — inject 모듈과 공유 (SendInput dwExtraInfo).
    const INJECT_SIGNATURE: usize = inject::SIGNATURE;

    /// 워커 정지 신호 — Condvar 로 즉시 깨워 트리거 해제 시 지연 없이 중지.
    struct StopFlag {
        m: Mutex<bool>,
        c: Condvar,
    }
    impl StopFlag {
        fn new() -> Self {
            StopFlag { m: Mutex::new(false), c: Condvar::new() }
        }
        fn stop(&self) {
            let mut g = self.m.lock().unwrap();
            *g = true;
            self.c.notify_all();
        }
        fn stopped(&self) -> bool {
            *self.m.lock().unwrap()
        }
        /// ms 동안 대기하되 정지 시 즉시 반환. true=완료(타임아웃), false=정지됨.
        fn wait(&self, ms: u64) -> bool {
            if ms == 0 {
                return !self.stopped();
            }
            let g = self.m.lock().unwrap();
            if *g {
                return false;
            }
            let (g, _) = self
                .c
                .wait_timeout_while(g, Duration::from_millis(ms), |stopped| !*stopped)
                .unwrap();
            !*g
        }
    }

    /// 트리거/스텝 컴파일 결과 — 핫패스에서 문자열 파싱을 피한다.
    #[derive(Clone)]
    struct CompiledStep {
        kind: InputKind,
        action: StepAction,
        hold_ms: u64,
        delay_ms: u64,
    }

    #[derive(Clone)]
    struct CompiledSet {
        id: String,
        mode: TriggerMode,
        pass_through: bool,
        enabled: bool,
        trigger: InputKind,
        steps: Vec<CompiledStep>,
    }

    struct EngineInner {
        sets: Vec<CompiledSet>,
        /// 세트 id → 정지 신호 (워커 스레드 제어)
        active: HashMap<String, Arc<StopFlag>>,
        /// 현재 물리적으로 눌린 키(vk) — 자동반복(auto-repeat) keydown 식별용
        held_keys: HashSet<u16>,
        /// 활성 창 제한 — 비어있지 않으면 해당 프로세스가 포그라운드일 때만 트리거 동작(소문자)
        target_process: String,
        /// 배타 모드 우선순위 스택 (마지막 = 현재 실행 중, 나머지 = 일시정지)
        stack: Vec<String>,
        app: Option<AppHandle>,
    }

    static ENGINE: OnceLock<Mutex<EngineInner>> = OnceLock::new();
    static RUNNING: AtomicBool = AtomicBool::new(false);
    static CAPTURE: AtomicBool = AtomicBool::new(false);
    static HOOK_STARTED: AtomicBool = AtomicBool::new(false);
    /// 전체 ON/OFF 단축키 — 복합 단축키 패킹값 (mods << 16 | vk), 0 = 미설정.
    /// mods 비트: 1=Ctrl, 2=Shift, 4=Alt. vk=본 키 가상 키코드.
    static HOTKEY_ON: AtomicU32 = AtomicU32::new(0);
    static HOTKEY_OFF: AtomicU32 = AtomicU32::new(0);
    /// 통합 토글 단축키 — 누를 때마다 ON↔OFF 전환.
    static HOTKEY_TOGGLE: AtomicU32 = AtomicU32::new(0);
    /// 반복 모드 최소 사이클 주기(ms) — 입력 폭주/렉 방지. 사용자 설정 가능.
    static MIN_CYCLE_MS: AtomicU32 = AtomicU32::new(16);
    /// 배타 실행 모드 — true 면 새 매크로 시작 시 기존을 일시정지(스택), 종료 시 재개.
    static EXCLUSIVE: AtomicBool = AtomicBool::new(false);
    /// 트리거키 중복 허용 — true 면 같은 트리거 여러 세트를 항상 동시 실행 (EXCLUSIVE 무시).
    static ALLOW_DUP_TRIGGERS: AtomicBool = AtomicBool::new(false);

    fn engine() -> &'static Mutex<EngineInner> {
        ENGINE.get_or_init(|| {
            Mutex::new(EngineInner {
                sets: Vec::new(),
                active: HashMap::new(),
                held_keys: HashSet::new(),
                target_process: String::new(),
                stack: Vec::new(),
                app: None,
            })
        })
    }

    /// 후킹으로 들어온 원시 입력
    enum Incoming {
        Key { vk: u16, extended: bool },
        Mouse(MouseBtn),
    }

    fn incoming_name(inc: &Incoming) -> String {
        match inc {
            Incoming::Key { vk, extended } => keycodes::key_to_name(*vk, *extended),
            Incoming::Mouse(b) => keycodes::mouse_to_name(*b).to_string(),
        }
    }

    fn matches_trigger(inc: &Incoming, trig: &InputKind) -> bool {
        match (inc, trig) {
            (Incoming::Key { vk, extended }, InputKind::Key { vk: tvk, extended: text }) => {
                vk == tvk && extended == text
            }
            (Incoming::Mouse(b), InputKind::Mouse(tb)) => b == tb,
            _ => false,
        }
    }

    // ── 설정 / 상태 ───────────────────────────────────────────────

    pub fn init(app: AppHandle) {
        {
            let mut inner = engine().lock().unwrap();
            inner.app = Some(app);
        }
        // 후킹 스레드는 1회만 설치
        if HOOK_STARTED.swap(true, Ordering::SeqCst) {
            return;
        }
        thread::spawn(hook_thread_main);
    }

    pub fn set_config(sets: Vec<MacroSet>) {
        let compiled: Vec<CompiledSet> = sets.iter().filter_map(compile_set).collect();
        let mut inner = engine().lock().unwrap();
        inner.sets = compiled;
        // 더 이상 유효하지 않은(삭제/비활성) 활성 매크로 정지
        let valid: HashSet<String> = inner
            .sets
            .iter()
            .filter(|s| s.enabled)
            .map(|s| s.id.clone())
            .collect();
        let mut to_stop: Vec<String> = inner
            .active
            .keys()
            .filter(|id| !valid.contains(*id))
            .cloned()
            .collect();
        // 배타 모드: 스택에 일시정지 상태로 남은 무효 세트도 정리
        for id in inner.stack.iter() {
            if !valid.contains(id) && !to_stop.contains(id) {
                to_stop.push(id.clone());
            }
        }
        for id in to_stop {
            end(&mut inner, &id);
        }
    }

    fn compile_set(s: &MacroSet) -> Option<CompiledSet> {
        let trigger = keycodes::parse_input(&s.trigger)?;
        let steps = s
            .steps
            .iter()
            .filter_map(|st| {
                keycodes::parse_input(&st.input).map(|k| CompiledStep {
                    kind: k,
                    action: st.action,
                    hold_ms: st.hold_ms,
                    delay_ms: st.delay_ms,
                })
            })
            .collect();
        Some(CompiledSet {
            id: s.id.clone(),
            mode: s.mode,
            pass_through: s.pass_through,
            enabled: s.enabled,
            trigger,
            steps,
        })
    }

    fn apply_running(on: bool) {
        RUNNING.store(on, Ordering::SeqCst);
        let mut inner = engine().lock().unwrap();
        // 눌림 상태 리셋 — 켤 때 직전 키 잔상 제거(첫 트리거를 fresh 로 인식)
        inner.held_keys.clear();
        if !on {
            stop_all(&mut inner);
        }
        // 프론트 동기화 (단축키로 토글된 경우 UI 반영)
        if let Some(app) = &inner.app {
            let _ = app.emit("macro-running-changed", on);
        }
    }

    pub fn set_running(on: bool) {
        apply_running(on);
    }

    pub fn is_running() -> bool {
        RUNNING.load(Ordering::SeqCst)
    }

    /// 활성 창 제한 설정 — 빈 문자열이면 제한 없음
    pub fn set_target(name: String) {
        let mut inner = engine().lock().unwrap();
        inner.target_process = name.trim().to_lowercase();
    }

    /// 반복 모드 최소 사이클 주기(ms) 설정 (1 이상)
    pub fn set_min_cycle(ms: u32) {
        MIN_CYCLE_MS.store(ms.max(1), Ordering::SeqCst);
    }

    /// 다중 실행 모드 — true=배타(일시정지/재개), false=동시
    pub fn set_exec_mode(exclusive: bool) {
        EXCLUSIVE.store(exclusive, Ordering::SeqCst);
        // 모드 전환 시 진행 중이던 매크로/스택 정리 (혼선 방지)
        let mut inner = engine().lock().unwrap();
        stop_all(&mut inner);
    }

    /// 트리거키 중복 허용 — ON 시 동일 트리거 여러 세트를 항상 동시 실행
    pub fn set_allow_dup_triggers(on: bool) {
        ALLOW_DUP_TRIGGERS.store(on, Ordering::SeqCst);
    }

    /// 전체 ON/OFF 단축키 설정.
    /// 복합 단축키 문자열("Shift+Home", "Ctrl+Shift+KeyK", "Home")을 받아
    /// (mods << 16 | vk) 로 패킹. None/미인식/본 키 없음 = 해제(0).
    pub fn set_hotkeys(on: Option<String>, off: Option<String>) {
        HOTKEY_ON.store(parse_hotkey(on), Ordering::SeqCst);
        HOTKEY_OFF.store(parse_hotkey(off), Ordering::SeqCst);
    }

    pub fn set_hotkey_toggle(toggle: Option<String>) {
        HOTKEY_TOGGLE.store(parse_hotkey(toggle), Ordering::SeqCst);
    }

    /// 복합 단축키 문자열 → 패킹값. 본 키가 없으면 0.
    fn parse_hotkey(s: Option<String>) -> u32 {
        let Some(s) = s else { return 0 };
        let mut mods: u32 = 0;
        let mut vk: u32 = 0;
        for tok in s.split('+') {
            match tok.trim() {
                "" => {}
                "Ctrl" | "Control" => mods |= 1,
                "Shift" => mods |= 2,
                "Alt" | "Menu" => mods |= 4,
                other => {
                    if let Some(InputKind::Key { vk: v, .. }) = keycodes::parse_input(other) {
                        vk = v as u32;
                    }
                }
            }
        }
        if vk == 0 {
            0
        } else {
            (mods << 16) | vk
        }
    }

    /// 패킹된 단축키가 현재 입력(본 키 vk down)으로 충족되는지.
    /// 본 키 일치 + 지정 수식키가 모두 눌려 있으면 true.
    fn hotkey_down(packed: u32, vk: u32) -> bool {
        if packed == 0 || (packed & 0xFFFF) != vk {
            return false;
        }
        let mods = packed >> 16;
        let down = |k: i32| -> bool { unsafe { (GetAsyncKeyState(k) as u16 & 0x8000) != 0 } };
        let need = |want: bool, pressed: bool| !want || pressed;
        // VK_CONTROL=0x11, VK_SHIFT=0x10, VK_MENU(Alt)=0x12
        need(mods & 1 != 0, down(0x11))
            && need(mods & 2 != 0, down(0x10))
            && need(mods & 4 != 0, down(0x12))
    }

    /// 현재 포그라운드 창의 프로세스 실행 파일명 (예: "game.exe")
    pub fn foreground_process() -> Option<String> {
        foreground_process_name()
    }

    /// 현재 실행 중인 창(타이틀 있는 visible 창) 의 프로세스명 목록 — 중복 제거, 알파벳 정렬.
    pub fn list_windows() -> Vec<String> {
        use std::collections::BTreeSet;

        let mut names: BTreeSet<String> = BTreeSet::new();

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
                return BOOL(1);
            }
            let seen = &mut *(lparam.0 as *mut std::collections::BTreeSet<String>);
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return BOOL(1);
            }
            if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buf = [0u16; 260];
                let mut size = buf.len() as u32;
                if QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    PWSTR(buf.as_mut_ptr()),
                    &mut size,
                )
                .is_ok()
                {
                    let path = String::from_utf16_lossy(&buf[..size as usize]);
                    if let Some(name) =
                        path.rsplit(|c: char| c == '\\' || c == '/').next()
                    {
                        if !name.is_empty() {
                            seen.insert(name.to_string());
                        }
                    }
                }
                let _ = CloseHandle(handle);
            }
            BOOL(1)
        }

        unsafe {
            let _ = EnumWindows(
                Some(enum_proc),
                LPARAM(&mut names as *mut BTreeSet<String> as isize),
            );
        }

        names.into_iter().collect()
    }

    fn foreground_process_name() -> Option<String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return None;
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 260];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(handle);
            ok.ok()?;
            let path = String::from_utf16_lossy(&buf[..size as usize]);
            let name = path
                .rsplit(|c| c == '\\' || c == '/')
                .next()
                .unwrap_or(&path)
                .to_string();
            if name.is_empty() {
                None
            } else {
                Some(name)
            }
        }
    }

    /// 포그라운드 프로세스명 1초 TTL 캐시 — 훅 콜백(키 입력 경로)에서
    /// 매 키마다 OpenProcess/QueryFullProcessImageNameW 호출을 방지.
    /// 창 전환 후 최대 1초간 이전 값이 유지될 수 있으나 매크로 시작 게이트 용도로는 충분.
    fn foreground_process_cached() -> Option<String> {
        static CACHE: OnceLock<Mutex<(Option<String>, Option<Instant>)>> = OnceLock::new();
        let cache = CACHE.get_or_init(|| Mutex::new((None, None)));
        let mut c = cache.lock().unwrap();
        if let Some(at) = c.1 {
            if at.elapsed() < Duration::from_secs(1) {
                return c.0.clone();
            }
        }
        let name = foreground_process_name();
        *c = (name.clone(), Some(Instant::now()));
        name
    }

    /// 모든 활성 매크로 즉시 정지 (엔진은 켜진 상태 유지) — 긴급 정지용
    pub fn panic_stop() {
        let mut inner = engine().lock().unwrap();
        stop_all(&mut inner);
    }

    pub fn start_capture() {
        CAPTURE.store(true, Ordering::SeqCst);
    }

    pub fn cancel_capture() {
        CAPTURE.store(false, Ordering::SeqCst);
    }

    // ── 워커 제어 (잠금 보유 상태에서 호출) ───────────────────────

    fn emit_active(inner: &EngineInner, id: &str, active: bool) {
        if let Some(app) = &inner.app {
            let _ = app.emit("macro-set-active", serde_json::json!({ "id": id, "active": active }));
        }
    }

    // ── 저수준 워커 (잠금 보유) — 스택/이벤트 처리 없음 ───────────

    fn start_worker(inner: &mut EngineInner, set: &CompiledSet) {
        if inner.active.contains_key(&set.id) || set.steps.is_empty() {
            return;
        }
        let stop = Arc::new(StopFlag::new());
        inner.active.insert(set.id.clone(), stop.clone());
        let steps = set.steps.clone();
        let mode = set.mode;
        let id = set.id.clone();
        thread::spawn(move || {
            run_macro(&steps, mode, &stop);
            finish_runner(&id, &stop);
        });
    }

    fn stop_worker(inner: &mut EngineInner, id: &str) {
        if let Some(stop) = inner.active.remove(id) {
            stop.stop(); // Condvar 로 즉시 깨움
        }
    }

    fn set_by_id(inner: &EngineInner, id: &str) -> Option<CompiledSet> {
        inner.sets.iter().find(|s| s.id == id).cloned()
    }

    // ── 상위 트리거 제어 (begin/end) ─────────────────────────────

    /// 트리거 시작 — 동시 모드는 그대로 실행, 배타 모드는 이전 상위를 일시정지하고 최상위로.
    /// ALLOW_DUP_TRIGGERS=true 이면 항상 동시 실행(EXCLUSIVE 무시).
    fn begin(inner: &mut EngineInner, set: &CompiledSet) {
        if set.steps.is_empty() {
            return;
        }
        let use_exclusive = EXCLUSIVE.load(Ordering::Relaxed)
            && !ALLOW_DUP_TRIGGERS.load(Ordering::Relaxed);
        if use_exclusive {
            if inner.stack.iter().any(|x| x == &set.id) {
                return;
            }
            // 현재 최상위 일시정지(워커만 정지, 스택엔 유지)
            if let Some(top) = inner.stack.last().cloned() {
                stop_worker(inner, &top);
            }
            inner.stack.push(set.id.clone());
            start_worker(inner, set);
            emit_active(inner, &set.id, true);
        } else {
            if inner.active.contains_key(&set.id) {
                return;
            }
            start_worker(inner, set);
            emit_active(inner, &set.id, true);
        }
    }

    /// 트리거 종료 — 배타 모드는 스택에서 제거 후, 최상위였다면 직전 항목 재개.
    /// ALLOW_DUP_TRIGGERS=true 이면 항상 동시 종료(EXCLUSIVE 무시).
    fn end(inner: &mut EngineInner, id: &str) {
        let use_exclusive = EXCLUSIVE.load(Ordering::Relaxed)
            && !ALLOW_DUP_TRIGGERS.load(Ordering::Relaxed);
        if use_exclusive {
            if let Some(pos) = inner.stack.iter().position(|x| x == id) {
                let was_last = pos + 1 == inner.stack.len();
                inner.stack.remove(pos);
                stop_worker(inner, id);
                emit_active(inner, id, false);
                if was_last {
                    if let Some(top) = inner.stack.last().cloned() {
                        if let Some(set) = set_by_id(inner, &top) {
                            start_worker(inner, &set);
                        }
                    }
                }
            }
        } else if inner.active.contains_key(id) {
            stop_worker(inner, id);
            emit_active(inner, id, false);
        }
    }

    fn stop_all(inner: &mut EngineInner) {
        let mut all: Vec<String> = inner.active.keys().cloned().collect();
        for id in inner.stack.iter() {
            if !all.contains(id) {
                all.push(id.clone());
            }
        }
        inner.stack.clear();
        for id in &all {
            stop_worker(inner, id);
            emit_active(inner, id, false);
        }
    }

    /// 워커 자연 종료(Once 완료 등). 명시적으로 정지(스택/active 에서 제거)된 경우는 무시.
    fn finish_runner(id: &str, stop: &Arc<StopFlag>) {
        let mut guard = engine().lock().unwrap();
        let inner = &mut *guard;
        let is_current = inner
            .active
            .get(id)
            .map_or(false, |cur| Arc::ptr_eq(cur, stop));
        if !is_current {
            return; // 일시정지/명시정지로 이미 교체됨 → 처리 안 함
        }
        inner.active.remove(id);
        let use_exclusive = EXCLUSIVE.load(Ordering::Relaxed)
            && !ALLOW_DUP_TRIGGERS.load(Ordering::Relaxed);
        if use_exclusive {
            if let Some(pos) = inner.stack.iter().position(|x| x == id) {
                let was_last = pos + 1 == inner.stack.len();
                inner.stack.remove(pos);
                emit_active(inner, id, false);
                if was_last {
                    if let Some(top) = inner.stack.last().cloned() {
                        if let Some(set) = set_by_id(inner, &top) {
                            start_worker(inner, &set);
                        }
                    }
                }
            } else {
                emit_active(inner, id, false);
            }
        } else {
            emit_active(inner, id, false);
        }
    }

    // ── 매크로 실행 (워커 스레드) ─────────────────────────────────

    fn run_macro(steps: &[CompiledStep], mode: TriggerMode, stop: &Arc<StopFlag>) {
        if steps.is_empty() {
            return;
        }
        // 이 워커가 현재 누르고 있는 키들 — 사이클을 넘어 유지된다.
        // (때기 없이 끝나는 키는 다음 사이클에서도 계속 눌린 상태로 지속)
        // 반복 모드의 최소 사이클 주기(ms) — 입력 폭주/시스템 렉 방지(사용자 설정).
        let min_cycle = MIN_CYCLE_MS.load(Ordering::Relaxed) as u64;
        let mut held: Vec<InputKind> = Vec::new();
        'outer: loop {
            // 이번 사이클에서 의도된 총 대기(ms) 누적
            let mut cycle_ms: u64 = 0;
            for st in steps {
                if stop.stopped() {
                    break 'outer;
                }
                match st.action {
                    StepAction::Tap => {
                        // 누르고 → hold_ms 유지 → 떼기
                        let already = held.iter().any(|k| *k == st.kind);
                        if !already {
                            inject::send(st.kind, true);
                        }
                        if !stop.wait(st.hold_ms) {
                            inject::send(st.kind, false);
                            if let Some(pos) = held.iter().position(|k| *k == st.kind) {
                                held.remove(pos);
                            }
                            break 'outer;
                        }
                        cycle_ms += st.hold_ms;
                        inject::send(st.kind, false);
                        if let Some(pos) = held.iter().position(|k| *k == st.kind) {
                            held.remove(pos);
                        }
                    }
                    StepAction::Press => {
                        // 이미 눌려있으면 재입력하지 않고 유지 (지속 누름)
                        if !held.iter().any(|k| *k == st.kind) {
                            inject::send(st.kind, true);
                            held.push(st.kind);
                        }
                    }
                    StepAction::Release => {
                        if let Some(pos) = held.iter().position(|k| *k == st.kind) {
                            inject::send(st.kind, false);
                            held.remove(pos);
                        }
                    }
                    StepAction::Delay => {
                        if !stop.wait(st.delay_ms) {
                            break 'outer;
                        }
                        cycle_ms += st.delay_ms;
                    }
                }
            }
            match mode {
                TriggerMode::Once => break,
                _ => {
                    if stop.stopped() {
                        break;
                    }
                    // 사이클이 너무 빠르면(지연 미설정 등) 최소 주기까지 보충 대기
                    if cycle_ms < min_cycle {
                        if !stop.wait(min_cycle - cycle_ms) {
                            break;
                        }
                    }
                }
            }
        }
        // 정지/종료 시 — 남아있는 눌림 키 모두 떼기 (키 끼임 방지)
        for kind in held.drain(..) {
            inject::send(kind, false);
        }
    }

    // ── 후킹 처리 ─────────────────────────────────────────────────

    /// 입력 한 건 처리. 반환값 true = 이벤트 소비(게임/OS 로 전달 차단).
    fn handle_incoming(inc: Incoming, is_down: bool, is_up: bool) -> bool {
        let capturing = CAPTURE.load(Ordering::Relaxed);
        let running = RUNNING.load(Ordering::Relaxed);
        if !capturing && !running {
            return false;
        }

        let mut guard = engine().lock().unwrap();
        let inner: &mut EngineInner = &mut guard;

        // 키 바인딩(캡처) 모드 — 트리거 처리/소비를 하지 않고 통과시킨다.
        // 실제 캡처는 프론트의 DOM(capture phase) 리스너가 수행한다(앱 창 포커스 상태).
        // 여기서 소비하면 웹뷰가 keydown 을 못 받아 DOM 캡처가 실패하므로 반드시 통과.
        // 또한 바인딩 중 트리거가 발동하지 않도록 트리거 로직을 건너뛴다.
        // 캡처/녹화 모드 — 트리거 처리·소비를 하지 않고 통과시켜 프론트 DOM 이 잡게 한다.
        // cancel_capture 가 호출될 때까지 유지(녹화는 여러 입력을 연속 캡처).
        if capturing {
            if is_down {
                let name = incoming_name(&inc);
                if let Some(app) = &inner.app {
                    let _ = app.emit("macro-key-captured", name);
                }
            }
            return false;
        }

        // 여기부터 running == true
        // 자동반복(auto-repeat) 식별 — 누른 채 유지하면 OS 가 keydown 을 반복 발생.
        // 키보드만 해당(마우스 버튼은 반복 없음). 첫 down 만 fresh, 이후 down 은 repeat.
        let mut is_repeat = false;
        if let Incoming::Key { vk, .. } = &inc {
            if is_down {
                if !inner.held_keys.insert(*vk) {
                    is_repeat = true;
                }
            } else if is_up {
                inner.held_keys.remove(vk);
            }
        }

        // 자동반복 down 은 상태를 바꾸지 않는다(1회/토글 재발동·깜빡임 방지).
        // 트리거 키면 통과 여부만 적용해 게임으로 새지 않게 한다.
        if is_repeat {
            let mut suppress = false;
            for s in inner.sets.iter() {
                if s.enabled && matches_trigger(&inc, &s.trigger) && !s.pass_through {
                    suppress = true;
                }
            }
            return suppress;
        }

        // ToggleAny: 아무 키 down 시 트리거된 ToggleAny 세트 정지(동시/배타 공통)
        let mut stopped_any: Vec<String> = Vec::new();
        if is_down {
            let any_ids: Vec<String> = inner
                .sets
                .iter()
                .filter(|s| s.enabled && s.mode == TriggerMode::ToggleAny)
                .map(|s| s.id.clone())
                .filter(|id| {
                    inner.active.contains_key(id) || inner.stack.iter().any(|x| x == id)
                })
                .collect();
            for id in any_ids {
                end(inner, &id);
                stopped_any.push(id);
            }
        }

        // 트리거 매칭 (borrow 회피 위해 인덱스 수집 후 처리)
        let matched: Vec<usize> = inner
            .sets
            .iter()
            .enumerate()
            .filter(|(_, s)| s.enabled && matches_trigger(&inc, &s.trigger))
            .map(|(i, _)| i)
            .collect();

        // 활성 창 제한 — 대상 프로세스가 포그라운드일 때만 매크로 '시작'을 허용.
        // (정지는 항상 허용 → 창 전환 후 키를 떼도 끼이지 않음)
        let target = inner.target_process.clone();
        let fg_ok = if target.is_empty() || matched.is_empty() {
            true
        } else {
            foreground_process_cached()
                .map(|p| {
                    let p = p.to_lowercase();
                    p == target || p.contains(&target)
                })
                .unwrap_or(false)
        };

        let mut suppress = false;
        for i in matched {
            let s = inner.sets[i].clone();
            // 시작/소비는 대상 창일 때만. 소비를 fg_ok 로 묶어 다른 앱에선 키가 정상 동작.
            let consume = fg_ok && !s.pass_through;
            // 현재 트리거된 상태인지 (배타=스택, 동시=active). begin/end 는 내부에서 재확인.
            let triggered = inner.active.contains_key(&s.id)
                || inner.stack.iter().any(|x| x == &s.id);
            match s.mode {
                TriggerMode::Once => {
                    if is_down {
                        if fg_ok {
                            begin(inner, &s);
                        }
                        if consume {
                            suppress = true;
                        }
                    } else if is_up && consume {
                        suppress = true;
                    }
                }
                TriggerMode::WhileHeld => {
                    if is_down {
                        if fg_ok {
                            begin(inner, &s);
                        }
                        if consume {
                            suppress = true;
                        }
                    } else if is_up {
                        end(inner, &s.id); // 정지는 항상
                        if consume {
                            suppress = true;
                        }
                    }
                }
                TriggerMode::ToggleSame => {
                    if is_down {
                        if triggered {
                            end(inner, &s.id); // 토글 OFF 는 항상 허용
                        } else if fg_ok {
                            begin(inner, &s);
                        }
                        if consume {
                            suppress = true;
                        }
                    } else if is_up && consume {
                        suppress = true;
                    }
                }
                TriggerMode::ToggleAny => {
                    if is_down {
                        // 방금 'any-key' 규칙으로 멈춘 세트면 재시작하지 않음(= 토글 OFF 완료)
                        if fg_ok && !stopped_any.contains(&s.id) {
                            begin(inner, &s);
                        }
                        if consume {
                            suppress = true;
                        }
                    } else if is_up && consume {
                        suppress = true;
                    }
                }
            }
        }
        suppress
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let kbd = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            if kbd.dwExtraInfo != INJECT_SIGNATURE {
                let msg = wparam.0 as u32;
                let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
                if is_down || is_up {
                    let vk = kbd.vkCode as u16;
                    // 물리 입력(드라이버) 모드로 우리가 주입한 키는 서명이 없으므로
                    // 최근 주입 목록으로 식별해 트리거 재발동을 막는다.
                    if inject::consume_recent(vk, is_down) {
                        return CallNextHookEx(None, code, wparam, lparam);
                    }
                    // 전체 ON/OFF 단축키 — 엔진이 꺼져 있어도 동작. 누름 시 토글 후 소비.
                    // 복합 단축키 지원(예: Shift+Home) — 본 키 down 시 수식키 상태로 판정.
                    // 캡처 중에는 단축키 처리를 건너뛴다(설정 중 의도치 않은 토글 방지).
                    if is_down && !CAPTURE.load(Ordering::Relaxed) {
                        let vk32 = vk as u32;
                        if hotkey_down(HOTKEY_ON.load(Ordering::Relaxed), vk32) {
                            apply_running(true);
                            return LRESULT(1);
                        }
                        if hotkey_down(HOTKEY_OFF.load(Ordering::Relaxed), vk32) {
                            apply_running(false);
                            return LRESULT(1);
                        }
                        if hotkey_down(HOTKEY_TOGGLE.load(Ordering::Relaxed), vk32) {
                            apply_running(!RUNNING.load(Ordering::Relaxed));
                            return LRESULT(1);
                        }
                    }
                    let extended = (kbd.flags.0 & LLKHF_EXTENDED.0) != 0;
                    let inc = Incoming::Key { vk, extended };
                    if handle_incoming(inc, is_down, is_up) {
                        return LRESULT(1);
                    }
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let ms = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            if ms.dwExtraInfo != INJECT_SIGNATURE {
                let msg = wparam.0 as u32;
                let mapped: Option<(MouseBtn, bool)> = match msg {
                    WM_LBUTTONDOWN => Some((MouseBtn::Left, true)),
                    WM_LBUTTONUP => Some((MouseBtn::Left, false)),
                    WM_RBUTTONDOWN => Some((MouseBtn::Right, true)),
                    WM_RBUTTONUP => Some((MouseBtn::Right, false)),
                    WM_MBUTTONDOWN => Some((MouseBtn::Middle, true)),
                    WM_MBUTTONUP => Some((MouseBtn::Middle, false)),
                    WM_XBUTTONDOWN | WM_XBUTTONUP => {
                        let hi = (ms.mouseData >> 16) as u16;
                        let btn = if hi == 0x0002 { MouseBtn::X2 } else { MouseBtn::X1 };
                        Some((btn, msg == WM_XBUTTONDOWN))
                    }
                    _ => None,
                };
                if let Some((btn, is_down)) = mapped {
                    if handle_incoming(Incoming::Mouse(btn), is_down, !is_down) {
                        return LRESULT(1);
                    }
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    fn hook_thread_main() {
        unsafe {
            let hinst: HINSTANCE = GetModuleHandleW(PCWSTR::null())
                .map(|h| HINSTANCE(h.0))
                .unwrap_or(HINSTANCE(std::ptr::null_mut()));

            let kb = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), hinst, 0) {
                Ok(h) => h,
                Err(e) => {
                    log::error!("키보드 후킹 설치 실패: {e}");
                    return;
                }
            };
            let ms = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hinst, 0) {
                Ok(h) => h,
                Err(e) => {
                    log::error!("마우스 후킹 설치 실패: {e}");
                    return;
                }
            };
            // LL 후킹 콜백은 OS 가 이 스레드의 메시지 큐를 통해 호출 — 메시지 루프 필수.
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = (kb, ms);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::MacroSet;
    use tauri::AppHandle;

    pub fn init(_app: AppHandle) {}
    pub fn set_config(_sets: Vec<MacroSet>) {}
    pub fn set_running(_on: bool) {}
    pub fn is_running() -> bool {
        false
    }
    pub fn panic_stop() {}
    pub fn start_capture() {}
    pub fn cancel_capture() {}
    pub fn set_target(_name: String) {}
    pub fn set_min_cycle(_ms: u32) {}
    pub fn set_exec_mode(_exclusive: bool) {}
    pub fn set_allow_dup_triggers(_on: bool) {}
    pub fn set_hotkeys(_on: Option<String>, _off: Option<String>) {}
    pub fn set_hotkey_toggle(_toggle: Option<String>) {}
    pub fn foreground_process() -> Option<String> {
        None
    }
    pub fn list_windows() -> Vec<String> {
        Vec::new()
    }
}

pub use platform::{
    cancel_capture, foreground_process, init, is_running, list_windows, panic_stop, set_allow_dup_triggers,
    set_config, set_exec_mode, set_hotkey_toggle, set_hotkeys, set_min_cycle, set_running,
    set_target, start_capture,
};
