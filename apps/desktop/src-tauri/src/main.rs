// Release builds must be GUI-subsystem apps, otherwise Windows allocates a
// console window on every double-click launch. This is a crate-level attribute.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows GUI builds must not allocate a console for console-mode helpers.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use rand::RngCore;
use sha2::{Digest, Sha256};

mod obs_readiness;

const SETTINGS_FILE: &str = "settings.json";
const REGISTRY_FILE: &str = "registry.json";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    data_root: String,
    telemetry_directory: String,
    obs_url: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureRequest {
    obs_password: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryRequest {
    session_id: String,
    accept_low_confidence: bool,
    preset: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportGenerateRequest {
    telemetry_path: String,
    video_path: Option<String>,
    preset: String,
    accept_low_confidence: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgressSnapshot {
    lines: Vec<String>,
    session_id: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSessionAsset {
    kind: String,
    path: String,
    available: bool,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    group: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    media_type: Option<String>,
    #[serde(default)]
    order: Option<i32>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalTrainingCard {
    title: String,
    detail: String,
    exercise: String,
    completion_criteria: String,
    baseline_time_loss_ms: i64,
    target_time_loss_ms: i64,
    confidence: String,
    source: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrainingArtifact {
    card: Option<LocalTrainingCard>,
    reason: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSessionRecord {
    id: String,
    created_at: String,
    game: String,
    track: Option<String>,
    course: Option<String>,
    vehicle: Option<String>,
    session_type: Option<String>,
    session_directory: String,
    bundle_path: String,
    telemetry_path: String,
    telemetry_sha256: Option<String>,
    video_path: Option<String>,
    video_sha256: Option<String>,
    video_available: bool,
    sync_confidence: Option<String>,
    sync_requires_review: bool,
    delivery_status: String,
    delivery_error: Option<String>,
    training_card: Option<LocalTrainingCard>,
    training_reason: Option<String>,
    assets: Vec<LocalSessionAsset>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSessionRegistry {
    version: u8,
    sessions: Vec<LocalSessionRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleFile {
    path: String,
    sha256: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleMetadata {
    track: Option<String>,
    course: Option<String>,
    vehicle: Option<String>,
    session_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleSync {
    confidence: String,
    requires_review: bool,
    sync_offset_ms: Option<f64>,
    sync_rate: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleDocument {
    session_id: String,
    created_at: String,
    game: String,
    telemetry: BundleFile,
    #[serde(default)]
    videos: Vec<BundleFile>,
    metadata: Option<BundleMetadata>,
    sync: Option<BundleSync>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryManifestDocument {
    schema_version: u8,
    items: Vec<DeliveryManifestItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryManifestItem {
    role: String,
    group: String,
    title: String,
    description: Option<String>,
    path: String,
    media_type: String,
    order: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopState {
    settings: DesktopSettings,
    sessions: Vec<LocalSessionRecord>,
    engine_ready: bool,
    engine_error: Option<String>,
    build_info: Option<Value>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopEvent {
    kind: String,
    level: String,
    message: String,
    at: String,
    session_id: Option<String>,
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn chrono_like_now() -> String {
    format!("{}Z", SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs())
}

fn default_data_root() -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    home.join("Documents").join("RacingMemoryData")
}

fn default_telemetry_directory() -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    home.join("Documents").join("iRacing").join("telemetry")
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            data_root: default_data_root().display().to_string(),
            telemetry_directory: default_telemetry_directory().display().to_string(),
            obs_url: "ws://127.0.0.1:4455".to_owned(),
        }
    }
}

fn event(app: &AppHandle, kind: &str, level: &str, message: impl Into<String>) {
    event_for_session(app, kind, level, message, None);
}

fn event_for_session(
    app: &AppHandle,
    kind: &str,
    level: &str,
    message: impl Into<String>,
    session_id: Option<&str>,
) {
    let _ = app.emit("racing-memory://event", DesktopEvent {
        kind: kind.into(),
        level: level.into(),
        message: message.into(),
        at: chrono_like_now(),
        session_id: session_id.map(str::to_owned),
    });
}

fn required(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required."))
    } else {
        Ok(())
    }
}

fn app_state_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(default_data_root);
    base.join("RacingMemory")
}

fn settings_path() -> PathBuf {
    app_state_dir().join(SETTINGS_FILE)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Cannot read {}: {error}", path.display()))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| format!("Cannot resolve parent for {}.", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = path.with_extension(format!("{}.tmp", now_millis()));
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| format!("Cannot write {}: {error}", temporary.display()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("Cannot replace {}: {error}", path.display()))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("Cannot replace {}: {error}", path.display()))
}

fn load_settings() -> DesktopSettings {
    read_json(&settings_path()).unwrap_or_default()
}

fn validate_settings(settings: &DesktopSettings) -> Result<(), String> {
    required(&settings.data_root, "Racing Memory data folder")?;
    required(&settings.telemetry_directory, "iRacing IBT directory")?;
    required(&settings.obs_url, "OBS WebSocket URL")?;
    Ok(())
}

fn save_desktop_settings(settings: &DesktopSettings) -> Result<(), String> {
    required(&settings.data_root, "Racing Memory data folder")?;
    fs::create_dir_all(Path::new(&settings.data_root).join("sessions"))
        .map_err(|error| format!("Cannot create local Session folder: {error}"))?;
    write_json_atomic(&settings_path(), settings)
}

fn resources_dir() -> Result<PathBuf, String> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .ok_or_else(|| "Cannot locate the application directory.".to_owned())
}

fn engine_error() -> Option<String> {
    let resources = resources_dir().ok()?;
    for name in [
        "lapwing-x86_64-pc-windows-msvc.exe",
        "ffmpeg.exe",
        "ffprobe.exe",
        "tracks.json",
        "drawings.json",
    ] {
        if !resources.join(name).is_file() {
            return Some(format!("Bundled {name} is missing. Reinstall Racing Memory."));
        }
    }
    None
}

fn resolve_bundle_path(bundle_path: &Path, value: &str) -> PathBuf {
    let candidate = PathBuf::from(value);
    if candidate.is_absolute() {
        candidate
    } else {
        bundle_path.parent().unwrap_or_else(|| Path::new(".")).join(candidate)
    }
}

fn registry_path(data_root: &Path) -> PathBuf {
    data_root.join(REGISTRY_FILE)
}

fn session_record_path(session_directory: &Path) -> PathBuf {
    session_directory.join("session.json")
}

fn refresh_record_availability(record: &mut LocalSessionRecord) {
    record.video_available = record.video_path
        .as_deref()
        .map(Path::new)
        .map(Path::exists)
        .unwrap_or(false);
    for asset in &mut record.assets {
        asset.available = Path::new(&asset.path).is_file();
    }
}

fn read_session_record(path: &Path) -> Option<LocalSessionRecord> {
    let mut record: LocalSessionRecord = read_json(path).ok()?;
    refresh_record_availability(&mut record);
    Some(record)
}

fn scan_session_records(data_root: &Path) -> Vec<LocalSessionRecord> {
    let sessions_root = data_root.join("sessions");
    let Ok(entries) = fs::read_dir(sessions_root) else {
        return Vec::new();
    };
    let mut records = entries
        .flatten()
        .filter_map(|entry| read_session_record(&session_record_path(&entry.path())))
        .collect::<Vec<_>>();
    records.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    records
}

fn load_registry(data_root: &Path) -> LocalSessionRegistry {
    let path = registry_path(data_root);
    let mut registry = read_json(&path).unwrap_or_else(|_| LocalSessionRegistry {
        version: 1,
        sessions: scan_session_records(data_root),
    });
    registry.version = 1;
    for record in &mut registry.sessions {
        refresh_record_availability(record);
    }
    registry.sessions.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    registry
}

fn save_registry(data_root: &Path, registry: &LocalSessionRegistry) -> Result<(), String> {
    write_json_atomic(&registry_path(data_root), registry)
}

fn rebuild_registry(data_root: &Path) -> Result<Vec<LocalSessionRecord>, String> {
    let registry = LocalSessionRegistry {
        version: 1,
        sessions: scan_session_records(data_root),
    };
    save_registry(data_root, &registry)?;
    Ok(registry.sessions)
}

fn upsert_session(data_root: &Path, record: LocalSessionRecord) -> Result<(), String> {
    write_json_atomic(&session_record_path(Path::new(&record.session_directory)), &record)?;
    let mut registry = load_registry(data_root);
    if let Some(existing) = registry.sessions.iter_mut().find(|item| item.id == record.id) {
        *existing = record;
    } else {
        registry.sessions.push(record);
    }
    registry.sessions.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    save_registry(data_root, &registry)
}

fn update_session<F>(data_root: &Path, session_id: &str, change: F) -> Result<LocalSessionRecord, String>
where
    F: FnOnce(&mut LocalSessionRecord),
{
    let mut registry = load_registry(data_root);
    let record = registry
        .sessions
        .iter_mut()
        .find(|item| item.id == session_id)
        .ok_or_else(|| "This local Session no longer exists. Rebuild the Library and try again.".to_owned())?;
    change(record);
    refresh_record_availability(record);
    let updated = record.clone();
    write_json_atomic(&session_record_path(Path::new(&updated.session_directory)), &updated)?;
    save_registry(data_root, &registry)?;
    Ok(updated)
}

// The memory reel (reel.mp4) and the full HTML post-session report
// (report/index.html) are retired deliverables. Older Sessions still declare
// them in their cached delivery manifest, and the fallback scan can still find
// the files on disk, so both paths must filter them out.
fn is_retired_deliverable(
    path: &Path,
    role: Option<&str>,
    group: Option<&str>,
    title: Option<&str>,
) -> bool {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    name == "reel.mp4"
        || name == "index.html"
        || matches!(title, Some("Racing Memory 回忆视频" | "完整赛后报告"))
        || matches!(role, Some("primary-video" | "report"))
        || matches!(group, Some("report"))
}

fn scan_assets(session_directory: &Path) -> Vec<LocalSessionAsset> {
    let delivery_directory = session_directory.join("delivery");
    let manifest_path = delivery_directory.join("delivery-manifest.json");
    if let Ok(manifest) = read_json::<DeliveryManifestDocument>(&manifest_path) {
        if manifest.schema_version == 1 {
            let mut declared = manifest.items.into_iter().filter_map(|item| {
                let relative = Path::new(&item.path);
                if is_retired_deliverable(relative, Some(&item.role), Some(&item.group), Some(&item.title)) {
                    return None;
                }
                if relative.components().any(|component| !matches!(component, std::path::Component::Normal(_))) {
                    return None;
                }
                let path = delivery_directory.join(relative);
                Some(LocalSessionAsset {
                    kind: item.role.clone(),
                    available: path.is_file(),
                    path: path.display().to_string(),
                    title: Some(item.title),
                    description: item.description,
                    group: Some(item.group),
                    role: Some(item.role),
                    media_type: Some(item.media_type),
                    order: Some(item.order),
                })
            }).collect::<Vec<_>>();
            declared.sort_by_key(|item| item.order.unwrap_or(i32::MAX));
            return declared;
        }
    }
    let roots = [
        ("session memento", session_directory.join("delivery").join("session-assets")),
        ("report", session_directory.join("delivery").join("report")),
        ("training", session_directory.join("delivery").join("artifacts")),
        ("reel", session_directory.join("delivery")),
    ];
    let mut assets = Vec::new();
    for (kind, root) in roots {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("");
            if !matches!(extension, "mp4" | "png" | "svg" | "html" | "json") {
                continue;
            }
            if is_retired_deliverable(&path, None, None, None) {
                continue;
            }
            assets.push(LocalSessionAsset {
                kind: kind.to_owned(),
                available: true,
                path: path.display().to_string(),
                title: None,
                description: None,
                group: None,
                role: None,
                media_type: None,
                order: None,
            });
        }
    }
    assets.sort_by(|left, right| left.path.cmp(&right.path));
    assets
}

fn read_training_artifact(session_directory: &Path) -> (Option<LocalTrainingCard>, Option<String>) {
    let path = session_directory.join("delivery").join("artifacts").join("training.json");
    match read_json::<TrainingArtifact>(&path) {
        Ok(artifact) => (artifact.card, artifact.reason),
        Err(_) => (None, None),
    }
}

fn archive_capture_bundle(bundle_path: &Path, session_directory: &Path) -> Result<LocalSessionRecord, String> {
    let mut raw: Value = read_json(bundle_path)?;
    let bundle: BundleDocument = serde_json::from_value(raw.clone())
        .map_err(|error| format!("Capture produced an invalid Session Bundle: {error}"))?;
    let original_telemetry = resolve_bundle_path(bundle_path, &bundle.telemetry.path);
    if !original_telemetry.is_file() {
        return Err(format!("The finalized IBT file is missing: {}", original_telemetry.display()));
    }
    let extension = original_telemetry.extension().and_then(|value| value.to_str()).unwrap_or("ibt");
    let archived_telemetry = session_directory.join(format!("telemetry.{extension}"));
    if original_telemetry != archived_telemetry {
        fs::copy(&original_telemetry, &archived_telemetry).map_err(|error| {
            format!("Cannot archive telemetry into {}: {error}", archived_telemetry.display())
        })?;
    }
    raw["telemetry"]["path"] = Value::String(archived_telemetry.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("telemetry.ibt")
        .to_owned());
    write_json_atomic(bundle_path, &raw)?;

    let metadata = bundle.metadata;
    let video = bundle.videos.first();
    let video_path = video.map(|item| resolve_bundle_path(bundle_path, &item.path).display().to_string());
    Ok(LocalSessionRecord {
        id: bundle.session_id,
        created_at: bundle.created_at,
        game: bundle.game,
        track: metadata.as_ref().and_then(|item| item.track.clone()),
        course: metadata.as_ref().and_then(|item| item.course.clone()),
        vehicle: metadata.as_ref().and_then(|item| item.vehicle.clone()),
        session_type: metadata.as_ref().and_then(|item| item.session_type.clone()),
        session_directory: session_directory.display().to_string(),
        bundle_path: bundle_path.display().to_string(),
        telemetry_path: archived_telemetry.display().to_string(),
        telemetry_sha256: bundle.telemetry.sha256,
        video_path,
        video_sha256: video.and_then(|item| item.sha256.clone()),
        video_available: video.map(|item| resolve_bundle_path(bundle_path, &item.path).is_file()).unwrap_or(false),
        sync_confidence: bundle.sync.as_ref().map(|item| item.confidence.clone()),
        sync_requires_review: bundle.sync.as_ref().map(|item| item.requires_review).unwrap_or(false),
        delivery_status: "not_started".to_owned(),
        delivery_error: None,
        training_card: None,
        training_reason: None,
        assets: Vec::new(),
    })
}

fn run_sidecar(
    app: AppHandle,
    kind: &'static str,
    args: Vec<String>,
    password: Option<String>,
    progress_file: Option<PathBuf>,
) -> Result<(), String> {
    let resources = resources_dir()?;
    let ffmpeg = resources.join("ffmpeg.exe");
    let ffprobe = resources.join("ffprobe.exe");
    let executable = resources.join("lapwing-x86_64-pc-windows-msvc.exe");
    let mut command = Command::new(executable);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .args(args)
        .env("RACING_MEMORY_FFMPEG", ffmpeg)
        .env("RACING_MEMORY_FFPROBE", ffprobe)
        .env("LAPWING_TRACKS_PATH", resources.join("tracks.json"))
        .env("LAPWING_DRAWINGS_PATH", resources.join("drawings.json"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(value) = password {
        command.env("OBS_WEBSOCKET_PASSWORD", value);
    }
    if let Some(path) = progress_file {
        command.env("RACING_MEMORY_PROGRESS_FILE", path);
    }
    // The CLI reports failures as one structured JSON line on stderr. Keep it
    // so the desktop UI can show the real reason instead of a bare exit code.
    let (error_tx, error_rx) = std::sync::mpsc::channel::<(String, String)>();
    let mut child = command.spawn().map_err(|error| format!("Cannot start the bundled engine: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_app = app.clone();
    let stdout_reader = std::thread::spawn(move || {
        if let Some(stream) = stdout {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                event(&stdout_app, kind, "info", line);
            }
        }
    });
    let stderr_app = app.clone();
    let stderr_reader = std::thread::spawn(move || {
        if let Some(stream) = stderr {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                let level = if line.contains("\"status\":\"failed\"") || line.contains("\"error\"") {
                    "error"
                } else {
                    "info"
                };
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if let Some(error) = value.get("error") {
                        let code = error.get("code").and_then(Value::as_str).unwrap_or("COMMAND_FAILED").to_owned();
                        let message = error.get("message").and_then(Value::as_str).unwrap_or("").to_owned();
                        if !message.is_empty() {
                            let _ = error_tx.send((code, message));
                        }
                    }
                }
                event(&stderr_app, kind, level, line);
            }
        }
    });
    let status = child.wait().map_err(|error| format!("Could not wait for the engine: {error}"))?;
    // A grandchild that inherited the pipe can keep it open forever. Joining
    // the readers here hangs the capture thread after the engine has exited,
    // which leaves the UI stuck on "waiting for race". Detach them instead.
    drop(stdout_reader);
    drop(stderr_reader);
    if status.success() {
        return Ok(());
    }
    // Reader threads are detached on purpose (a grandchild may hold the pipe
    // open), so give a structured error line a short window to arrive.
    let detail = error_rx.recv_timeout(Duration::from_secs(1)).ok();
    Err(match detail {
        Some((code, message)) => format!("{} (engine exit {:?})", sidecar_error_message(&code, &message), status.code()),
        None => format!("Engine stopped with exit {:?}.", status.code()),
    })
}

/// Turn the engine's structured failure into something the user can act on.
/// Sync review is the one case the UI can resolve by ticking a checkbox, so it
/// gets an explicit instruction rather than the raw English CLI message.
fn sidecar_error_message(code: &str, message: &str) -> String {
    match code {
        "SYNC_REVIEW_REQUIRED" | "SYNC_LOW_CONFIDENCE" => {
            "遥测与录像的时间轴需要人工复核。请在「生成与重试」中勾选「我已检查同步，允许低置信度时间轴继续生成」后重试。".to_owned()
        }
        _ => format!("{message} [{code}]"),
    }
}

/// `delivery run --preset full` writes the recomputed sync back into the bundle
/// before it can fail. Read it from there so the Session record does not keep
/// claiming that no review is needed after such a failure.
fn bundle_sync_state(bundle_path: &Path) -> Option<BundleSync> {
    let raw: Value = read_json(bundle_path).ok()?;
    serde_json::from_value(raw.get("sync")?.clone()).ok()
}

#[tauri::command]
fn probe_obs(obs_url: String) -> obs_readiness::ObsReadiness {
    obs_readiness::probe_obs_readiness(&obs_url)
}

#[tauri::command]
fn get_desktop_state() -> DesktopState {
    let settings = load_settings();
    let sessions = load_registry(Path::new(&settings.data_root)).sessions;
    let engine_error = engine_error();
    DesktopState {
        settings,
        sessions,
        engine_ready: engine_error.is_none(),
        engine_error,
        build_info: resources_dir().ok().and_then(|directory| read_json::<Value>(&directory.join("build-info.json")).ok()),
    }
}

#[tauri::command]
fn save_settings(settings: DesktopSettings) -> Result<DesktopState, String> {
    save_desktop_settings(&settings)?;
    Ok(get_desktop_state())
}

#[tauri::command]
fn rebuild_session_registry() -> Result<Vec<LocalSessionRecord>, String> {
    let settings = load_settings();
    rebuild_registry(Path::new(&settings.data_root))
}

#[tauri::command]
fn start_capture(app: AppHandle, request: CaptureRequest) -> Result<(), String> {
    let settings = load_settings();
    validate_settings(&settings)?;
    if let Some(error) = engine_error() {
        return Err(error);
    }
    let session_directory = Path::new(&settings.data_root)
        .join("sessions")
        .join(format!("capture-{}", now_millis()));
    fs::create_dir_all(&session_directory)
        .map_err(|error| format!("Cannot create Session directory: {error}"))?;
    let bundle = session_directory.join("session.bundle.json");
    let args = vec![
        "capture".into(),
        "watch".into(),
        "--provider".into(),
        "iracing".into(),
        "--output".into(),
        bundle.display().to_string(),
        "--telemetry-directory".into(),
        settings.telemetry_directory.clone(),
        "--obs-url".into(),
        settings.obs_url.clone(),
        "--obs-password-env".into(),
        "OBS_WEBSOCKET_PASSWORD".into(),
    ];
    event(&app, "capture", "info", "Waiting for iRacing. Recording begins at green.");
    std::thread::spawn(move || {
        match run_sidecar(app.clone(), "capture", args, Some(request.obs_password), None) {
            Ok(()) => match archive_capture_bundle(&bundle, &session_directory) {
                Ok(record) => {
                    let session_id = record.id.clone();
                    let data_root = PathBuf::from(&settings.data_root);
                    if let Err(error) = upsert_session(&data_root, record) {
                        event_for_session(&app, "capture", "error", error, Some(&session_id));
                        return;
                    }
                    event_for_session(&app, "capture", "info", "Session is ready to review.", Some(&session_id));
                }
                Err(error) => event(&app, "capture", "error", error),
            },
            Err(error) => event(&app, "capture", "error", error),
        }
        // Always signal termination so the UI clears its busy state even when
        // the engine exits without a usable error event.
        event(&app, "capture", "info", "Capture engine stopped.");
    });
    Ok(())
}

#[tauri::command]
fn import_and_generate(app: AppHandle, request: ImportGenerateRequest) -> Result<String, String> {
    let settings = load_settings();
    if settings.data_root.trim().is_empty() {
        return Err("Choose a Racing Memory data directory in Settings first.".to_owned());
    }
    if let Some(error) = engine_error() {
        return Err(error);
    }
    let telemetry = PathBuf::from(request.telemetry_path.trim());
    if !telemetry.is_file() {
        return Err("The selected IBT file is not available.".to_owned());
    }
    let video = request.video_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    if video.as_ref().is_some_and(|path| !path.is_file()) {
        return Err("The selected video file is not available.".to_owned());
    }
    if request.preset != "scorecard" && request.preset != "full" {
        return Err("The delivery preset must be scorecard or full.".to_owned());
    }
    if request.preset == "full" && video.is_none() {
        return Err("The full delivery preset requires a video.".to_owned());
    }
    let progress_id = format!("import-{}", now_millis());
    let session_directory = Path::new(&settings.data_root)
        .join("sessions")
        .join(&progress_id);
    fs::create_dir_all(&session_directory)
        .map_err(|error| format!("Cannot create Session directory: {error}"))?;
    let bundle = session_directory.join("session.bundle.json");
    let mut args = vec![
        "delivery".into(),
        "generate".into(),
        "--telemetry".into(),
        telemetry.display().to_string(),
        "--output".into(),
        session_directory.display().to_string(),
        "--preset".into(),
        request.preset,
    ];
    if let Some(path) = video {
        args.push("--video".into());
        args.push(path.display().to_string());
    }
    if request.accept_low_confidence {
        args.push("--accept-low-confidence".into());
    }
    let progress_file = session_directory.join("delivery-progress.ndjson");
    let error_file = session_directory.join("import-error.txt");
    event(&app, "delivery", "info", "Importing existing telemetry and generating race assets.");
    std::thread::spawn(move || {
        match run_sidecar(app.clone(), "delivery", args, None, Some(progress_file)) {
            Ok(()) => match archive_capture_bundle(&bundle, &session_directory) {
                Ok(mut record) => {
                    record.delivery_status = "succeeded".to_owned();
                    let (card, reason) = read_training_artifact(&session_directory);
                    record.training_card = card;
                    record.training_reason = reason;
                    record.assets = scan_assets(&session_directory);
                    let session_id = record.id.clone();
                    match upsert_session(Path::new(&settings.data_root), record) {
                        Ok(()) => event_for_session(&app, "delivery", "info", "Imported Session is ready.", Some(&session_id)),
                        Err(error) => event_for_session(&app, "delivery", "error", error, Some(&session_id)),
                    }
                }
                Err(error) => {
                    let _ = fs::write(&error_file, &error);
                    event(&app, "delivery", "error", error);
                }
            },
            Err(error) => {
                let _ = fs::write(&error_file, &error);
                event(&app, "delivery", "error", error);
            }
        }
    });
    Ok(progress_id)
}

#[tauri::command]
fn get_delivery_progress(session_id: String) -> Result<Vec<String>, String> {
    let settings = load_settings();
    let registry = load_registry(Path::new(&settings.data_root));
    let record = registry.sessions.iter()
        .find(|session| session.id == session_id)
        .ok_or_else(|| "Session not found.".to_owned())?;
    let path = Path::new(&record.session_directory).join("delivery-progress.ndjson");
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(fs::read_to_string(path)
        .map_err(|error| format!("Could not read delivery progress: {error}"))?
        .lines()
        .map(str::to_owned)
        .collect())
}

fn import_progress_directory(data_root: &Path, progress_id: &str) -> Result<PathBuf, String> {
    let suffix = progress_id
        .strip_prefix("import-")
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| "Invalid import progress id.".to_owned())?;
    Ok(data_root.join("sessions").join(format!("import-{suffix}")))
}

#[tauri::command]
fn get_import_progress(progress_id: String) -> Result<ImportProgressSnapshot, String> {
    let settings = load_settings();
    let directory = import_progress_directory(Path::new(&settings.data_root), &progress_id)?;
    let progress_path = directory.join("delivery-progress.ndjson");
    let lines = if progress_path.is_file() {
        fs::read_to_string(progress_path)
            .map_err(|error| format!("Could not read import progress: {error}"))?
            .lines()
            .map(str::to_owned)
            .collect()
    } else {
        Vec::new()
    };
    let error_path = directory.join("import-error.txt");
    let error = error_path.is_file()
        .then(|| fs::read_to_string(error_path).unwrap_or_else(|_| "Import failed.".to_owned()));
    let session_id = load_registry(Path::new(&settings.data_root))
        .sessions
        .into_iter()
        .find(|session| Path::new(&session.session_directory) == directory)
        .map(|session| session.id);
    Ok(ImportProgressSnapshot {
        lines,
        session_id,
        error,
    })
}

#[tauri::command]
fn read_image_preview(path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(path);
    let mime = match path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => return Ok(None),
    };
    let metadata = fs::metadata(&path).map_err(|error| format!("Cannot read preview file: {error}"))?;
    if !metadata.is_file() || metadata.len() > 12 * 1024 * 1024 {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|error| format!("Cannot read preview file: {error}"))?;
    Ok(Some(format!("data:{mime};base64,{}", BASE64_STANDARD.encode(bytes))))
}

#[tauri::command]
fn open_local_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("The local file is no longer available.".to_owned());
    }
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Process -FilePath $env:RACING_MEMORY_OPEN_PATH",
            ])
            .env("RACING_MEMORY_OPEN_PATH", &path);
        command.creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|error| format!("Could not open local file: {error}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("Could not open local file: {error}"))?;
        Ok(())
    }
}

fn bridge_token() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Cannot read Session telemetry: {error}"))?;
    let mut hash = Sha256::new();
    // Tauri command threads have a relatively small stack on Windows. A 1 MiB
    // stack array overflowed it before the browser bridge could start.
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)
            .map_err(|error| format!("Cannot verify Session telemetry: {error}"))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("sha256:{:x}", hash.finalize()))
}

#[tauri::command]
fn pick_local_path(kind: String, current_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(path) = current_path
        .map(PathBuf::from)
        .filter(|path| path.exists())
    {
        dialog = dialog.set_directory(if path.is_dir() {
            path
        } else {
            path.parent().map(Path::to_path_buf).unwrap_or(path)
        });
    }
    let selected = match kind.as_str() {
        "telemetryFile" => dialog
            .add_filter("iRacing telemetry", &["ibt"])
            .pick_file(),
        "videoFile" => dialog
            .add_filter("Video recordings", &["mp4", "mov", "mkv", "avi", "webm"])
            .pick_file(),
        "directory" => dialog.pick_folder(),
        _ => return Err("Unsupported file picker type.".to_owned()),
    };
    Ok(selected.map(|path| path.to_string_lossy().into_owned()))
}

const ANALYSIS_CSP: &str = "default-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:";

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "ibt" => "application/octet-stream",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn write_http_status(stream: &mut TcpStream, status: &str, body: &[u8], mime: &str) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: {ANALYSIS_CSP}\r\nConnection: close\r\n\r\n", body.len())?;
    stream.write_all(body)
}

fn inject_desktop_session_meta(html: &str, token: &str) -> String {
    html.replacen(
        "</head>",
        &format!(r#"<meta name="lapwing-desktop-session" content="{token}"></head>"#),
        1,
    )
}

fn needs_analysis_bootstrap_redirect(uri: &str) -> bool {
    uri.starts_with("/?")
        && uri.contains("desktopSession=")
        && !uri.contains("desktopReady=1")
}

fn write_analysis_bootstrap_redirect(stream: &mut TcpStream, token: &str) -> std::io::Result<()> {
    let location = format!("/?desktopSession={token}&nosw=1&desktopReady=1");
    write!(
        stream,
        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
    )
}

fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let raw = value.trim().strip_prefix("bytes=")?;
    let (start, end) = raw.split_once('-')?;
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() { size.saturating_sub(1) } else { end.parse::<u64>().ok()? };
    (start < size && end >= start).then_some((start, end.min(size.saturating_sub(1))))
}

fn stream_file(
    stream: &mut TcpStream,
    path: &Path,
    range: Option<&str>,
) -> std::io::Result<()> {
    let mut file = fs::File::open(path)?;
    let size = file.metadata()?.len();
    if let Some((start, end)) = range.and_then(|value| parse_range(value, size)) {
        let length = end - start + 1;
        file.seek(SeekFrom::Start(start))?;
        write!(
            stream,
            "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Length: {length}\r\nContent-Range: bytes {start}-{end}/{size}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nContent-Security-Policy: {ANALYSIS_CSP}\r\nConnection: close\r\n\r\n",
            content_type(path),
        )?;
        std::io::copy(&mut file.take(length), stream)?;
        return Ok(());
    }
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {size}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nContent-Security-Policy: {ANALYSIS_CSP}\r\nConnection: close\r\n\r\n",
        content_type(path),
    )?;
    std::io::copy(&mut file, stream)?;
    Ok(())
}

fn handle_analysis_request(
    mut stream: TcpStream,
    token: &str,
    web_root: &Path,
    record: &LocalSessionRecord,
    sync: Option<&BundleSync>,
) -> std::io::Result<()> {
    // Windows can inherit the listener's non-blocking mode on accepted sockets.
    // Large telemetry/video responses then stop at the first WouldBlock even
    // though their Content-Length advertises the complete file.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let uri = request_line.split_whitespace().nth(1).unwrap_or("/");
    let mut range = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" {
            break;
        }
        if let Some(value) = line.strip_prefix("Range:").or_else(|| line.strip_prefix("range:")) {
            range = Some(value.trim().to_owned());
        }
    }

    let api_root = format!("/api/session/{token}");
    if needs_analysis_bootstrap_redirect(uri) {
        return write_analysis_bootstrap_redirect(&mut stream, token);
    }
    if uri == api_root {
        let descriptor = serde_json::json!({
            "telemetryUrl": format!("{api_root}/telemetry"),
            "telemetryFileName": Path::new(&record.telemetry_path).file_name().and_then(|value| value.to_str()).unwrap_or("session.ibt"),
            "video": record.video_path.as_ref().filter(|_| record.video_available).map(|path| serde_json::json!({
                "url": format!("{api_root}/video"),
                "fileName": Path::new(path).file_name().and_then(|value| value.to_str()).unwrap_or("session.mp4"),
            })),
            "sync": sync.map(|value| serde_json::json!({
                "offsetMs": value.sync_offset_ms.unwrap_or(0.0),
                "rate": value.sync_rate.unwrap_or(1.0),
                "confidence": &value.confidence,
                "requiresReview": value.requires_review,
            })),
            "autoUseWaypoint": true,
        });
        return write_http_status(&mut stream, "200 OK", descriptor.to_string().as_bytes(), "application/json; charset=utf-8");
    }
    if uri == format!("{api_root}/telemetry") {
        return stream_file(&mut stream, Path::new(&record.telemetry_path), range.as_deref());
    }
    if uri == format!("{api_root}/video") {
        if let Some(path) = record.video_path.as_deref().filter(|_| record.video_available) {
            return stream_file(&mut stream, Path::new(path), range.as_deref());
        }
        return write_http_status(&mut stream, "404 Not Found", b"Video unavailable", "text/plain; charset=utf-8");
    }
    if uri.starts_with("/api/") {
        return write_http_status(&mut stream, "404 Not Found", b"Not found", "text/plain; charset=utf-8");
    }

    let clean_uri = uri.split('?').next().unwrap_or("/");
    let relative = clean_uri.trim_start_matches('/');
    let candidate = if relative.is_empty() { PathBuf::from("index.html") } else { PathBuf::from(relative) };
    let safe = candidate.components().all(|component| matches!(component, std::path::Component::Normal(_)));
    let path = if safe && web_root.join(&candidate).is_file() {
        web_root.join(candidate)
    } else {
        web_root.join("index.html")
    };
    if !path.is_file() {
        return write_http_status(&mut stream, "404 Not Found", b"Web analysis bundle missing", "text/plain; charset=utf-8");
    }
    if path == web_root.join("index.html") {
        let html = fs::read_to_string(path)?;
        let injected = inject_desktop_session_meta(&html, token);
        return write_http_status(
            &mut stream,
            "200 OK",
            injected.as_bytes(),
            "text/html; charset=utf-8",
        );
    }
    stream_file(&mut stream, &path, None)
}

#[tauri::command]
fn open_web_analysis(session_id: String) -> Result<String, String> {
    let settings = load_settings();
    let record = load_registry(Path::new(&settings.data_root)).sessions.into_iter()
        .find(|session| session.id == session_id)
        .ok_or_else(|| "Session not found.".to_owned())?;
    if !Path::new(&record.telemetry_path).is_file() {
        return Err("The Session IBT file is no longer available.".to_owned());
    }
    if let Some(expected) = record.telemetry_sha256.as_deref() {
        if sha256_file(Path::new(&record.telemetry_path))? != expected {
            return Err("The Session IBT file has changed since it was imported. Re-import it before analysis.".to_owned());
        }
    }
    let web_root = resources_dir()?.join("web-analysis");
    if !web_root.join("index.html").is_file() {
        return Err("The installed build does not include LapWing Web analysis.".to_owned());
    }
    let bundle = read_json::<BundleDocument>(Path::new(&record.bundle_path))?;
    let sync = bundle.sync;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Cannot start local analysis service: {error}"))?;
    listener.set_nonblocking(true)
        .map_err(|error| format!("Cannot configure local analysis service: {error}"))?;
    let port = listener.local_addr()
        .map_err(|error| format!("Cannot read local analysis address: {error}"))?
        .port();
    let token = bridge_token();
    let url = format!("http://127.0.0.1:{port}/?desktopSession={token}&nosw=1");
    let server_token = token.clone();
    std::thread::spawn(move || {
        let mut last_request = Instant::now();
        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    last_request = Instant::now();
                    let _ = handle_analysis_request(stream, &server_token, &web_root, &record, sync.as_ref());
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if last_request.elapsed() > Duration::from_secs(10 * 60) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        }
    });
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", "Start-Process $env:RACING_MEMORY_ANALYSIS_URL"])
            .env("RACING_MEMORY_ANALYSIS_URL", &url);
        command.creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|error| format!("Could not open LapWing analysis: {error}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|error| format!("Could not open LapWing analysis: {error}"))?;
    Ok(url)
}

#[tauri::command]
fn run_delivery(app: AppHandle, request: DeliveryRequest) -> Result<(), String> {
    let settings = load_settings();
    let data_root = PathBuf::from(&settings.data_root);
    let record = update_session(&data_root, &request.session_id, |session| {
        session.delivery_status = "running".to_owned();
        session.delivery_error = None;
    })?;
    let output_directory = Path::new(&record.session_directory).join("delivery");
    let mut args = vec![
        "delivery".into(),
        "run".into(),
        record.bundle_path.clone(),
        "--output".into(),
        output_directory.display().to_string(),
        "--preset".into(),
        request.preset,
    ];
    if request.accept_low_confidence {
        args.push("--accept-low-confidence".into());
    }
    let session_id = record.id.clone();
    let progress_file = Path::new(&record.session_directory).join("delivery-progress.ndjson");
    let _ = fs::remove_file(&progress_file);
    event_for_session(&app, "delivery", "info", "Creating local race assets.", Some(&session_id));
    std::thread::spawn(move || {
        match run_sidecar(app.clone(), "delivery", args, None, Some(progress_file)) {
            Ok(()) => {
                let result = update_session(&data_root, &session_id, |session| {
                    session.delivery_status = "succeeded".to_owned();
                    session.delivery_error = None;
                    let directory = Path::new(&session.session_directory);
                    let (card, reason) = read_training_artifact(directory);
                    session.training_card = card;
                    session.training_reason = reason;
                    session.assets = scan_assets(directory);
                });
                match result {
                    Ok(_) => event_for_session(&app, "delivery", "info", "Race assets are ready.", Some(&session_id)),
                    Err(error) => event_for_session(&app, "delivery", "error", error, Some(&session_id)),
                }
            }
            Err(error) => {
                let _ = update_session(&data_root, &session_id, |session| {
                    session.delivery_status = "failed".to_owned();
                    session.delivery_error = Some(error.clone());
                    if let Some(sync) = bundle_sync_state(Path::new(&session.bundle_path)) {
                        session.sync_confidence = Some(sync.confidence);
                        session.sync_requires_review = sync.requires_review;
                    }
                });
                event_for_session(&app, "delivery", "error", error, Some(&session_id));
            }
        }
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_desktop_state,
            probe_obs,
            save_settings,
            rebuild_session_registry,
            start_capture,
            import_and_generate,
            get_import_progress,
            get_delivery_progress,
            read_image_preview,
            pick_local_path,
            open_local_path,
            open_web_analysis,
            run_delivery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Racing Memory");
}

#[cfg(test)]
mod tests {
    use super::{
        bundle_sync_state, import_progress_directory, inject_desktop_session_meta,
        needs_analysis_bootstrap_redirect, parse_range, scan_assets, sha256_file,
        sidecar_error_message, LocalSessionAsset,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn scan_assets_keeps_local_outputs_only() {
        let root = std::env::temp_dir().join(format!(
            "racing-memory-assets-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let assets = root.join("delivery").join("session-assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("memento.png"), "png").unwrap();
        fs::write(assets.join("ignored.txt"), "text").unwrap();

        let found: Vec<LocalSessionAsset> = scan_assets(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "session memento");
        assert!(found[0].available);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scan_assets_prefers_the_declared_delivery_manifest() {
        let root = std::env::temp_dir().join(format!(
            "racing-memory-manifest-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let delivery = root.join("delivery");
        let report = delivery.join("report");
        fs::create_dir_all(&report).unwrap();
        fs::write(report.join("scorecard-summary.png"), "png").unwrap();
        fs::write(delivery.join("delivery-manifest.json"), r#"{
          "schemaVersion": 1,
          "items": [{
            "id": "scorecard",
            "role": "scorecard",
            "group": "overview",
            "title": "赛后成绩单",
            "path": "report/scorecard-summary.png",
            "mediaType": "image/png",
            "order": 10
          }]
        }"#).unwrap();
        let found = scan_assets(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].title.as_deref(), Some("赛后成绩单"));
        assert_eq!(found[0].group.as_deref(), Some("overview"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scan_assets_drops_retired_reel_and_html_report() {
        let root = std::env::temp_dir().join(format!(
            "racing-memory-retired-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let delivery = root.join("delivery");
        let report = delivery.join("report");
        fs::create_dir_all(&report).unwrap();
        fs::write(report.join("index.html"), "report").unwrap();
        fs::write(report.join("scorecard-summary.png"), "png").unwrap();
        fs::write(delivery.join("reel.mp4"), "reel").unwrap();
        fs::write(delivery.join("fastest-available-lap.mp4"), "lap").unwrap();
        fs::write(delivery.join("delivery-manifest.json"), r#"{
          "schemaVersion": 1,
          "items": [
            {"id": "reel", "role": "primary-video", "group": "video", "title": "Racing Memory 回忆视频", "path": "reel.mp4", "mediaType": "video/mp4", "order": 10},
            {"id": "report", "role": "report", "group": "report", "title": "完整赛后报告", "path": "report/index.html", "mediaType": "text/html", "order": 20},
            {"id": "scorecard", "role": "scorecard", "group": "overview", "title": "赛后成绩单", "path": "report/scorecard-summary.png", "mediaType": "image/png", "order": 30},
            {"id": "fastest", "role": "supporting-video", "group": "video", "title": "最快完整圈", "path": "fastest-available-lap.mp4", "mediaType": "video/mp4", "order": 40}
          ]
        }"#).unwrap();
        let found = scan_assets(&root);
        assert_eq!(
            found.iter().map(|item| item.title.as_deref().unwrap_or("")).collect::<Vec<_>>(),
            vec!["赛后成绩单", "最快完整圈"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_bounded_http_byte_ranges() {
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=90-", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
    }

    #[test]
    fn import_progress_ids_cannot_escape_the_sessions_directory() {
        let root = std::env::temp_dir().join("racing-memory-progress-root");
        assert_eq!(
            import_progress_directory(&root, "import-123").unwrap(),
            root.join("sessions").join("import-123")
        );
        for invalid in ["123", "import-", "import-../settings", "import-1/../../settings", "import-１２３"] {
            assert!(import_progress_directory(&root, invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn injects_the_desktop_session_token_into_the_analysis_shell() {
        let html = inject_desktop_session_meta(
            "<html><head><title>LapWing</title></head><body></body></html>",
            "abc123",
        );
        assert!(html.contains(r#"<meta name="lapwing-desktop-session" content="abc123">"#));
    }

    #[test]
    fn sync_failure_becomes_an_actionable_message() {
        let text = sidecar_error_message(
            "SYNC_REVIEW_REQUIRED",
            "Automatic synchronization needs review.",
        );
        assert!(text.contains("勾选"));
        assert!(!text.contains("Automatic"));
    }

    #[test]
    fn other_engine_failures_keep_the_original_diagnostic() {
        let text = sidecar_error_message("FILE_NOT_FOUND", "Bundle input not found: race.ibt");
        assert!(text.contains("Bundle input not found: race.ibt"));
        assert!(text.contains("FILE_NOT_FOUND"));
    }

    #[test]
    fn reads_recomputed_sync_state_from_a_bundle() {
        let path = std::env::temp_dir().join(format!(
            "racing-memory-sync-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::write(&path, r#"{"sync":{"confidence":"low","requiresReview":true}}"#).unwrap();
        let sync = bundle_sync_state(&path).unwrap();
        assert_eq!(sync.confidence, "low");
        assert!(sync.requires_review);
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn redirects_the_first_browser_navigation_once() {
        assert!(needs_analysis_bootstrap_redirect(
            "/?desktopSession=abc123&nosw=1"
        ));
        assert!(!needs_analysis_bootstrap_redirect(
            "/?desktopSession=abc123&nosw=1&desktopReady=1"
        ));
    }

    #[test]
    fn hashes_session_telemetry_before_exposing_it() {
        let path = std::env::temp_dir().join(format!(
            "racing-memory-hash-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::write(&path, "abc").unwrap();
        assert_eq!(
            sha256_file(&path).unwrap(),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::remove_file(path).unwrap();
    }
}
