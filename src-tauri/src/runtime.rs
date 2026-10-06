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
    ingest_batch, issue_ticket, pair_status, submit_pair, PairOutcome, PairingTicket,
};

fn host_ports() -> std::ops::RangeInclusive<u16> {
    47654..=47670
}

#[derive(Clone)]
pub struct SharedHost(pub Arc<Mutex<HostInner>>);

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
    let store = FsStore::open(dir.join("host")).map_err(|error| error.to_string())?;
    let cert = crate::adapters::load_or_create(&dir).map_err(|error| error.to_string())?;
    let pc_id = load_pc_id(&dir).map_err(|error| error.to_string())?;
    let phone = load_phone(&dir).map_err(|error| error.to_string())?;
    let known_pcs = load_known_pcs(&dir).map_err(|error| error.to_string())?;
    let port = bindable_port().ok_or_else(|| "no free LAN port".to_string())?;
    let ticket = issue_ticket(&SystemClock);
    let pc_name = store
        .load_settings()
        .map(|settings| settings.pc_display_name)
        .unwrap_or_else(|_| "My PC".to_string());
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
        data_dir: dir,
    })));
    app.manage(shared.clone());
    spawn_server(shared, cert, port);
    if let Err(error) = crate::adapters::advertise(&pc_id_text, &pc_name, port) {
        eprintln!("fast-share discovery: {error}");
    }
    Ok(())
}

fn bindable_port() -> Option<u16> {
    host_ports().find(|port| {
        std::net::TcpListener::bind(("0.0.0.0", *port)).is_ok()
    })
}

fn spawn_server(shared: SharedHost, cert: HostCert, port: u16) {
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
                .route("/pair/status", post(status))
                .route("/batches", post(batches))
                .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
                .with_state(shared);
            let addr = SocketAddr::from(([0, 0, 0, 0], port));
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
    Ok(Json(view_outcome(outcome)))
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
    let outcome = pair_status(&mut host.store, &device_id, &body.poll_token).map_err(error_status)?;
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
    let mut host = shared.lock().map_err(storage_status)?;
    let device_id = DeviceId::parse(body.device_id).map_err(error_status)?;
    let batch_id = BatchId::parse(&body.batch_id).map_err(error_status)?;
    let mut images = Vec::new();
    for encoded in body.images {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| error_status(HostError::ImageUndecodable))?;
        images.push(bytes);
    }
    let host = &mut *host;
    ingest_batch(
        &mut host.store,
        &host.clipboard,
        &host.notifier,
        &device_id,
        &body.secret,
        batch_id,
        &images,
        Utc::now(),
    )
    .map_err(error_status)?;
    Ok(Json(serde_json::json!({ "ok": true, "imageCount": images.len() })))
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
            secret: Some(secret),
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

    pub fn save_phone_book(&self) -> Result<(), HostError> {
        write_json(&self.data_dir.join("phone-book.json"), &self.known_pcs)
    }

    pub fn set_phone_name(&mut self, name: &str) -> Result<(), HostError> {
        crate::domain::validate_name(name)?;
        self.phone.name = name.trim().to_string();
        write_json(&self.data_dir.join("phone-identity.json"), &self.phone)
    }
}

pub fn qr_png(payload: &QrPayload) -> Result<Vec<u8>, HostError> {
    let text = serde_json::to_string(payload).map_err(|error| HostError::Storage(error.to_string()))?;
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
        let text = std::fs::read_to_string(path).map_err(|error| HostError::Storage(error.to_string()))?;
        return PcId::parse(text.trim());
    }
    let id = PcId::generate();
    std::fs::write(path, id.as_str()).map_err(|error| HostError::Storage(error.to_string()))?;
    Ok(id)
}

fn load_phone(dir: &std::path::Path) -> Result<PhoneIdentity, HostError> {
    let path = dir.join("phone-identity.json");
    if path.exists() {
        let text = std::fs::read_to_string(path).map_err(|error| HostError::Storage(error.to_string()))?;
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
    let text = std::fs::read_to_string(path).map_err(|error| HostError::Storage(error.to_string()))?;
    serde_json::from_str(&text).map_err(|error| HostError::Storage(error.to_string()))
}

fn write_json<T: serde::Serialize>(path: &std::path::Path, value: &T) -> Result<(), HostError> {
    let text = serde_json::to_string_pretty(value).map_err(|error| HostError::Storage(error.to_string()))?;
    std::fs::write(path, text).map_err(|error| HostError::Storage(error.to_string()))
}

