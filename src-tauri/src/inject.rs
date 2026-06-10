//! 입력 주입 백엔드.
//!
//! - 기본: `SendInput` (스캔코드). 대부분의 게임에서 동작하지만 LL 후킹에는 "주입됨" 플래그가 보임.
//! - 물리 입력 모드: **Interception 드라이버**(interception.dll 런타임 로드). 드라이버 레벨에서
//!   주입하므로 게임/OS 가 **실제 물리 키보드 입력으로 인식**한다(주입 플래그 없음).
//!   - 드라이버가 설치되어 있지 않거나 dll 이 없으면 자동으로 SendInput 으로 폴백.
//!   - Interception 으로 주입한 키는 우리 LL 후킹에도 "물리 입력"으로 보이므로,
//!     최근 주입 키 목록(RECENT)으로 식별해 트리거 재발동을 막는다(consume_recent).

use crate::keycodes::{InputKind, MouseBtn};

/// SendInput 주입 서명 — LL 후킹이 자기 입력을 식별(무시)하는 데 사용.
pub const SIGNATURE: usize = 0x5041_4E44; // "PAND"

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
        KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE,
        MAPVK_VK_TO_VSC, MOUSEINPUT, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
        MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
        MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
    };

    static PHYSICAL: AtomicBool = AtomicBool::new(false);

    /// 물리 입력(드라이버) 모드 ON/OFF
    pub fn set_physical(on: bool) {
        PHYSICAL.store(on, Ordering::SeqCst);
        if on {
            let _ = interception(); // 초기화 시도
        }
    }

    /// Interception 드라이버 사용 가능 여부 (dll + 드라이버 설치)
    pub fn interception_available() -> bool {
        interception().is_some()
    }

    /// 입력 주입 (down=true 누르기 / false 떼기)
    pub fn send(kind: InputKind, down: bool) {
        match kind {
            InputKind::Key { vk, extended } => key(vk, extended, down),
            InputKind::Mouse(btn) => mouse(btn, down),
        }
    }

    fn key(vk: u16, extended: bool, down: bool) {
        if PHYSICAL.load(Ordering::Relaxed) {
            if let Some(it) = interception() {
                // 드라이버 주입은 LL 후킹에 물리 입력으로 보이므로 최근 목록에 기록
                push_recent(vk, down);
                if it.send_key(vk, extended, down) {
                    return;
                }
                // 실패 시 폴백 (기록은 곧 만료되어 무해)
            }
        }
        sendinput_key(vk, extended, down);
    }

    fn mouse(btn: MouseBtn, down: bool) {
        // 마우스는 항상 SendInput (서명으로 후킹이 식별). 물리 모드는 키보드에 적용.
        sendinput_mouse(btn, down);
    }

    // ── SendInput 백엔드 ─────────────────────────────────────────

    fn sendinput_key(vk: u16, extended: bool, down: bool) {
        unsafe {
            let scan = MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) as u16;
            let mut flags = if down { KEYBD_EVENT_FLAGS(0) } else { KEYEVENTF_KEYUP };
            if extended {
                flags = flags | KEYEVENTF_EXTENDEDKEY;
            }
            let (w_vk, w_scan) = if scan != 0 {
                flags = flags | KEYEVENTF_SCANCODE;
                (VIRTUAL_KEY(0), scan)
            } else {
                (VIRTUAL_KEY(vk), 0)
            };
            let input = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: w_vk,
                        wScan: w_scan,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: SIGNATURE,
                    },
                },
            };
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }
    }

    fn sendinput_mouse(btn: MouseBtn, down: bool) {
        let (flags, mdata) = mouse_flags(btn, down);
        unsafe {
            let input = INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: mdata,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: SIGNATURE,
                    },
                },
            };
            SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }
    }

    fn mouse_flags(btn: MouseBtn, down: bool) -> (MOUSE_EVENT_FLAGS, u32) {
        match btn {
            MouseBtn::Left => (if down { MOUSEEVENTF_LEFTDOWN } else { MOUSEEVENTF_LEFTUP }, 0),
            MouseBtn::Right => (if down { MOUSEEVENTF_RIGHTDOWN } else { MOUSEEVENTF_RIGHTUP }, 0),
            MouseBtn::Middle => (if down { MOUSEEVENTF_MIDDLEDOWN } else { MOUSEEVENTF_MIDDLEUP }, 0),
            MouseBtn::X1 => (if down { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP }, 0x0001),
            MouseBtn::X2 => (if down { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP }, 0x0002),
        }
    }

    // ── 최근 주입 키(드라이버 모드) — 트리거 재발동 차단 ────────────

    fn recent() -> &'static Mutex<Vec<(u16, bool, Instant)>> {
        static R: OnceLock<Mutex<Vec<(u16, bool, Instant)>>> = OnceLock::new();
        R.get_or_init(|| Mutex::new(Vec::new()))
    }

    const RECENT_TTL: Duration = Duration::from_millis(50);

    fn push_recent(vk: u16, down: bool) {
        if let Ok(mut v) = recent().lock() {
            let now = Instant::now();
            v.retain(|(_, _, t)| now.duration_since(*t) < RECENT_TTL);
            v.push((vk, down, now));
        }
    }

    /// 후킹에서 들어온 (vk, down) 이 우리가 방금 드라이버로 주입한 것인지 확인하고 소비.
    /// true 면 우리 입력 → 트리거 처리에서 무시해야 함.
    /// 훅 경로(키 입력마다 호출) — 빈 목록은 즉시 탈출, 만료 제거와 매칭을 단일 순회로 처리.
    pub fn consume_recent(vk: u16, down: bool) -> bool {
        if !PHYSICAL.load(Ordering::Relaxed) {
            return false;
        }
        if let Ok(mut v) = recent().lock() {
            if v.is_empty() {
                return false;
            }
            let now = Instant::now();
            let mut i = 0;
            while i < v.len() {
                let (k, d, t) = v[i];
                if now.duration_since(t) >= RECENT_TTL {
                    v.swap_remove(i); // 순서 무관 — O(1) 제거
                    continue;
                }
                if k == vk && d == down {
                    v.swap_remove(i);
                    return true;
                }
                i += 1;
            }
        }
        false
    }

    // ── Interception 드라이버 백엔드 ─────────────────────────────

    #[repr(C)]
    struct KeyStroke {
        code: u16,
        state: u16,
        information: u32,
    }

    type CreateFn = unsafe extern "C" fn() -> *mut c_void;
    type SendFn = unsafe extern "C" fn(*mut c_void, i32, *const u8, u32) -> i32;

    struct Interception {
        _lib: libloading::Library,
        ctx: *mut c_void,
        send: SendFn,
        device: AtomicI32,
        lock: Mutex<()>,
    }
    // ctx 는 raw 포인터 — Interception 컨텍스트는 send 시 lock 으로 직렬화한다.
    unsafe impl Send for Interception {}
    unsafe impl Sync for Interception {}

    impl Interception {
        fn send_key(&self, vk: u16, extended: bool, down: bool) -> bool {
            let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) as u16 };
            if scan == 0 {
                return false; // 스캔코드 매핑 불가 → SendInput 폴백
            }
            let mut state: u16 = if down { 0 } else { 1 }; // KEY_DOWN=0, KEY_UP=1
            if extended {
                state |= 0x02; // E0
            }
            let ks = KeyStroke { code: scan, state, information: 0 };
            // InterceptionStroke 는 16바이트 버퍼 — 앞 8바이트에 KeyStroke 배치
            let mut buf = [0u8; 16];
            unsafe {
                std::ptr::copy_nonoverlapping(
                    &ks as *const KeyStroke as *const u8,
                    buf.as_mut_ptr(),
                    std::mem::size_of::<KeyStroke>(),
                );
            }
            let _g = self.lock.lock().unwrap();
            let dev = self.device.load(Ordering::Relaxed);
            let sent = unsafe { (self.send)(self.ctx, dev, buf.as_ptr(), 1) };
            if sent > 0 {
                return true;
            }
            // 캐시된 장치 실패 → 키보드 장치(1..=10) 스캔
            for d in 1..=10 {
                let sent = unsafe { (self.send)(self.ctx, d, buf.as_ptr(), 1) };
                if sent > 0 {
                    self.device.store(d, Ordering::Relaxed);
                    return true;
                }
            }
            false
        }
    }

    /// Interception 인스턴스 — 성공 시 영구 캐시, 실패는 캐시하지 않음.
    /// 부팅 직후 드라이버 서비스가 늦게 준비되는 경우를 위해 3초 간격으로 재시도한다.
    /// (기존 OnceLock 방식은 첫 실패가 앱 재시작 전까지 영구 고정되는 문제가 있었음)
    fn interception() -> Option<&'static Interception> {
        struct Cache {
            inst: Option<&'static Interception>,
            last_try: Option<Instant>,
        }
        static C: OnceLock<Mutex<Cache>> = OnceLock::new();
        let m = C.get_or_init(|| Mutex::new(Cache { inst: None, last_try: None }));
        let mut g = m.lock().unwrap();
        if g.inst.is_some() {
            return g.inst;
        }
        // 재시도 스로틀 — 드라이버 미설치 환경에서 키 입력마다 dll 로드 시도 방지
        if let Some(t) = g.last_try {
            if t.elapsed() < Duration::from_secs(3) {
                return None;
            }
        }
        g.last_try = Some(Instant::now());
        if let Some(i) = load_interception() {
            g.inst = Some(Box::leak(Box::new(i)));
        }
        g.inst
    }

    /// interception.dll 로드 — 표준 검색 경로 → 실행 파일 디렉터리 → resources 순으로 시도.
    fn load_lib() -> Option<libloading::Library> {
        unsafe {
            if let Ok(l) = libloading::Library::new("interception.dll") {
                return Some(l);
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    for cand in [
                        dir.join("interception.dll"),
                        dir.join("resources").join("interception.dll"),
                    ] {
                        if let Ok(l) = libloading::Library::new(&cand) {
                            return Some(l);
                        }
                    }
                }
            }
            None
        }
    }

    fn load_interception() -> Option<Interception> {
        unsafe {
            let lib = load_lib()?;
            let create: libloading::Symbol<CreateFn> =
                lib.get(b"interception_create_context\0").ok()?;
            let send: libloading::Symbol<SendFn> = lib.get(b"interception_send\0").ok()?;
            let create_fn = *create;
            let send_fn = *send;
            let ctx = create_fn();
            if ctx.is_null() {
                return None; // 드라이버 미설치
            }
            log::info!("Interception 드라이버 활성화 — 물리 입력 모드 사용 가능");
            Some(Interception {
                _lib: lib,
                ctx,
                send: send_fn,
                device: AtomicI32::new(1),
                lock: Mutex::new(()),
            })
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn set_physical(_on: bool) {}
    pub fn interception_available() -> bool {
        false
    }
    pub fn send(_kind: InputKind, _down: bool) {}
    pub fn consume_recent(_vk: u16, _down: bool) -> bool {
        false
    }
}

pub use imp::{consume_recent, interception_available, send, set_physical};
