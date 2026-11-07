use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureSettings {
    output_directory: String,
    telemetry_directory: String,
    obs_url: String,
    obs_password: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliverySettings {
    bundle_path: String,
    output_directory: String,
    accept_low_confidence: bool,
}

#[derive(Serialize, Clone)]
struct DesktopEvent {
    kind: String,
    level: String,
    message: String,
    at: String,
}

fn event(app: &AppHandle, kind: &str, level: &str, message: impl Into<String>) {
    let _ = app.emit("racing-memory://event", DesktopEvent {
        kind: kind.into(),
        level: level.into(),
        message: message.into(),
        at: chrono_like_now(),
    });
}

// Keep the shell intentionally dependency-light.  The UI uses this only for
// ordering log messages, not for telemetry timestamps or synchronization.
fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    format!("{}Z", seconds)
}

fn required(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() { Err(format!("{} is required.", label)) } else { Ok(()) }
}

fn resources_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let _ = app; // preserve the app-aware signature for future installed builds
    // The portable ZIP deliberately has no installer. All helper executables
    // sit beside RacingMemory.exe, so nothing needs to be installed or added
    // to PATH on the player's Windows 11 machine.
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .ok_or_else(|| "Cannot locate the portable application directory.".to_owned())
}

fn run_sidecar(app: AppHandle, kind: &'static str, args: Vec<String>, password: Option<String>) {
    let resources = match resources_dir(&app) { Ok(value) => value, Err(error) => { event(&app, kind, "error", error); return; } };
    let ffmpeg = resources.join("ffmpeg.exe");
    let ffprobe = resources.join("ffprobe.exe");
    let mut command = Command::new(resources.join("lapwing-x86_64-pc-windows-msvc.exe"));
    command.args(args).env("RACING_MEMORY_FFMPEG", ffmpeg).env("RACING_MEMORY_FFPROBE", ffprobe).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(value) = password { command.env("OBS_WEBSOCKET_PASSWORD", value); }
    let mut child = match command.spawn() { Ok(value) => value, Err(error) => { event(&app, kind, "error", format!("Cannot start bundled engine: {error}")); return; } };
    let stdout = child.stdout.take(); let stderr = child.stderr.take();
    let stdout_app = app.clone();
    let stdout_reader = std::thread::spawn(move || if let Some(stream) = stdout {
        for line in BufReader::new(stream).lines().map_while(Result::ok) { event(&stdout_app, kind, "info", line); }
    });
    let stderr_app = app.clone();
    let stderr_reader = std::thread::spawn(move || if let Some(stream) = stderr {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            let level = if line.contains("\"status\":\"failed\"") || line.contains("\"error\"") { "error" } else { "info" };
            event(&stderr_app, kind, level, line);
        }
    });
    let status = child.wait(); let _ = stdout_reader.join(); let _ = stderr_reader.join();
    match status { Ok(value) if value.success() => event(&app, kind, "info", "Engine completed."), Ok(value) => event(&app, kind, "error", format!("Engine stopped (exit {:?}).", value.code())), Err(error) => event(&app, kind, "error", format!("Could not wait for engine: {error}")) }
}

#[tauri::command]
fn desktop_ready(app: AppHandle) -> Result<bool, String> {
    let resources = resources_dir(&app)?;
    for name in ["ffmpeg.exe", "ffprobe.exe"] {
        if !resources.join(name).is_file() { return Err(format!("Bundled {} is missing. Reinstall Racing Memory.", name)); }
    }
    Ok(true)
}

#[tauri::command]
fn start_capture(app: AppHandle, settings: CaptureSettings) -> Result<(), String> {
    required(&settings.output_directory, "Session output directory")?;
    required(&settings.telemetry_directory, "iRacing IBT directory")?;
    required(&settings.obs_url, "OBS WebSocket URL")?;
    let bundle = Path::new(&settings.output_directory).join("latest-session.bundle.json");
    let args = vec![
        "capture".into(), "watch".into(), "--provider".into(), "iracing".into(),
        "--output".into(), bundle.display().to_string(),
        "--telemetry-directory".into(), settings.telemetry_directory.clone(),
        "--obs-url".into(), settings.obs_url.clone(),
        "--obs-password-env".into(), "OBS_WEBSOCKET_PASSWORD".into(),
    ];
    event(&app, "capture", "info", format!("Watching iRacing. Bundle will be written to {}", bundle.display()));
    std::thread::spawn(move || run_sidecar(app, "capture", args, Some(settings.obs_password)));
    Ok(())
}

#[tauri::command]
fn run_delivery(app: AppHandle, settings: DeliverySettings) -> Result<(), String> {
    required(&settings.bundle_path, "Session bundle JSON")?;
    required(&settings.output_directory, "Output directory")?;
    let mut args = vec!["delivery".into(), "run".into(), settings.bundle_path.clone(), "--output".into(), settings.output_directory.clone()];
    if settings.accept_low_confidence { args.push("--accept-low-confidence".into()); }
    event(&app, "delivery", "info", "Checking synchronization and starting the complete delivery pipeline.");
    std::thread::spawn(move || run_sidecar(app, "delivery", args, None));
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_ready, start_capture, run_delivery])
        .run(tauri::generate_context!())
        .expect("error while running Racing Memory");
}
