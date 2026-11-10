use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tungstenite::{connect, Message};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsReadiness {
    pub installed: bool,
    pub install_path: Option<String>,
    pub websocket_ok: bool,
    pub detail: String,
}

pub fn probe_obs_readiness(obs_url: &str) -> ObsReadiness {
    let trimmed = obs_url.trim();
    let (installed, install_path) = detect_obs_install();
    if trimmed.is_empty() {
        return ObsReadiness {
            installed,
            install_path,
            websocket_ok: false,
            detail: "请先在设置中填写 OBS WebSocket 地址（通常为 ws://127.0.0.1:4455）。".to_owned(),
        };
    }
    let (websocket_ok, websocket_detail) = probe_obs_websocket(trimmed);

    let detail = if websocket_ok {
        websocket_detail
    } else if !installed {
        format!(
            "未在常见路径找到 OBS Studio，且无法连接 WebSocket。请从 obsproject.com 安装 OBS，启动后在 OBS「工具 → WebSocket 服务器设置」中启用服务器。{websocket_detail}"
        )
    } else {
        format!(
            "已检测到 OBS（{}），但 WebSocket 未就绪。请启动 OBS，并在「工具 → WebSocket 服务器设置」中启用服务器且端口与设置一致。{websocket_detail}",
            install_path.as_deref().unwrap_or("未知路径")
        )
    };

    ObsReadiness {
        installed,
        install_path,
        websocket_ok,
        detail,
    }
}

fn detect_obs_install() -> (bool, Option<String>) {
    candidates_obs_executable()
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| (true, Some(path.display().to_string())))
        .unwrap_or((false, None))
}

fn candidates_obs_executable() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut paths = vec![
            PathBuf::from(r"C:\Program Files\obs-studio\bin\64bit\obs64.exe"),
            PathBuf::from(r"C:\Program Files (x86)\obs-studio\bin\64bit\obs64.exe"),
        ];
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            paths.push(
                PathBuf::from(local).join("Programs/obs-studio/bin/64bit/obs64.exe"),
            );
        }
        paths
    }
    #[cfg(not(windows))]
    {
        vec![
            Path::new("/Applications/OBS.app/Contents/MacOS/OBS").to_path_buf(),
            Path::new("/usr/bin/obs").to_path_buf(),
        ]
    }
}

fn probe_obs_websocket(obs_url: &str) -> (bool, String) {
    let connect_result = std::thread::spawn({
        let url = obs_url.to_owned();
        move || connect(&url)
    })
    .join();

    let (mut socket, _) = match connect_result {
        Ok(Ok(pair)) => pair,
        Ok(Err(error)) => {
            return (
                false,
                format!("无法连接 {obs_url}（{error}）。"),
            );
        }
        Err(_) => {
            return (false, "连接 OBS 时被中断。".to_owned());
        }
    };

    let hello = match socket.read() {
        Ok(Message::Text(text)) => text,
        Ok(_) => return (false, "OBS WebSocket 返回了非文本握手消息。".to_owned()),
        Err(error) => return (false, format!("读取 OBS 握手失败（{error}）。")),
    };

    let hello_json: Value = match serde_json::from_str(&hello) {
        Ok(value) => value,
        Err(_) => return (false, "OBS WebSocket 握手格式无法识别。".to_owned()),
    };
    if hello_json.get("op").and_then(Value::as_i64) != Some(0) {
        return (false, "OBS WebSocket 未发送预期的 Hello 消息。".to_owned());
    }
    let needs_auth = hello_json
        .pointer("/d/authentication")
        .and_then(Value::as_object)
        .is_some();

    let identify = serde_json::json!({ "op": 1, "d": { "rpcVersion": 1 } });
    if socket.send(Message::Text(identify.to_string())).is_err() {
        return (false, "无法向 OBS 发送 Identify 消息。".to_owned());
    }

    for _ in 0..4 {
        match socket.read() {
            Ok(Message::Text(text)) => {
                let message: Value = match serde_json::from_str(&text) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                match message.get("op").and_then(Value::as_i64) {
                    Some(2) => {
                        return if needs_auth {
                            (
                                true,
                                "OBS WebSocket 已连接。OBS 启用了鉴权，请在首页「准备录制」时输入密码。".to_owned(),
                            )
                        } else {
                            (
                                true,
                                "OBS WebSocket 已连接并就绪。".to_owned(),
                            )
                        };
                    }
                    Some(3) => {
                        return (
                            false,
                            "OBS 要求 WebSocket 鉴权。请确认密码，或在 OBS 中暂时关闭鉴权后再试。".to_owned(),
                        );
                    }
                    _ => continue,
                }
            }
            Ok(Message::Ping(payload)) => {
                let _ = socket.send(Message::Pong(payload));
            }
            Ok(_) => continue,
            Err(error) => return (false, format!("等待 OBS 就绪确认失败（{error}）。")),
        }
    }

    (false, "OBS 未在超时内确认 WebSocket 连接。".to_owned())
}

#[cfg(test)]
mod tests {
    use super::candidates_obs_executable;

    #[test]
    fn obs_install_candidates_include_program_files_on_windows() {
        let paths = candidates_obs_executable();
        assert!(!paths.is_empty());
        #[cfg(windows)]
        assert!(
            paths
                .iter()
                .any(|path| path.to_string_lossy().contains("obs-studio"))
        );
    }
}
