//! 입력 이름(프론트엔드 KeyboardEvent.code 계열) ↔ Windows 가상 키코드 / 마우스 버튼 매핑.
//!
//! 프론트엔드와 동일한 문자열 식별자를 사용한다 (lib/macro/keys.ts 와 1:1 대응).
//! - 키보드: "KeyA", "Digit1", "F5", "Enter", "ArrowUp", "NumpadAdd" 등
//! - 마우스: "MouseLeft", "MouseRight", "MouseMiddle", "MouseX1", "MouseX2"

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MouseBtn {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

/// 해석된 입력 단위 — 트리거/스텝 공용.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InputKind {
    /// 키보드 — 가상 키코드 + 확장키 여부(방향키/우측 Ctrl·Alt/넘패드 Enter 등)
    Key { vk: u16, extended: bool },
    Mouse(MouseBtn),
}

/// 입력 이름 → InputKind. 인식 불가 시 None.
pub fn parse_input(name: &str) -> Option<InputKind> {
    if let Some(btn) = parse_mouse(name) {
        return Some(InputKind::Mouse(btn));
    }
    let (vk, ext) = parse_key(name)?;
    Some(InputKind::Key { vk, extended: ext })
}

fn parse_mouse(name: &str) -> Option<MouseBtn> {
    Some(match name {
        "MouseLeft" => MouseBtn::Left,
        "MouseRight" => MouseBtn::Right,
        "MouseMiddle" => MouseBtn::Middle,
        "MouseX1" => MouseBtn::X1,
        "MouseX2" => MouseBtn::X2,
        _ => return None,
    })
}

/// 키 이름 → (가상 키코드, 확장키 여부)
fn parse_key(name: &str) -> Option<(u16, bool)> {
    // KeyA..KeyZ
    if let Some(c) = name.strip_prefix("Key") {
        if c.len() == 1 {
            let ch = c.as_bytes()[0];
            if ch.is_ascii_uppercase() {
                return Some((ch as u16, false));
            }
        }
    }
    // Digit0..Digit9
    if let Some(d) = name.strip_prefix("Digit") {
        if d.len() == 1 {
            let ch = d.as_bytes()[0];
            if ch.is_ascii_digit() {
                return Some((ch as u16, false));
            }
        }
    }
    // F1..F24
    if let Some(n) = name.strip_prefix("F") {
        if let Ok(num) = n.parse::<u16>() {
            if (1..=24).contains(&num) {
                return Some((0x70 + (num - 1), false));
            }
        }
    }
    // Numpad0..Numpad9
    if let Some(n) = name.strip_prefix("Numpad") {
        if n.len() == 1 {
            let ch = n.as_bytes()[0];
            if ch.is_ascii_digit() {
                return Some((0x60 + (ch - b'0') as u16, false));
            }
        }
    }

    let r = match name {
        "Escape" => (0x1B, false),
        "Tab" => (0x09, false),
        "CapsLock" => (0x14, false),
        "Space" => (0x20, false),
        "Enter" => (0x0D, false),
        "Backspace" => (0x08, false),
        "Delete" => (0x2E, true),
        "Insert" => (0x2D, true),
        "Home" => (0x24, true),
        "End" => (0x23, true),
        "PageUp" => (0x21, true),
        "PageDown" => (0x22, true),
        "ArrowUp" => (0x26, true),
        "ArrowDown" => (0x28, true),
        "ArrowLeft" => (0x25, true),
        "ArrowRight" => (0x27, true),
        "ShiftLeft" => (0xA0, false),
        "ShiftRight" => (0xA1, false),
        "ControlLeft" => (0xA2, false),
        "ControlRight" => (0xA3, true),
        "AltLeft" => (0xA4, false),
        "AltRight" => (0xA5, true),
        "MetaLeft" => (0x5B, true),
        "MetaRight" => (0x5C, true),
        "PrintScreen" => (0x2C, true),
        "ScrollLock" => (0x91, false),
        "Pause" => (0x13, false),
        "NumLock" => (0x90, false),
        "NumpadMultiply" => (0x6A, false),
        "NumpadAdd" => (0x6B, false),
        "NumpadSubtract" => (0x6D, false),
        "NumpadDecimal" => (0x6E, false),
        "NumpadDivide" => (0x6F, true),
        "NumpadEnter" => (0x0D, true),
        "Backquote" => (0xC0, false),
        "Minus" => (0xBD, false),
        "Equal" => (0xBB, false),
        "BracketLeft" => (0xDB, false),
        "BracketRight" => (0xDD, false),
        "Backslash" => (0xDC, false),
        "Semicolon" => (0xBA, false),
        "Quote" => (0xDE, false),
        "Comma" => (0xBC, false),
        "Period" => (0xBE, false),
        "Slash" => (0xBF, false),
        _ => return None,
    };
    Some(r)
}

/// 마우스 메시지 식별값(IncomingInput 변환용) → 입력 이름.
pub fn mouse_to_name(btn: MouseBtn) -> &'static str {
    match btn {
        MouseBtn::Left => "MouseLeft",
        MouseBtn::Right => "MouseRight",
        MouseBtn::Middle => "MouseMiddle",
        MouseBtn::X1 => "MouseX1",
        MouseBtn::X2 => "MouseX2",
    }
}

/// 후킹으로 들어온 (가상 키코드, 확장키 여부) → 입력 이름. 키 캡처 시 사용.
pub fn key_to_name(vk: u16, extended: bool) -> String {
    // 글자 / 숫자 / F키 — 계산
    if (0x41..=0x5A).contains(&vk) {
        return format!("Key{}", (vk as u8) as char);
    }
    if (0x30..=0x39).contains(&vk) {
        return format!("Digit{}", (vk as u8) as char);
    }
    if (0x70..=0x87).contains(&vk) {
        return format!("F{}", vk - 0x70 + 1);
    }
    if (0x60..=0x69).contains(&vk) {
        return format!("Numpad{}", vk - 0x60);
    }
    let s = match vk {
        0x1B => "Escape",
        0x09 => "Tab",
        0x14 => "CapsLock",
        0x20 => "Space",
        0x0D => {
            if extended {
                "NumpadEnter"
            } else {
                "Enter"
            }
        }
        0x08 => "Backspace",
        0x2E => "Delete",
        0x2D => "Insert",
        0x24 => "Home",
        0x23 => "End",
        0x21 => "PageUp",
        0x22 => "PageDown",
        0x26 => "ArrowUp",
        0x28 => "ArrowDown",
        0x25 => "ArrowLeft",
        0x27 => "ArrowRight",
        0xA0 => "ShiftLeft",
        0xA1 => "ShiftRight",
        0x10 => "ShiftLeft",
        0xA2 => "ControlLeft",
        0xA3 => "ControlRight",
        0x11 => "ControlLeft",
        0xA4 => "AltLeft",
        0xA5 => "AltRight",
        0x12 => "AltLeft",
        0x5B => "MetaLeft",
        0x5C => "MetaRight",
        0x2C => "PrintScreen",
        0x91 => "ScrollLock",
        0x13 => "Pause",
        0x90 => "NumLock",
        0x6A => "NumpadMultiply",
        0x6B => "NumpadAdd",
        0x6D => "NumpadSubtract",
        0x6E => "NumpadDecimal",
        0x6F => "NumpadDivide",
        0xC0 => "Backquote",
        0xBD => "Minus",
        0xBB => "Equal",
        0xDB => "BracketLeft",
        0xDD => "BracketRight",
        0xDC => "Backslash",
        0xBA => "Semicolon",
        0xDE => "Quote",
        0xBC => "Comma",
        0xBE => "Period",
        0xBF => "Slash",
        _ => return format!("VK_{:#X}", vk),
    };
    s.to_string()
}
