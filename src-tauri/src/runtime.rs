use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::adapters::channel::{handshake_responder, sas, Established, Frames, Session};
use crate::adapters::keys::{load_or_create_keys, KeyPair};
use crate::adapters::phone_client::open_relay;
use crate::adapters::{lan_ipv4, FsStore, HostCert, OsClipboard, OsNotifier};
use crate::domain::{
    mailbox_for, BatchId, DeviceId, DeviceTrust, HostError, Hello, Msg, PcId, QrPayload,
    RelayInfo, MAX_IMAGE_BYTES, MAX_TEXT_BYTES,
};
use crate::ports::{Clock, Store, SystemClock};
use crate::use_cases::{
    authorize_batch, base64_key, commit_validated_batch, decode_batch_images, ingest_text,
    issue_ticket, reject_device, request_pairing, PairingTicket,
};

/// One batch may carry up to 20 images, but never more than this in total.
const MAX_BATCH_BYTES: usize = 100 * 1024 * 1024;
/// A frame is one Noise message: 65 535 bytes at most.
const MAX_FRAME_BYTES: usize = 65_535;

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
    pub keys: KeyPair,
    /// The relay this computer is reachable through, when the admin configured one.
    pub relay: Option<RelayInfo>,
    /// What the relay connection is doing right now (desktop only).
    pub relay_status: RelayStatus,
    /// Bumped whenever the relay setting changes, so an older connection task stops itself.
    pub relay_generation: u64,
    /// The LAN address the TLS listener is actually bound to. It can differ
    /// from the live `lan_ipv4()` after a network change until the watcher
    /// rebinds, so the QR payload must follow this field, not the live one.
    pub bind_ip: Ipv4Addr,
    pub port: u16,
    pub server_handle: Option<axum_server::Handle>,
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
    /// The computer's X25519 public key (standard base64) once the user confirmed it.
    #[serde(default)]
    pub public_key: Option<String>,
    /// A pairing attempt is in flight (the user on the computer has not answered yet).
    #[serde(default)]
    pub pending: bool,
    /// Six digits to compare with the computer, once the handshake is done.
    #[serde(default)]
    pub sas: Option<String>,
    #[serde(default)]
    pub failure: Option<String>,
    /// How to reach this computer from outside the Wi-Fi.
    #[serde(default)]
    pub relay: Option<RelayInfo>,
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
    let keys = load_or_create_keys(&dir).map_err(|error| error.to_string())?;
    let phone = load_phone(&dir, &keys).map_err(|error| error.to_string())?;
    let known_pcs = load_known_pcs(&dir).map_err(|error| error.to_string())?;
    let is_mobile = cfg!(any(target_os = "ios", target_os = "android"));
    let bind_ip = lan_ipv4();
    let binding = if is_mobile {
        None
    } else {
        Some(bind_listener(bind_ip, None).ok_or_else(|| "no free LAN port".to_string())?)
    };
    let port = binding.as_ref().map(|(port, _)| *port).unwrap_or(0);
    let ticket = issue_ticket(&SystemClock);
    let pc_name = settings.pc_display_name;
    let pc_id_text = pc_id.as_str().to_string();
    let cert_fp = cert.fingerprint.clone();
    let cert_for_server = HostCert {
        cert_der: cert.cert_der.clone(),
        key_der: cert.key_der.clone(),
        fingerprint: cert.fingerprint.clone(),
    };
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
        keys: keys.clone(),
        relay: load_relay(&dir),
        relay_status: RelayStatus::Off,
        relay_generation: 0,
        bind_ip,
        port,
        server_handle: None,
        phone,
        known_pcs,
        window_prefs: WindowPrefs::default(),
        data_dir: dir,
    })));
    app.manage(shared.clone());
    if !is_mobile {
        let (_, listener) = binding.ok_or_else(|| "no free LAN port".to_string())?;
        spawn_server(shared.clone(), cert_for_server, listener);
        spawn_retention_loop(shared.clone());
        if shared.lock().is_ok_and(|host| host.relay.is_some()) {
            spawn_relay(shared.clone(), app.clone());
        }
        if let Err(error) = crate::adapters::advertise(
            bind_ip,
            &pc_id_text,
            &pc_name,
            port,
            &cert_fp,
            &keys.public_b64(),
        )
        {
            eprintln!("fast-share discovery: {error}");
        }
        spawn_lan_watch(shared, app.clone());
    }
    Ok(())
}

fn bind_listener(
    bind_ip: Ipv4Addr,
    preferred: Option<u16>,
) -> Option<(u16, std::net::TcpListener)> {
    let preferred = preferred.filter(|port| host_ports().contains(port));
    if let Some(port) = preferred {
        if let Ok(listener) = std::net::TcpListener::bind((bind_ip, port)) {
            return Some((port, listener));
        }
    }
    host_ports().find_map(|port| {
        if Some(port) == preferred {
            return None;
        }
        std::net::TcpListener::bind((bind_ip, port))
            .ok()
            .map(|listener| (port, listener))
    })
}

/// Desktop only: follow the LAN address. When the machine moves to another
/// network the previously bound listener becomes unreachable while the QR code
/// and mDNS would keep advertising a live address, so rebind and republish.
fn spawn_lan_watch(shared: SharedHost, app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        let desired = lan_ipv4();
        if desired.is_loopback() {
            continue;
        }
        let (current_ip, current_port, pc_id_text, pc_name, fingerprint, public_key) = {
            let Ok(host) = shared.lock() else {
                continue;
            };
            let name = host
                .store
                .load_settings()
                .map(|settings| settings.pc_display_name)
                .unwrap_or_else(|_| "My PC".to_string());
            (
                host.bind_ip,
                host.port,
                host.pc_id.as_str().to_string(),
                name,
                host.cert.fingerprint.clone(),
                host.keys.public_b64(),
            )
        };
        if desired == current_ip {
            continue;
        }
        let Some((port, listener)) = bind_listener(desired, Some(current_port)) else {
            eprintln!("fast-share: LAN address is {desired} but no port could be bound");
            continue;
        };
        let previous_handle = {
            let Ok(mut host) = shared.lock() else {
                continue;
            };
            host.server_handle.take()
        };
        if let Some(handle) = previous_handle {
            handle.graceful_shutdown(Some(std::time::Duration::from_millis(1000)));
        }
        let cert = {
            let Ok(mut host) = shared.lock() else {
                continue;
            };
            host.bind_ip = desired;
            host.port = port;
            host.cert.clone()
        };
        spawn_server(shared.clone(), cert, listener);
        if let Err(error) =
            crate::adapters::advertise(desired, &pc_id_text, &pc_name, port, &fingerprint, &public_key)
        {
            eprintln!("fast-share discovery: {error}");
        }
        let _ = app.emit("lan-changed", ());
        eprintln!("fast-share: LAN address changed, now {desired}:{port}");
    });
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

fn spawn_server(shared: SharedHost, cert: HostCert, listener: std::net::TcpListener) {
    let handle = axum_server::Handle::new();
    if let Ok(mut host) = shared.lock() {
        host.server_handle = Some(handle.clone());
    }
    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
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
                .route("/v2/channel", get(channel_upgrade))
                .route("/v2/identity", get(identity))
                .with_state(shared);
            if let Err(error) = axum_server::from_tcp_rustls(listener, config)
                .handle(handle)
                .serve(app.into_make_service_with_connect_info::<SocketAddr>())
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

async fn identity(
    State(shared): State<SharedHost>,
) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    let host = shared
        .lock()
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
    let name = host
        .store
        .load_settings()
        .map(|settings| settings.pc_display_name)
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({
        "pcId": host.pc_id.as_str(),
        "name": name,
        "pubKey": host.keys.public_b64(),
        "fingerprint": host.cert.fingerprint,
    })))
}

async fn channel_upgrade(
    ws: WebSocketUpgrade,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(shared): State<SharedHost>,
) -> impl IntoResponse {
    ws.max_message_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| serve_channel(shared, socket, peer.ip()))
}

struct AxumFrames(WebSocket);

impl Frames for AxumFrames {
    async fn send(&mut self, bytes: Vec<u8>) -> Result<(), HostError> {
        self.0
            .send(Message::Binary(bytes.into()))
            .await
            .map_err(|error| HostError::Channel(error.to_string()))
    }

    async fn recv(&mut self) -> Result<Option<Vec<u8>>, HostError> {
        loop {
            match self.0.recv().await {
                None | Some(Ok(Message::Close(_))) => return Ok(None),
                Some(Ok(Message::Binary(bytes))) => return Ok(Some(bytes.to_vec())),
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                Some(Ok(Message::Text(_))) => {
                    return Err(HostError::Channel("unexpected text frame".into()))
                }
                Some(Err(error)) => return Err(HostError::Channel(error.to_string())),
            }
        }
    }
}

async fn serve_channel(shared: SharedHost, socket: WebSocket, peer: IpAddr) {
    serve_frames(shared, AxumFrames(socket), peer).await;
}

/// Serves one phone over any frame stream: the LAN WebSocket or a relay session.
async fn serve_frames<F: Frames>(shared: SharedHost, mut frames: F, peer: IpAddr) {
    let Ok(keys) = shared.lock().map(|host| host.keys.clone()) else {
        return;
    };
    let Ok((established, hello)) = handshake_responder(&mut frames, &keys).await else {
        return;
    };
    let Established {
        mut session,
        remote_public,
        hash,
    } = established;
    let device_id = DeviceId::from_public_key(&remote_public);
    if !is_trusted(&shared, &device_id, &remote_public) {
        if !hello.pair {
            let _ = session
                .send(&mut frames, &Msg::Error { code: "not-trusted".into() })
                .await;
            return;
        }
        if !await_pairing(
            &shared,
            &mut session,
            &mut frames,
            &hello,
            &remote_public,
            &hash,
            peer,
        )
        .await
        {
            return;
        }
    }
    while let Ok(Some(first)) = session.recv(&mut frames).await {
        let result = handle_message(&shared, &mut session, &mut frames, &device_id, first).await;
        if let Err(error) = result {
            let code = error_code(&error).to_string();
            let _ = session.send(&mut frames, &Msg::Error { code }).await;
            return;
        }
    }
}

fn is_trusted(shared: &SharedHost, device_id: &DeviceId, public_key: &[u8]) -> bool {
    let Ok(host) = shared.lock() else {
        return false;
    };
    matches!(
        host.store.get_phone(device_id),
        Ok(Some(phone)) if phone.trust == DeviceTrust::Trusted
            && phone.public_key.as_deref() == Some(base64_key(public_key).as_str())
    )
}

/// A key the desktop has never accepted asks to pair. Waits for the user, then tells the phone.
async fn await_pairing<F: Frames>(
    shared: &SharedHost,
    session: &mut Session,
    frames: &mut F,
    hello: &Hello,
    remote_public: &[u8],
    hash: &[u8],
    peer: IpAddr,
) -> bool {
    if !allow_pair_attempt(peer) {
        let _ = session
            .send(frames, &Msg::Error { code: "busy".into() })
            .await;
        return false;
    }
    let requested = {
        let Ok(mut host) = shared.lock() else {
            return false;
        };
        let host = &mut *host;
        host.refresh_ticket();
        let result = request_pairing(
            &mut host.store,
            &mut host.ticket,
            hello.pairing_token.as_deref(),
            remote_public,
            &hello.name,
            &sas(hash),
            Utc::now(),
        );
        if result.is_ok() {
            host.notifier
                .emit_event("device-pair-event", hello.name.trim());
        }
        result
    };
    let device_id = match requested {
        Ok(id) => id,
        Err(error) => {
            let code = error_code(&error).to_string();
            let _ = session.send(frames, &Msg::Error { code }).await;
            return false;
        }
    };
    // 2 minutes, the same time a pending request lives in the store.
    for _ in 0..240 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let trust = shared
            .lock()
            .ok()
            .and_then(|host| host.store.get_phone(&device_id).ok().flatten())
            .map(|phone| phone.trust);
        match trust {
            Some(DeviceTrust::Trusted) => {
                if session.send(frames, &Msg::Paired).await.is_err() {
                    return false;
                }
                let relay = shared.lock().ok().and_then(|host| host.relay.clone());
                if let Some(info) = relay {
                    let _ = session.send(frames, &Msg::Relay(info)).await;
                }
                return true;
            }
            Some(DeviceTrust::PendingAcceptance) => continue,
            _ => break,
        }
    }
    if let Ok(mut host) = shared.lock() {
        let _ = reject_device(&mut host.store, &device_id);
    }
    let _ = session.send(frames, &Msg::Rejected).await;
    false
}

async fn handle_message<F: Frames>(
    shared: &SharedHost,
    session: &mut Session,
    frames: &mut F,
    device_id: &DeviceId,
    first: Msg,
) -> Result<(), HostError> {
    match first {
        Msg::BeginImages { batch_id, count } => {
            receive_images(shared, session, frames, device_id, &batch_id, count as usize).await?
        }
        Msg::BeginText { batch_id, size } => {
            receive_text(shared, session, frames, device_id, &batch_id, size as usize).await?
        }
        _ => return Err(HostError::Channel("unexpected message".into())),
    }
    session.send(frames, &Msg::Ack).await
}

fn storage_error(error: impl std::fmt::Display) -> HostError {
    HostError::Storage(error.to_string())
}

async fn expect_end<F: Frames>(session: &mut Session, frames: &mut F) -> Result<(), HostError> {
    match session.recv(frames).await? {
        Some(Msg::End) => Ok(()),
        _ => Err(HostError::Channel("batch was not closed".into())),
    }
}

async fn receive_images<F: Frames>(
    shared: &SharedHost,
    session: &mut Session,
    frames: &mut F,
    device_id: &DeviceId,
    batch_id: &str,
    count: usize,
) -> Result<(), HostError> {
    let batch_id = BatchId::parse(batch_id)?;
    let already_stored = {
        let host = shared.lock()?;
        authorize_batch(&host.store, device_id, &batch_id, count)?
    };
    let mut images = Vec::with_capacity(count);
    let mut total = 0usize;
    for _ in 0..count {
        let Some(Msg::Item { size }) = session.recv(frames).await? else {
            return Err(HostError::Channel("expected an image".into()));
        };
        let size = size as usize;
        total += size;
        if size > MAX_IMAGE_BYTES || total > MAX_BATCH_BYTES {
            return Err(HostError::ImageTooLarge);
        }
        images.push(session.recv_chunks(frames, size).await?);
    }
    expect_end(session, frames).await?;
    if already_stored {
        return Ok(());
    }
    let validated = tokio::task::spawn_blocking(move || decode_batch_images(&images))
        .await
        .map_err(storage_error)??;
    let mut host = shared.lock()?;
    let host = &mut *host;
    commit_validated_batch(
        &mut host.store,
        &host.clipboard,
        &host.notifier,
        device_id,
        batch_id,
        &validated,
        Utc::now(),
    )
}

async fn receive_text<F: Frames>(
    shared: &SharedHost,
    session: &mut Session,
    frames: &mut F,
    device_id: &DeviceId,
    batch_id: &str,
    size: usize,
) -> Result<(), HostError> {
    let batch_id = BatchId::parse(batch_id)?;
    if size > MAX_TEXT_BYTES {
        return Err(HostError::TextTooLarge);
    }
    let bytes = session.recv_chunks(frames, size).await?;
    expect_end(session, frames).await?;
    let text = String::from_utf8(bytes).map_err(|_| HostError::InvalidText)?;
    let mut host = shared.lock()?;
    let host = &mut *host;
    ingest_text(
        &mut host.store,
        &host.clipboard,
        &host.notifier,
        device_id,
        batch_id,
        &text,
        Utc::now(),
    )
}

/// Short codes the phone maps back to its own error messages.
fn error_code(error: &HostError) -> &'static str {
    match error {
        HostError::UnknownPhone | HostError::NotTrusted | HostError::PairingRejected => {
            "not-trusted"
        }
        HostError::PairingExpired => "expired",
        HostError::Busy => "busy",
        HostError::ImageTooLarge | HostError::TextTooLarge => "too-large",
        HostError::ImageUndecodable
        | HostError::InvalidId
        | HostError::InvalidName
        | HostError::InvalidText => "invalid",
        _ => "internal",
    }
}

/// At most 10 pairing attempts a minute per address, so a stranger on the Wi-Fi cannot flood the user.
fn allow_pair_attempt(ip: IpAddr) -> bool {
    static ATTEMPTS: OnceLock<Mutex<HashMap<IpAddr, Vec<Instant>>>> = OnceLock::new();
    let mut map = ATTEMPTS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    let recent = map.entry(ip).or_default();
    recent.retain(|at| now.duration_since(*at) < Duration::from_secs(60));
    if recent.len() >= 10 {
        return false;
    }
    recent.push(now);
    true
}

impl SharedHost {
    pub fn lock(&self) -> Result<std::sync::MutexGuard<'_, HostInner>, HostError> {
        self.0
            .lock()
            .map_err(|error| HostError::Storage(error.to_string()))
    }
}

impl HostInner {
    /// The address the TLS listener serves. On mobile there is no listener, so
    /// the live LAN address is the only meaningful one.
    pub fn listener_ip(&self) -> Ipv4Addr {
        if cfg!(any(target_os = "android", target_os = "ios")) {
            lan_ipv4()
        } else {
            self.bind_ip
        }
    }

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
            v: 2,
            pc_id: self.pc_id.as_str().to_string(),
            name: settings.pc_display_name,
            host: self.listener_ip().to_string(),
            port: self.port,
            token: self.ticket.token.clone(),
            fingerprint: self.cert.fingerprint.clone(),
            pub_key: self.keys.public_b64(),
            relay: self.relay.clone(),
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

/// The phone's id follows its key, so an id from before keys existed is replaced once.
fn load_phone(dir: &std::path::Path, keys: &KeyPair) -> Result<PhoneIdentity, HostError> {
    let path = dir.join("phone-identity.json");
    let mut identity = if path.exists() {
        let text =
            std::fs::read_to_string(&path).map_err(|error| HostError::Storage(error.to_string()))?;
        serde_json::from_str(&text).map_err(|error| HostError::Storage(error.to_string()))?
    } else {
        PhoneIdentity {
            device_id: keys.device_id(),
            name: default_phone_name(),
        }
    };
    if identity.device_id != keys.device_id() {
        identity.device_id = keys.device_id();
    }
    write_json(&path, &identity)?;
    Ok(identity)
}

/// Real device model on first run; the user can still rename it in Settings.
fn default_phone_name() -> String {
    #[cfg(target_os = "android")]
    {
        let prop = |key: &str| {
            std::process::Command::new("getprop")
                .arg(key)
                .output()
                .ok()
                .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
                .filter(|value| !value.is_empty())
        };
        // shortcut: not the user-set device name (needs JNI), upgrade if the model reads too generic.
        if let Some(model) = prop("ro.product.model") {
            return match prop("ro.product.manufacturer") {
                Some(brand) if !model.to_lowercase().starts_with(&brand.to_lowercase()) => {
                    format!("{brand} {model}")
                }
                _ => model,
            };
        }
    }
    "Phone".to_string()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state", content = "message")]
pub enum RelayStatus {
    Off,
    Connecting,
    Connected,
    Error(String),
}

fn load_relay(dir: &std::path::Path) -> Option<RelayInfo> {
    let text = std::fs::read_to_string(dir.join("relay.json")).ok()?;
    let info: RelayInfo = serde_json::from_str(&text).ok()?;
    info.validate().ok()?;
    Some(info)
}

/// Desktop only: keeps this computer connected to its relay so phones outside the Wi-Fi can
/// reach it. Calling it again (after the setting changed) retires the previous task.
pub fn spawn_relay(shared: SharedHost, app: tauri::AppHandle) {
    let generation = {
        let Ok(mut host) = shared.lock() else {
            return;
        };
        host.relay_generation += 1;
        host.relay_generation
    };
    std::thread::spawn(move || {
        let Ok(runtime) = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
        else {
            return;
        };
        runtime.block_on(relay_loop(shared, app, generation));
    });
}

fn set_relay_status(shared: &SharedHost, app: &tauri::AppHandle, status: RelayStatus) {
    if let Ok(mut host) = shared.lock() {
        host.relay_status = status;
    }
    let _ = app.emit("relay-changed", ());
}

fn announced_session(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let id = value.get("session")?.as_str()?;
    // The id goes into a URL path: accept only what the relay makes.
    (id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())).then(|| id.to_string())
}

async fn relay_loop(shared: SharedHost, app: tauri::AppHandle, generation: u64) {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let current = |shared: &SharedHost| {
        let host = shared.lock().ok()?;
        if host.relay_generation != generation {
            return None;
        }
        Some((host.relay.clone()?, mailbox_for(&host.keys.public)))
    };
    let mut backoff = Duration::from_secs(1);
    loop {
        let Some((info, mailbox)) = current(&shared) else {
            return;
        };
        set_relay_status(&shared, &app, RelayStatus::Connecting);
        match open_relay(&info, &format!("/m/{mailbox}/desktop")).await {
            Ok(mut control) => {
                set_relay_status(&shared, &app, RelayStatus::Connected);
                backoff = Duration::from_secs(1);
                loop {
                    // Wake up now and then so a changed or removed setting closes this connection.
                    match tokio::time::timeout(Duration::from_secs(5), control.next_text()).await {
                        Err(_) if current(&shared).is_some() => continue,
                        Ok(Ok(Some(text))) => {
                            if let Some(id) = announced_session(&text) {
                                let (shared, info, path) =
                                    (shared.clone(), info.clone(), format!("/m/{mailbox}/s/{id}"));
                                tokio::spawn(async move {
                                    if let Ok(frames) = open_relay(&info, &path).await {
                                        // The relay hides the phone's address: one shared bucket.
                                        serve_frames(shared, frames, IpAddr::V4(Ipv4Addr::UNSPECIFIED))
                                            .await;
                                    }
                                });
                            }
                        }
                        _ => break,
                    }
                }
                if current(&shared).is_none() {
                    return;
                }
                set_relay_status(
                    &shared,
                    &app,
                    RelayStatus::Error("connection to the relay was lost".into()),
                );
            }
            Err(error) => {
                set_relay_status(&shared, &app, RelayStatus::Error(error.to_string()));
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(30));
    }
}

fn load_known_pcs(dir: &std::path::Path) -> Result<Vec<KnownPc>, HostError> {
    let path = dir.join("phone-book.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text =
        std::fs::read_to_string(path).map_err(|error| HostError::Storage(error.to_string()))?;
    let mut pcs: Vec<KnownPc> =
        serde_json::from_str(&text).map_err(|error| HostError::Storage(error.to_string()))?;
    // Entries from before the secure channel have no key, and an attempt cannot outlive the app.
    pcs.retain(|pc| pc.public_key.is_some());
    Ok(pcs)
}

fn write_json<T: serde::Serialize>(path: &std::path::Path, value: &T) -> Result<(), HostError> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| HostError::Storage(error.to_string()))?;
    std::fs::write(path, text).map_err(|error| HostError::Storage(error.to_string()))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::extract::ws::WebSocketUpgrade;
    use axum::routing::get;
    use axum::Router;

    use super::{allow_pair_attempt, AxumFrames};
    use crate::adapters::channel::handshake_responder;
    use crate::adapters::keys::KeyPair;
    use crate::adapters::phone_client::{remembered_qr, send_batch};
    use crate::domain::{BatchId, HostError, Msg, PcId};

    /// What a desktop does with one batch, without the app around it.
    async fn stub_receive<F: crate::adapters::channel::Frames>(
        mut frames: F,
        desktop: KeyPair,
        received: Arc<Mutex<Vec<Vec<u8>>>>,
    ) {
        let (established, _hello) = handshake_responder(&mut frames, &desktop).await.unwrap();
        let mut session = established.session;
        let Some(Msg::BeginImages { count, .. }) = session.recv(&mut frames).await.unwrap() else {
            panic!("expected a batch");
        };
        for _ in 0..count {
            let Some(Msg::Item { size }) = session.recv(&mut frames).await.unwrap() else {
                panic!("expected an image");
            };
            let bytes = session.recv_chunks(&mut frames, size as usize).await.unwrap();
            received.lock().unwrap().push(bytes);
        }
        assert_eq!(session.recv(&mut frames).await.unwrap(), Some(Msg::End));
        session.send(&mut frames, &Msg::Ack).await.unwrap();
    }

    /// A TLS server with a stand-in handler that speaks the real channel, to prove the pieces
    /// (pinned TLS, WebSocket, Noise, chunking) work together over a real socket.
    async fn serve_channel_stub(
        desktop: KeyPair,
        received: Arc<Mutex<Vec<Vec<u8>>>>,
    ) -> (u16, String) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let key = rcgen::KeyPair::generate().unwrap();
        let cert = rcgen::CertificateParams::new(vec!["localhost".to_string()])
            .unwrap()
            .self_signed(&key)
            .unwrap();
        let fingerprint = crate::adapters::fingerprint(cert.der());
        let config = axum_server::tls_rustls::RustlsConfig::from_der(
            vec![cert.der().to_vec()],
            key.serialize_der(),
        )
        .await
        .unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = Router::new().route(
            "/v2/channel",
            get(move |ws: WebSocketUpgrade| {
                let (desktop, received) = (desktop.clone(), received.clone());
                async move {
                    ws.on_upgrade(move |socket| stub_receive(AxumFrames(socket), desktop, received))
                }
            }),
        );
        tokio::spawn(async move {
            let _ = axum_server::from_tcp_rustls(listener, config)
                .serve(app.into_make_service())
                .await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        (port, fingerprint)
    }

    #[tokio::test]
    async fn a_batch_crosses_the_pinned_websocket_channel_and_a_wrong_pin_is_refused() {
        let desktop = KeyPair::generate().unwrap();
        let phone = KeyPair::generate().unwrap();
        let received = Arc::new(Mutex::new(Vec::new()));
        let (port, fingerprint) = serve_channel_stub(desktop.clone(), received.clone()).await;
        let pc = PcId::parse("pc-test-0001").unwrap();
        let big = vec![7u8; 150_000];
        let small = vec![9u8; 10];

        let dest = remembered_qr(&pc, "Test", "127.0.0.1", port, &fingerprint, &desktop.public_b64());
        send_batch(&dest, &phone, "Phone", &BatchId::generate(), &[big.clone(), small.clone()])
            .await
            .unwrap();
        assert_eq!(*received.lock().unwrap(), vec![big, small]);

        let wrong_pin = remembered_qr(&pc, "Test", "127.0.0.1", port, &"a".repeat(64), &desktop.public_b64());
        let error = send_batch(&wrong_pin, &phone, "Phone", &BatchId::generate(), &[vec![1]])
            .await
            .unwrap_err();
        assert_eq!(error, HostError::NotTrusted);
    }

    /// The real relay, a stand-in desktop that is only connected to it, and the real phone client
    /// whose Wi-Fi route is dead: the batch must arrive through the relay.
    #[tokio::test]
    async fn a_batch_reaches_a_computer_that_is_only_reachable_through_the_relay() {
        use crate::adapters::phone_client::open_relay;
        use crate::domain::{mailbox_for, RelayInfo};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let relay_port = listener.local_addr().unwrap().port();
        let relay = fast_share_relay::router(fast_share_relay::Config {
            token: Some("tok".into()),
            ..Default::default()
        })
        .into_make_service_with_connect_info::<std::net::SocketAddr>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, relay).await;
        });
        let info = RelayInfo {
            url: format!("ws://127.0.0.1:{relay_port}"),
            fingerprint: None,
            token: Some("tok".into()),
        };

        let desktop = KeyPair::generate().unwrap();
        let phone = KeyPair::generate().unwrap();
        let mailbox = mailbox_for(&desktop.public);
        let received = Arc::new(Mutex::new(Vec::new()));
        let mut control = open_relay(&info, &format!("/m/{mailbox}/desktop")).await.unwrap();
        {
            let (info, desktop, received, mailbox) =
                (info.clone(), desktop.clone(), received.clone(), mailbox.clone());
            tokio::spawn(async move {
                while let Ok(Some(text)) = control.next_text().await {
                    let id = super::announced_session(&text).expect("a session id");
                    let (info, desktop, received, mailbox) =
                        (info.clone(), desktop.clone(), received.clone(), mailbox.clone());
                    tokio::spawn(async move {
                        let frames = open_relay(&info, &format!("/m/{mailbox}/s/{id}")).await.unwrap();
                        stub_receive(frames, desktop, received).await;
                    });
                }
            });
        }

        // A Wi-Fi address nothing listens on: the phone has to fall back to the relay.
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let dead_port = closed.local_addr().unwrap().port();
        drop(closed);
        let pc = PcId::parse("pc-test-0001").unwrap();
        let mut dest = remembered_qr(&pc, "Test", "127.0.0.1", dead_port, &"a".repeat(64), &desktop.public_b64());
        dest.relay = Some(info.clone());

        let image = vec![5u8; 120_000];
        send_batch(&dest, &phone, "Phone", &BatchId::generate(), &[image.clone()])
            .await
            .unwrap();
        assert_eq!(*received.lock().unwrap(), vec![image]);

        // A wrong relay token is reported as such, not as "computer unreachable".
        let mut wrong_token = dest.clone();
        wrong_token.relay = Some(RelayInfo { token: Some("nope".into()), ..info.clone() });
        let error = send_batch(&wrong_token, &phone, "Phone", &BatchId::generate(), &[vec![1]])
            .await
            .unwrap_err();
        assert_eq!(error, HostError::RelayRefused);

        // A computer that is not connected to the relay is just unreachable (the relay answers 409).
        let stranger = KeyPair::generate().unwrap();
        let mut offline = dest.clone();
        offline.pub_key = stranger.public_b64();
        let error = send_batch(&offline, &phone, "Phone", &BatchId::generate(), &[vec![1]])
            .await
            .unwrap_err();
        assert!(matches!(error, HostError::NoServer { .. }), "{error:?}");
    }

    #[test]
    fn the_eleventh_attempt_in_a_minute_from_one_address_is_refused() {
        let ip: std::net::IpAddr = "10.99.0.7".parse().unwrap();
        assert!((0..10).all(|_| allow_pair_attempt(ip)));
        assert!(!allow_pair_attempt(ip));
        let other: std::net::IpAddr = "10.99.0.8".parse().unwrap();
        assert!(allow_pair_attempt(other));
    }
}
