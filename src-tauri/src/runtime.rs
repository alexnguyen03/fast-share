use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::{DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::adapters::{lan_ipv4, FsStore, HostCert, OsClipboard, OsNotifier};
use crate::domain::{BatchId, DeviceId, HostError, PcId, QrPayload};
use crate::ports::{Clock, Store, SystemClock};
use crate::use_cases::{
    authorize_batch, commit_validated_batch, decode_batch_images, issue_ticket, pair_status,
    submit_pair, submit_pair_code, PairOutcome, PairingTicket,
};

fn host_ports() -> std::ops::RangeInclusive<u16> {
    47654..=47670
}

#[derive(Clone)]
pub struct SharedHost(pub Arc<Mutex<HostInner>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DockEdge {
    Left,
    Right,
    Top,
    Bottom,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPrefs {
    pub snap_to_edge: bool,
    pub always_on_top: bool,
    pub dock_edge: Option<DockEdge>,
    pub dock_expanded: bool,
    pub dock_x: i32,
    pub dock_y: i32,
}

impl Default for WindowPrefs {
    fn default() -> Self {
        Self {
            snap_to_edge: true,
            always_on_top: false,
            dock_edge: None,
            dock_expanded: true,
            dock_x: 160,
            dock_y: 120,
        }
    }
}

pub struct HostInner {
    pub store: FsStore,
    pub clipboard: OsClipboard,
    pub notifier: OsNotifier,
    pub ticket: PairingTicket,
    pub pc_id: PcId,
    pub cert: HostCert,
    pub port: u16,
    pub phone: PhoneIdentity,
    pub known_pcs: Vec<KnownPc>,
    pub window_prefs: WindowPrefs,
    pub data_dir: std::path::PathBuf,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneIdentity {
    pub device_id: DeviceId,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownPc {
    pub pc_id: PcId,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub cert_der: String,
    pub secret: Option<String>,
    #[serde(default)]
    pub poll_token: Option<String>,
}

pub fn start(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let mut store = FsStore::open(dir.join("host")).map_err(|error| error.to_string())?;
    let settings = store.load_settings().map_err(|error| error.to_string())?;
    let _ = crate::use_cases::purge_expired(
        &mut store,
        SystemClock.now(),
        settings.history_retention_days,
    );
    let cert = crate::adapters::load_or_create(&dir).map_err(|error| error.to_string())?;
    let pc_id = load_pc_id(&dir).map_err(|error| error.to_string())?;
    let phone = load_phone(&dir).map_err(|error| error.to_string())?;
    let known_pcs = load_known_pcs(&dir).map_err(|error| error.to_string())?;
    let is_mobile = cfg!(any(target_os = "ios", target_os = "android"));
    let bind_ip = lan_ipv4();
    let port = if is_mobile {
        0
    } else {
        bindable_port(bind_ip).ok_or_else(|| "no free LAN port".to_string())?
    };
    let ticket = issue_ticket(&SystemClock);
    let pc_name = settings.pc_display_name;
    let pc_id_text = pc_id.as_str().to_string();
    let shared = SharedHost(Arc::new(Mutex::new(HostInner {
        store,
        clipboard: OsClipboard,
        notifier: OsNotifier::new(app.clone()),
        ticket,
        pc_id,
        cert: HostCert {
            cert_der: cert.cert_der.clone(),
            key_der: cert.key_der.clone(),
            fingerprint: cert.fingerprint.clone(),
        },
        port,
        phone,
        known_pcs,
        window_prefs: WindowPrefs::default(),
        data_dir: dir,
    })));
    app.manage(shared.clone());
    if !is_mobile {
        let cert_fp = cert.fingerprint.clone();
        spawn_server(shared.clone(), cert, bind_ip, port);
        spawn_retention_loop(shared);
        if let Err(error) = crate::adapters::advertise(&pc_id_text, &pc_name, port, &cert_fp) {
            eprintln!("fast-share discovery: {error}");
        }
    }
    Ok(())
}

fn bindable_port(bind_ip: std::net::Ipv4Addr) -> Option<u16> {
    host_ports().find(|port| std::net::TcpListener::bind((bind_ip, *port)).is_ok())
}

fn spawn_retention_loop(shared: SharedHost) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
        if let Ok(mut host) = shared.lock() {
            if let Ok(settings) = host.store.load_settings() {
                let _ = crate::use_cases::purge_expired(
                    &mut host.store,
                    SystemClock.now(),
                    settings.history_retention_days,
                );
            }
        }
    });
}

fn spawn_server(shared: SharedHost, cert: HostCert, bind_ip: std::net::Ipv4Addr, port: u16) {
    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("fast-share server runtime: {error}");
                return;
            }
        };
        runtime.block_on(async move {
            let _ = rustls::crypto::ring::default_provider().install_default();
            let config = match axum_server::tls_rustls::RustlsConfig::from_der(
                vec![cert.cert_der],
                cert.key_der,
            )
            .await
            {
                Ok(config) => config,
                Err(error) => {
                    eprintln!("fast-share tls: {error}");
                    return;
                }
            };
            let app = Router::new()
                .route("/ready", get(ready))
                .route("/pair", post(pair))
                .route("/pair/code", post(pair_code))
                .route("/pair/status", post(status))
                .route("/batches", post(batches))
                .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
                .with_state(shared);
            let addr = SocketAddr::from((bind_ip, port));
            if let Err(error) = axum_server::bind_rustls(addr, config)
                .serve(app.into_make_service())
                .await
            {
                eprintln!("fast-share server: {error}");
            }
        });
    });
}

async fn ready() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairBody {
    token: String,
    device_id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairView {
    status: String,
    poll_token: Option<String>,
    secret: Option<String>,
}

async fn pair(
    State(shared): State<SharedHost>,
    Json(body): Json<PairBody>,
) -> Result<Json<PairView>, (StatusCode, String)> {
    let mut host = shared.lock().map_err(storage_status)?;
    let device_id = DeviceId::parse(body.device_id).map_err(error_status)?;
    let host = &mut *host;
    let outcome = submit_pair(
        &mut host.store,
        &mut host.ticket,
        &body.token,
        device_id,
        &body.name,
        Utc::now(),
    )
    .map_err(error_status)?;
    host.notifier
        .emit_event("device-pair-event", body.name.trim());
    Ok(Json(view_outcome(outcome)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairCodeBody {
    code: String,
    device_id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairCodeView {
    status: String,
    poll_token: Option<String>,
    secret: Option<String>,
    pc_id: String,
    name: String,
    fingerprint: String,
    cert_der: String,
}

async fn pair_code(
    State(shared): State<SharedHost>,
    Json(body): Json<PairCodeBody>,
) -> Result<Json<PairCodeView>, (StatusCode, String)> {
    let mut host = shared.lock().map_err(storage_status)?;
    let device_id = DeviceId::parse(body.device_id).map_err(error_status)?;
    let host = &mut *host;
    host.refresh_ticket();
    let outcome = submit_pair_code(
        &mut host.store,
        &mut host.ticket,
        &body.code,
        device_id,
        &body.name,
        Utc::now(),
    )
    .map_err(error_status)?;
    host.notifier
        .emit_event("device-pair-event", body.name.trim());
    let settings = host.store.load_settings().map_err(error_status)?;
    let view = view_outcome(outcome);
    Ok(Json(PairCodeView {
        status: view.status,
        poll_token: view.poll_token,
        secret: view.secret,
        pc_id: host.pc_id.as_str().to_string(),
        name: settings.pc_display_name,
        fingerprint: host.cert.fingerprint.clone(),
        cert_der: base64::engine::general_purpose::STANDARD.encode(&host.cert.cert_der),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusBody {
    device_id: String,
    poll_token: String,
}

async fn status(
    State(shared): State<SharedHost>,
    Json(body): Json<StatusBody>,
) -> Result<Json<PairView>, (StatusCode, String)> {
    let mut host = shared.lock().map_err(storage_status)?;
    let device_id = DeviceId::parse(body.device_id).map_err(error_status)?;
    let outcome =
        pair_status(&mut host.store, &device_id, &body.poll_token).map_err(error_status)?;
    Ok(Json(view_outcome(outcome)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchBody {
    device_id: String,
    secret: String,
    batch_id: String,
    images: Vec<String>,
}

async fn batches(
    State(shared): State<SharedHost>,
    Json(body): Json<BatchBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let device_id = DeviceId::parse(body.device_id).map_err(error_status)?;
    let batch_id = BatchId::parse(&body.batch_id).map_err(error_status)?;
    let image_count = body.images.len();
    let already_stored = {
        let host = shared.lock().map_err(storage_status)?;
        authorize_batch(
            &host.store,
            &device_id,
            &body.secret,
            &batch_id,
            image_count,
        )
        .map_err(error_status)?
    };
    if already_stored {
        return Ok(Json(
            serde_json::json!({ "ok": true, "imageCount": image_count }),
        ));
    }
    let validated = decode_batch_images(&body.images).map_err(error_status)?;
    let mut host = shared.lock().map_err(storage_status)?;
    let host = &mut *host;
    commit_validated_batch(
        &mut host.store,
        &host.clipboard,
        &host.notifier,
        &device_id,
        &body.secret,
        batch_id,
        &validated,
        Utc::now(),
    )
    .map_err(error_status)?;
    Ok(Json(
        serde_json::json!({ "ok": true, "imageCount": validated.len() }),
    ))
}

fn view_outcome(outcome: PairOutcome) -> PairView {
    match outcome {
        PairOutcome::Pending { poll_token } => PairView {
            status: "pending".into(),
            poll_token: Some(poll_token),
            secret: None,
        },
        PairOutcome::Trusted { secret } => PairView {
            status: "trusted".into(),
            poll_token: None,
            secret,
        },
        PairOutcome::Rejected => PairView {
            status: "rejected".into(),
            poll_token: None,
            secret: None,
        },
    }
}

fn error_status(error: HostError) -> (StatusCode, String) {
    let status = match error {
        HostError::UnknownPhone | HostError::NotTrusted | HostError::PairingRejected => {
            StatusCode::FORBIDDEN
        }
        HostError::PairingExpired => StatusCode::GONE,
        HostError::ImageTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        HostError::ImageUndecodable | HostError::InvalidId | HostError::InvalidName => {
            StatusCode::BAD_REQUEST
        }
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, error.to_string())
}

fn storage_status(error: HostError) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

impl SharedHost {
    pub fn lock(&self) -> Result<std::sync::MutexGuard<'_, HostInner>, HostError> {
        self.0
            .lock()
            .map_err(|error| HostError::Storage(error.to_string()))
    }
}

impl HostInner {
    pub fn refresh_ticket(&mut self) {
        let now = SystemClock.now();
        if self.ticket.used || self.ticket.expires_at <= now {
            self.ticket = issue_ticket(&SystemClock);
        }
    }

    pub fn qr_payload(&mut self) -> Result<QrPayload, HostError> {
        self.refresh_ticket();
        let settings = self.store.load_settings()?;
        Ok(QrPayload {
            v: 1,
            pc_id: self.pc_id.as_str().to_string(),
            name: settings.pc_display_name,
            host: lan_ipv4().to_string(),
            port: self.port,
            token: self.ticket.token.clone(),
            fingerprint: self.cert.fingerprint.clone(),
            cert_der: base64::engine::general_purpose::STANDARD.encode(&self.cert.cert_der),
            expires_at: self.ticket.expires_at.to_rfc3339(),
        })
    }

    pub fn apply_discovered_hosts(
        &mut self,
        discovered: &[crate::adapters::DiscoveredHost],
    ) -> bool {
        let mut changed = false;
        for pc in &mut self.known_pcs {
            if let Some(found) = discovered
                .iter()
                .find(|item| item.pc_id == pc.pc_id.as_str())
            {
                if crate::domain::require_lan_host(&found.host).is_ok()
                    && found.port != 0
                    && (pc.host != found.host || pc.port != found.port)
                {
                    pc.host = found.host.clone();
                    pc.port = found.port;
                    changed = true;
                }
            }
        }
        changed
    }

    pub fn save_phone_book(&self) -> Result<(), HostError> {
        let text = serde_json::to_string_pretty(&self.known_pcs)
            .map_err(|error| HostError::Storage(error.to_string()))?;
        crate::adapters::write_private_bytes(
            &self.data_dir.join("phone-book.json"),
            text.as_bytes(),
        )
    }

    pub fn set_phone_name(&mut self, name: &str) -> Result<(), HostError> {
        crate::domain::validate_name(name)?;
        self.phone.name = name.trim().to_string();
        write_json(&self.data_dir.join("phone-identity.json"), &self.phone)
    }
}

pub fn qr_png(payload: &QrPayload) -> Result<Vec<u8>, HostError> {
    let text =
        serde_json::to_string(payload).map_err(|error| HostError::Storage(error.to_string()))?;
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::L)
        .map_err(|error| HostError::Storage(error.to_string()))?;
    let image = code
        .render::<image::Luma<u8>>()
        .module_dimensions(6, 6)
        .build();
    let mut bytes = Vec::new();
    image::DynamicImage::ImageLuma8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|error| HostError::Storage(error.to_string()))?;
    Ok(bytes)
}

fn load_pc_id(dir: &std::path::Path) -> Result<PcId, HostError> {
    let path = dir.join("pc-id.txt");
    if path.exists() {
        let text =
            std::fs::read_to_string(path).map_err(|error| HostError::Storage(error.to_string()))?;
        return PcId::parse(text.trim());
    }
    let id = PcId::generate();
    std::fs::write(path, id.as_str()).map_err(|error| HostError::Storage(error.to_string()))?;
    Ok(id)
}

fn load_phone(dir: &std::path::Path) -> Result<PhoneIdentity, HostError> {
    let path = dir.join("phone-identity.json");
    if path.exists() {
        let text =
            std::fs::read_to_string(path).map_err(|error| HostError::Storage(error.to_string()))?;
        return serde_json::from_str(&text).map_err(|error| HostError::Storage(error.to_string()));
    }
    let identity = PhoneIdentity {
        device_id: DeviceId::generate(),
        name: "My iPhone".to_string(),
    };
    write_json(&path, &identity)?;
    Ok(identity)
}

fn load_known_pcs(dir: &std::path::Path) -> Result<Vec<KnownPc>, HostError> {
    let path = dir.join("phone-book.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text =
        std::fs::read_to_string(path).map_err(|error| HostError::Storage(error.to_string()))?;
    serde_json::from_str(&text).map_err(|error| HostError::Storage(error.to_string()))
}

fn write_json<T: serde::Serialize>(path: &std::path::Path, value: &T) -> Result<(), HostError> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| HostError::Storage(error.to_string()))?;
    std::fs::write(path, text).map_err(|error| HostError::Storage(error.to_string()))
}
