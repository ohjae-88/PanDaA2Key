// 콘솔 창 숨기기 (Windows 릴리즈 빌드)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    panda_key_lib::run()
}
