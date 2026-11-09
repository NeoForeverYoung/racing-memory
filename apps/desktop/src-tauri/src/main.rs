use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

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
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSessionAsset {
    kind: String,
    path: String,
    available: bool,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopState {
    settings: DesktopSettings,
    sessions: Vec<LocalSessionRecord>,
    engine_ready: bool,
    engine_error: Option<String>,
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
    validate_settings(settings)?;
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

fn scan_assets(session_directory: &Path) -> Vec<LocalSessionAsset> {
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
            assets.push(LocalSessionAsset {
                kind: kind.to_owned(),
                available: true,
                path: path.display().to_string(),
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
                event(&stderr_app, kind, level, line);
            }
        }
    });
    let status = child.wait().map_err(|error| format!("Could not wait for the engine: {error}"))?;
    let _ = stdout_reader.join();
    let _ = stderr_reader.join();
    if status.success() {
        Ok(())
    } else {
        Err(format!("Engine stopped with exit {:?}.", status.code()))
    }
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
    });
    Ok(())
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
            save_settings,
            rebuild_session_registry,
            start_capture,
            get_delivery_progress,
            run_delivery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Racing Memory");
}

#[cfg(test)]
mod tests {
    use super::{scan_assets, LocalSessionAsset};
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
}
