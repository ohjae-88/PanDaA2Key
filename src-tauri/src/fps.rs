//! 인게임 FPS 모니터 — Intel PresentMon(ETW) 기반.
//!
//! - PresentMon.exe 를 전체 캡처 모드로 실행, stdout(CSV)의 present 행을 읽는다.
//! - 포그라운드 프로세스(게임)의 present 만 카운트 → 250ms 창으로 실시간 FPS 계산.
//! - 코드 인젝션 없음(ETW 시스템 추적) → 안티치트 상대적 안전. 관리자 권한 필요(앱은 항상 관리자).
//! - PresentMon.exe 가 없으면 비활성(FPS 0). 실행 파일 옆 / resources / tools 에서 탐색.
//!
//! PresentMon: https://github.com/GameTechDev/PresentMon (MIT)

#[cfg(windows)]
mod imp {
    use std::collections::{HashMap, VecDeque};
    use std::io::{BufRead, BufReader};
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    /// FPS 평활 윈도우 — present 도착을 1초간 모아 개수로 FPS 산출(버퍼 몰림 흡수)
    const WINDOW: Duration = Duration::from_millis(1000);

    static RUNNING: AtomicBool = AtomicBool::new(false);
    /// 세대 카운터 — stop 직후 start 시 종료 중인 옛 스레드가 새 모니터의
    /// RUNNING 을 꺼버리는 경합 방지. 각 스레드는 자기 세대일 때만 동작/정리한다.
    static GEN: AtomicU32 = AtomicU32::new(0);
    // 진단용
    static LAST_FG: AtomicU32 = AtomicU32::new(0);
    static OUR_PID: AtomicU32 = AtomicU32::new(0);
    static ROWS: AtomicU32 = AtomicU32::new(0);
    static SAMPLE_LOGGED: AtomicBool = AtomicBool::new(false);

    /// present 도착 (pid, 시각) 큐 (reader push, aggregator prune)
    fn frames() -> &'static Mutex<VecDeque<(u32, Instant)>> {
        static F: OnceLock<Mutex<VecDeque<(u32, Instant)>>> = OnceLock::new();
        F.get_or_init(|| Mutex::new(VecDeque::new()))
    }

    /// PresentMon.exe 경로 탐색 — 실행 파일 디렉터리 → resources → tools.
    fn presentmon_path() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?;
        let cands = [
            dir.join("PresentMon.exe"),
            dir.join("resources").join("PresentMon.exe"),
            dir.join("tools").join("PresentMon.exe"),
            dir.join("resources").join("tools").join("PresentMon.exe"),
        ];
        cands.into_iter().find(|p| p.exists())
    }

    /// 헤더 행에서 "ProcessID" 컬럼 인덱스 찾기 (PresentMon 버전별 호환)
    fn find_pid_column(header: &str) -> Option<usize> {
        header
            .split(',')
            .position(|c| c.trim().eq_ignore_ascii_case("ProcessID"))
    }

    pub fn start(app: AppHandle) {
        if RUNNING.swap(true, Ordering::SeqCst) {
            return;
        }
        let my_gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
        thread::spawn(move || {
            run(&app, my_gen);
            // 내 세대일 때만 RUNNING 해제 — 이미 새 세대가 시작됐다면 건드리지 않음
            if GEN.load(Ordering::SeqCst) == my_gen {
                RUNNING.store(false, Ordering::SeqCst);
            }
        });
    }

    pub fn stop() {
        RUNNING.store(false, Ordering::SeqCst);
    }

    /// 모니터 동작 여부 — 프론트 워치독이 비정상 종료(PresentMon 죽음 등)를 감지해 재시작하는 데 사용
    pub fn is_running() -> bool {
        RUNNING.load(Ordering::SeqCst)
    }

    pub fn is_available() -> bool {
        presentmon_path().is_some()
    }

    fn emit_fps(app: &AppHandle, fps: f64) {
        let _ = app.emit("overlay-fps", fps);
    }

    fn run(app: &AppHandle, my_gen: u32) {
        let alive = || RUNNING.load(Ordering::Relaxed) && GEN.load(Ordering::Relaxed) == my_gen;
        let Some(pm) = presentmon_path() else {
            // PresentMon 미설치 — 사용 불가 신호(-1)
            log::warn!(
                "FPS: PresentMon.exe 미발견 (exe디렉터리/resources/tools 탐색). 실행파일 위치: {:?}",
                std::env::current_exe()
            );
            let _ = app.emit("overlay-fps", -1.0_f64);
            return;
        };

        log::info!("FPS: PresentMon 경로 = {}", pm.display());
        let mut child = match Command::new(&pm)
            .args([
                "--output_stdout",
                "--stop_existing_session",
                "--no_console_stats",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                log::warn!("FPS: PresentMon 실행 실패: {e}");
                let _ = app.emit("overlay-fps", -1.0_f64);
                return;
            }
        };

        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            return;
        };
        let our_pid = std::process::id();
        OUR_PID.store(our_pid, Ordering::Relaxed);
        ROWS.store(0, Ordering::Relaxed);
        SAMPLE_LOGGED.store(false, Ordering::Relaxed);

        // 시작 시 큐 비우기
        if let Ok(mut q) = frames().lock() {
            q.clear();
        }

        // 집계 스레드 — 250ms 마다 최근 1초 윈도우에서 present 최다 PID(우리앱 제외)의 개수 = 게임 FPS
        {
            let app2 = app.clone();
            thread::spawn(move || {
                let alive =
                    || RUNNING.load(Ordering::Relaxed) && GEN.load(Ordering::Relaxed) == my_gen;
                let mut ticks: u32 = 0;
                while alive() {
                    thread::sleep(Duration::from_millis(250));
                    let now = Instant::now();
                    let mut counts: HashMap<u32, u32> = HashMap::new();
                    if let Ok(mut q) = frames().lock() {
                        while q.front().is_some_and(|&(_, t)| now.duration_since(t) > WINDOW) {
                            q.pop_front();
                        }
                        for &(pid, _) in q.iter() {
                            *counts.entry(pid).or_insert(0) += 1;
                        }
                    }
                    // present 가장 많은 PID = 게임으로 간주
                    let (top_pid, top) = counts
                        .iter()
                        .max_by_key(|(_, c)| **c)
                        .map(|(p, c)| (*p, *c))
                        .unwrap_or((0, 0));
                    LAST_FG.store(top_pid, Ordering::Relaxed);
                    emit_fps(&app2, top as f64);
                    ticks += 1;
                    if ticks % 16 == 0 {
                        log::info!(
                            "FPS diag: top_pid={} fps={} distinct_pids={} total_rows={} our={}",
                            top_pid,
                            top,
                            counts.len(),
                            ROWS.load(Ordering::Relaxed),
                            OUR_PID.load(Ordering::Relaxed)
                        );
                    }
                }
            });
        }

        let mut reader = BufReader::new(stdout);
        let mut pid_idx: Option<usize> = None;
        let mut raw: Vec<u8> = Vec::new();
        let mut warned_header = false;

        loop {
            if !alive() {
                break;
            }
            raw.clear();
            // 바이트 단위로 한 줄 읽기 — PresentMon stdout 이 UTF-16LE 일 수 있어
            // 널/개행/BOM 바이트를 제거해 ASCII(CSV)로 복원(UTF-8 출력도 그대로 통과).
            match reader.read_until(b'\n', &mut raw) {
                Ok(0) => break, // EOF
                Ok(_) => {}
                Err(_) => break,
            }
            let cleaned: Vec<u8> = raw
                .iter()
                .copied()
                .filter(|&b| b != 0x00 && b != 0x0D && b != 0x0A && b != 0xFF && b != 0xFE)
                .collect();
            if cleaned.is_empty() {
                continue;
            }
            let line = String::from_utf8_lossy(&cleaned);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            // 헤더 행 1회 파싱
            if pid_idx.is_none() {
                if let Some(i) = find_pid_column(line) {
                    pid_idx = Some(i);
                    log::info!("FPS: 헤더 인식 — ProcessID 컬럼 idx={i}");
                } else if !warned_header {
                    warned_header = true;
                    log::warn!("FPS: 헤더에 ProcessID 없음 — 첫 행: {line}");
                }
                continue;
            }
            // 데이터 행 — pid 파싱, 우리앱/0 제외하고 (pid, now) 기록
            let idx = pid_idx.unwrap();
            let mut cols = line.split(',');
            if let Some(pid_str) = cols.nth(idx) {
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    if pid != 0 && pid != our_pid {
                        ROWS.fetch_add(1, Ordering::Relaxed);
                        if !SAMPLE_LOGGED.swap(true, Ordering::Relaxed) {
                            log::info!("FPS: 첫 데이터행 pid={pid} our={our_pid}");
                        }
                        if let Ok(mut q) = frames().lock() {
                            q.push_back((pid, Instant::now()));
                        }
                    }
                }
            }
        }

        let _ = child.kill();
        // RUNNING 정리는 start() 의 세대 가드 래퍼에서 수행
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::AppHandle;
    pub fn start(_app: AppHandle) {}
    pub fn stop() {}
    pub fn is_running() -> bool {
        false
    }
    pub fn is_available() -> bool {
        false
    }
}

pub use imp::{is_available, is_running, start, stop};
