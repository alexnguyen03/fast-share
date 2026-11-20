use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as TlsError, SignatureScheme};
use serde::Deserialize;
use tokio_tungstenite::tungstenite::{Error as WsError, Message as WsMessage};
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

use crate::adapters::channel::{handshake_initiator, sas, Frames};
use crate::adapters::keys::{decode_public_key, KeyPair};
use crate::domain::{
    mailbox_for, require_lan_host, BatchId, Hello, HostError, Msg, PcId, QrPayload, RelayInfo,
    MAX_IMAGE_BYTES,
};

const READY_TIMEOUT: Duration = Duration::from_millis(1500);
/// How long the Wi-Fi gets before a phone that knows a relay tries that instead.
const LAN_BEFORE_RELAY: Duration = Duration::from_millis(2500);
const SHORT_TIMEOUT: Duration = Duration::from_secs(8);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);
/// How long the user has to confirm on the computer (the computer drops the request after 2 minutes).
pub const PAIRING_TIMEOUT: Duration = Duration::from_secs(130);

/// What a computer says about itself before the phone trusts it. Not authenticated:
/// the pairing code the user compares is what makes it safe.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcIdentity {
    pub pc_id: String,
    pub name: String,
    pub pub_key: String,
    pub fingerprint: String,
}

fn connection_error(host: &str, port: u16, error: &reqwest::Error) -> HostError {
    let Ok(target_ip) = host.parse::<std::net::Ipv4Addr>() else {
        return HostError::Unreachable;
    };
    classify_connect_failure(
        crate::adapters::lan_ipv4(),
        target_ip,
        port,
        error.is_timeout() || io_error_kind(error) == Some(std::io::ErrorKind::TimedOut),
    )
}

fn io_error_kind(error: &reqwest::Error) -> Option<std::io::ErrorKind> {
    use std::error::Error;

    let mut source: Option<&(dyn Error + 'static)> = error.source();
    while let Some(cause) = source {
        if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            return Some(io.kind());
        }
        source = cause.source();
    }
    None
}

/// A timeout means packets are dropped on the path (firewall / AP isolation).
/// A fast refusal or reset means nothing is listening on that endpoint: the
/// desktop app is closed, shows a different port, or is bound to another
/// interface, so blaming the firewall would be misleading.
fn classify_connect_failure(
    local_ip: std::net::Ipv4Addr,
    target_ip: std::net::Ipv4Addr,
    port: u16,
    timed_out: bool,
) -> HostError {
    if timed_out {
        return crate::adapters::reachability_error(local_ip, target_ip);
    }
    HostError::NoServer {
        host: target_ip.to_string(),
        port,
    }
}

fn ws_connect_error(host: &str, port: u16, error: &WsError) -> HostError {
    if error.to_string().contains("fingerprint mismatch") {
        return HostError::NotTrusted;
    }
    let Ok(target_ip) = host.parse::<std::net::Ipv4Addr>() else {
        return HostError::Unreachable;
    };
    let timed_out = matches!(error, WsError::Io(io) if io.kind() == std::io::ErrorKind::TimedOut);
    classify_connect_failure(crate::adapters::lan_ipv4(), target_ip, port, timed_out)
}

fn code_error(code: &str) -> HostError {
    match code {
        "not-trusted" => HostError::NotTrusted,
        "expired" => HostError::PairingExpired,
        "busy" => HostError::Busy,
        "too-large" => HostError::ImageTooLarge,
        "invalid" => HostError::ImageUndecodable,
        _ => HostError::Unreachable,
    }
}

pub(crate) struct WsFrames(WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>);

impl WsFrames {
    /// The next text frame. Only the relay's control socket uses text; binary frames are skipped.
    pub(crate) async fn next_text(&mut self) -> Result<Option<String>, HostError> {
        loop {
            match self.0.next().await {
                None | Some(Ok(WsMessage::Close(_))) => return Ok(None),
                Some(Ok(WsMessage::Text(text))) => return Ok(Some(text.to_string())),
                Some(Ok(_)) => continue,
                Some(Err(error)) => return Err(HostError::Channel(error.to_string())),
            }
        }
    }
}

impl Frames for WsFrames {
    async fn send(&mut self, bytes: Vec<u8>) -> Result<(), HostError> {
        self.0
            .send(WsMessage::Binary(bytes.into()))
            .await
            .map_err(|error| HostError::Channel(error.to_string()))
    }

    async fn recv(&mut self) -> Result<Option<Vec<u8>>, HostError> {
        loop {
            match self.0.next().await {
                None | Some(Ok(WsMessage::Close(_))) => return Ok(None),
                Some(Ok(WsMessage::Binary(bytes))) => return Ok(Some(bytes.to_vec())),
                Some(Ok(WsMessage::Text(_))) => {
                    return Err(HostError::Channel("unexpected text frame".into()))
                }
                Some(Ok(_)) => continue,
                Some(Err(error)) => return Err(HostError::Channel(error.to_string())),
            }
        }
    }
}

/// Opens the WebSocket to the computer. The TLS certificate pin is an extra layer; what the
/// phone trusts is the computer's public key, checked by the handshake that follows.
async fn open_lan(dest: &QrPayload, timeout: Duration) -> Result<WsFrames, HostError> {
    require_lan_host(&dest.host)?;
    let config = pinned_tls_config(&dest.fingerprint)?;
    let url = format!("wss://{}:{}/v2/channel", dest.host, dest.port);
    let connect = tokio_tungstenite::connect_async_tls_with_config(
        url,
        None,
        true,
        Some(Connector::Rustls(Arc::new(config))),
    );
    match tokio::time::timeout(timeout, connect).await {
        Ok(Ok((stream, _))) => Ok(WsFrames(stream)),
        Ok(Err(error)) => Err(ws_connect_error(&dest.host, dest.port, &error)),
        Err(_) => Err(classify_connect_failure(
            crate::adapters::lan_ipv4(),
            dest.host.parse().map_err(|_| HostError::Unreachable)?,
            dest.port,
            true,
        )),
    }
}

/// A failure that means "not reachable on this Wi-Fi", the cases where the relay may still work.
fn is_lan_miss(error: &HostError) -> bool {
    matches!(
        error,
        HostError::Unreachable
            | HostError::NoServer { .. }
            | HostError::DifferentSubnet { .. }
            | HostError::GuestWifiOrFirewall
    )
}

/// Opens the channel to the computer: on the Wi-Fi when it answers, through its relay otherwise.
async fn open(dest: &QrPayload) -> Result<WsFrames, HostError> {
    let Some(relay) = &dest.relay else {
        return open_lan(dest, SHORT_TIMEOUT).await;
    };
    // Off the home Wi-Fi there is no point waiting for a LAN address that cannot answer.
    let lan = if crate::adapters::lan_ipv4().is_loopback() {
        Err(HostError::Unreachable)
    } else {
        open_lan(dest, LAN_BEFORE_RELAY).await
    };
    match lan {
        Ok(frames) => return Ok(frames),
        Err(error) if is_lan_miss(&error) => {}
        Err(error) => return Err(error),
    }
    // The relay was the last resort, so its answer is the one worth showing.
    let mailbox = mailbox_for(&decode_public_key(&dest.pub_key)?);
    open_relay(relay, &format!("/m/{mailbox}/connect")).await
}

/// Checks the whole path from this computer: relay, token, certificate pin, the computer's own
/// connection to the relay, and the handshake. The probe uses a throwaway key, so the computer
/// refuses it at once ("not trusted"), and that refusal arriving is the proof. Returns milliseconds.
pub async fn test_relay(info: &RelayInfo, own_public_key: &[u8]) -> Result<u128, HostError> {
    let started = std::time::Instant::now();
    let mailbox = mailbox_for(own_public_key);
    let probe = async {
        let mut frames = open_relay(info, &format!("/m/{mailbox}/connect")).await?;
        let throwaway = KeyPair::generate()?;
        let mut established = handshake_initiator(
            &mut frames,
            &throwaway,
            own_public_key,
            &hello("relay-test", None, false),
        )
        .await
        .map_err(|_| HostError::RelayNoAnswer)?;
        match established.session.recv(&mut frames).await {
            Ok(Some(Msg::Error { code })) if code == "not-trusted" => Ok(()),
            _ => Err(HostError::RelayNoAnswer),
        }
    };
    tokio::time::timeout(Duration::from_secs(12), probe)
        .await
        .unwrap_or(Err(HostError::RelayNoAnswer))?;
    Ok(started.elapsed().as_millis())
}

/// Asks the relay whether the computer is connected to it. Plain HTTPS, so no session is started.
async fn relay_online(relay: &RelayInfo, mailbox: &str) -> bool {
    let url = format!(
        "{}/m/{mailbox}/status",
        relay.url.replacen("wss://", "https://", 1).replacen("ws://", "http://", 1)
    );
    let mut builder = reqwest::Client::builder().timeout(READY_TIMEOUT * 2);
    if let (Some(fingerprint), true) = (&relay.fingerprint, relay.url.starts_with("wss://")) {
        let Ok(config) = pinned_tls_config(fingerprint) else {
            return false;
        };
        builder = builder.use_preconfigured_tls(config);
    }
    let Ok(client) = builder.build() else {
        return false;
    };
    let mut request = client.get(url);
    if let Some(token) = &relay.token {
        request = request.bearer_auth(token);
    }
    request
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

/// Opens a WebSocket on the relay. `path` is one of the relay's `/m/…` routes.
pub(crate) async fn open_relay(info: &RelayInfo, path: &str) -> Result<WsFrames, HostError> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    info.validate()?;
    let mut request = format!("{}{}", info.url, path)
        .into_client_request()
        .map_err(|_| HostError::InvalidRelay)?;
    if let Some(token) = &info.token {
        request.headers_mut().insert(
            "authorization",
            format!("Bearer {token}")
                .parse()
                .map_err(|_| HostError::InvalidRelay)?,
        );
    }
    // A self-signed relay is pinned by fingerprint; with a real certificate the default roots apply.
    let connector = match &info.fingerprint {
        Some(fingerprint) if info.url.starts_with("wss://") => {
            Some(Connector::Rustls(Arc::new(pinned_tls_config(fingerprint)?)))
        }
        _ => None,
    };
    let connect = tokio_tungstenite::connect_async_tls_with_config(request, None, true, connector);
    match tokio::time::timeout(SHORT_TIMEOUT, connect).await {
        Ok(Ok((stream, _))) => Ok(WsFrames(stream)),
        Ok(Err(WsError::Http(response))) => Err(match response.status().as_u16() {
            401 => HostError::RelayRefused,
            429 => HostError::Busy,
            // The relay is fine but the computer is not connected to it.
            409 => HostError::RelayComputerOffline,
            _ => HostError::RelayUnreachable,
        }),
        Ok(Err(error)) if error.to_string().contains("fingerprint mismatch") => {
            Err(HostError::RelayPinMismatch)
        }
        _ => Err(HostError::RelayUnreachable),
    }
}

fn hello(name: &str, pairing_token: Option<String>, pair: bool) -> Hello {
    Hello {
        pairing_token,
        pair,
        name: name.to_string(),
    }
}

/// Asks the computer to trust this phone. Calls `on_code` with the six digits as soon as the
/// handshake is done, then waits until the user on the computer answers.
/// On acceptance the computer may also announce its relay.
#[derive(Debug, PartialEq, Eq)]
pub struct PairOutcome {
    pub accepted: bool,
    pub relay: Option<RelayInfo>,
}

pub async fn pair(
    dest: &QrPayload,
    keys: &KeyPair,
    name: &str,
    pairing_token: Option<String>,
    on_code: impl FnOnce(String),
) -> Result<PairOutcome, HostError> {
    let expected = decode_public_key(&dest.pub_key)?;
    let mut frames = open(dest).await?;
    let mut established = handshake_initiator(
        &mut frames,
        keys,
        &expected,
        &hello(name, pairing_token.clone(), true),
    )
    .await?;
    if pairing_token.is_none() {
        on_code(sas(&established.hash));
    }
    let wait = async {
        loop {
            match established.session.recv(&mut frames).await? {
                Some(Msg::Paired) => {
                    // The relay, when there is one, follows right behind.
                    let relay = match tokio::time::timeout(
                        Duration::from_secs(2),
                        established.session.recv(&mut frames),
                    )
                    .await
                    {
                        Ok(Ok(Some(Msg::Relay(info)))) if info.validate().is_ok() => Some(info),
                        _ => None,
                    };
                    return Ok(PairOutcome { accepted: true, relay });
                }
                Some(Msg::Rejected) | None => {
                    return Ok(PairOutcome { accepted: false, relay: None })
                }
                Some(Msg::Error { code }) => return Err(code_error(&code)),
                Some(_) => continue,
            }
        }
    };
    tokio::time::timeout(PAIRING_TIMEOUT, wait)
        .await
        .unwrap_or(Ok(PairOutcome { accepted: false, relay: None }))
}

async fn session_for(
    dest: &QrPayload,
    keys: &KeyPair,
    name: &str,
) -> Result<(WsFrames, crate::adapters::channel::Session), HostError> {
    let expected = decode_public_key(&dest.pub_key)?;
    let mut frames = open(dest).await?;
    let established =
        handshake_initiator(&mut frames, keys, &expected, &hello(name, None, false)).await?;
    Ok((frames, established.session))
}

async fn expect_ack(
    frames: &mut WsFrames,
    session: &mut crate::adapters::channel::Session,
) -> Result<(), HostError> {
    match session.recv(frames).await? {
        Some(Msg::Ack) => Ok(()),
        Some(Msg::Error { code }) => Err(code_error(&code)),
        _ => Err(HostError::Unreachable),
    }
}

pub async fn send_batch(
    dest: &QrPayload,
    keys: &KeyPair,
    name: &str,
    batch_id: &BatchId,
    images: &[Vec<u8>],
) -> Result<(), HostError> {
    if images.is_empty() {
        return Err(HostError::ImageUndecodable);
    }
    if images.iter().any(|image| image.len() > MAX_IMAGE_BYTES) {
        return Err(HostError::ImageTooLarge);
    }
    let run = async {
        let (mut frames, mut session) = session_for(dest, keys, name).await?;
        session
            .send(
                &mut frames,
                &Msg::BeginImages {
                    batch_id: batch_id.as_str().to_string(),
                    count: images.len() as u32,
                },
            )
            .await?;
        for image in images {
            session
                .send(&mut frames, &Msg::Item { size: image.len() as u32 })
                .await?;
            session.send_chunks(&mut frames, image).await?;
        }
        session.send(&mut frames, &Msg::End).await?;
        expect_ack(&mut frames, &mut session).await
    };
    tokio::time::timeout(UPLOAD_TIMEOUT, run)
        .await
        .unwrap_or(Err(HostError::Unreachable))
}

pub async fn send_text(
    dest: &QrPayload,
    keys: &KeyPair,
    name: &str,
    batch_id: &BatchId,
    text: &str,
) -> Result<(), HostError> {
    let run = async {
        let (mut frames, mut session) = session_for(dest, keys, name).await?;
        session
            .send(
                &mut frames,
                &Msg::BeginText {
                    batch_id: batch_id.as_str().to_string(),
                    size: text.len() as u32,
                },
            )
            .await?;
        session.send_chunks(&mut frames, text.as_bytes()).await?;
        session.send(&mut frames, &Msg::End).await?;
        expect_ack(&mut frames, &mut session)
            .await
            .map_err(|error| match error {
                HostError::ImageTooLarge => HostError::TextTooLarge,
                HostError::ImageUndecodable => HostError::InvalidText,
                other => other,
            })
    };
    tokio::time::timeout(UPLOAD_TIMEOUT, run)
        .await
        .unwrap_or(Err(HostError::Unreachable))
}

/// Asks a computer at a typed address who it is. Only a starting point: the key it returns is
/// not authenticated until the user compares the pairing code.
pub async fn fetch_identity(host: &str, port: u16) -> Result<PcIdentity, HostError> {
    require_lan_host(host)?;
    if port == 0 {
        return Err(HostError::Unreachable);
    }
    let response = bootstrap_client(SHORT_TIMEOUT)?
        .get(format!("https://{host}:{port}/v2/identity"))
        .send()
        .await
        .map_err(|error| connection_error(host, port, &error))?;
    if !response.status().is_success() {
        return Err(HostError::Unreachable);
    }
    response.json().await.map_err(|_| HostError::Unreachable)
}

pub async fn ready(qr: &QrPayload) -> bool {
    if lan_ready(qr).await {
        return true;
    }
    let Some(relay) = &qr.relay else {
        return false;
    };
    let Ok(key) = decode_public_key(&qr.pub_key) else {
        return false;
    };
    relay_online(relay, &mailbox_for(&key)).await
}

async fn lan_ready(qr: &QrPayload) -> bool {
    let Ok(client) = pinned_client(qr, READY_TIMEOUT) else {
        return false;
    };
    client
        .get(format!("https://{}:{}/ready", qr.host, qr.port))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

pub fn remembered_qr(
    pc_id: &PcId,
    name: &str,
    host: &str,
    port: u16,
    fingerprint: &str,
    pub_key: &str,
) -> QrPayload {
    QrPayload {
        v: 2,
        pc_id: pc_id.as_str().to_string(),
        name: name.to_string(),
        host: host.to_string(),
        port,
        token: String::new(),
        fingerprint: fingerprint.to_string(),
        pub_key: pub_key.to_string(),
        relay: None,
        expires_at: String::new(),
    }
}

#[derive(Debug)]
struct PinnedVerifier {
    fingerprint: String,
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        let actual = crate::adapters::fingerprint(end_entity.as_ref());
        if actual == self.fingerprint {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(TlsError::General(
                "peer certificate fingerprint mismatch".into(),
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[derive(Debug)]
struct BootstrapVerifier {
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl ServerCertVerifier for BootstrapVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn bootstrap_client(timeout: Duration) -> Result<reqwest::Client, HostError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(BootstrapVerifier {
        provider: provider.clone(),
    });
    let tls_config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|_| HostError::Unreachable)?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    reqwest::Client::builder()
        .use_preconfigured_tls(tls_config)
        .timeout(timeout)
        .build()
        .map_err(|_| HostError::Unreachable)
}

#[cfg(test)]
pub fn verify_peer_leaf(expected_fingerprint: &str, peer_leaf_der: &[u8]) -> Result<(), HostError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = PinnedVerifier {
        fingerprint: expected_fingerprint.to_ascii_lowercase(),
        provider,
    };
    let cert = CertificateDer::from(peer_leaf_der);
    let server_name = ServerName::try_from("localhost").map_err(|_| HostError::NotTrusted)?;
    verifier
        .verify_server_cert(&cert, &[], &server_name, &[], UnixTime::now())
        .map(|_| ())
        .map_err(|_| HostError::NotTrusted)
}

fn pinned_tls_config(fingerprint: &str) -> Result<rustls::ClientConfig, HostError> {
    let expected = fingerprint.to_ascii_lowercase();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(HostError::NotTrusted);
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PinnedVerifier {
        fingerprint: expected,
        provider: provider.clone(),
    });
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|_| HostError::Unreachable)?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth())
}

fn pinned_client(qr: &QrPayload, timeout: Duration) -> Result<reqwest::Client, HostError> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    static CLIENT_POOL: OnceLock<Mutex<HashMap<(String, u64), reqwest::Client>>> = OnceLock::new();

    require_lan_host(&qr.host)?;
    let tls_config = pinned_tls_config(&qr.fingerprint)?;
    let pool_key = (qr.fingerprint.to_ascii_lowercase(), timeout.as_millis() as u64);
    let pool = CLIENT_POOL.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = pool.lock() {
        if let Some(cached) = guard.get(&pool_key) {
            return Ok(cached.clone());
        }
    }
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(tls_config)
        .tcp_nodelay(true)
        .pool_idle_timeout(Duration::from_secs(90))
        .timeout(timeout)
        .build()
        .map_err(|_| HostError::Unreachable)?;
    if let Ok(mut guard) = pool.lock() {
        guard.insert(pool_key, client.clone());
    }
    Ok(client)
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use axum::routing::get;
    use axum::{Json, Router};

    use super::{ready, remembered_qr};
    use crate::adapters::fingerprint;
    use crate::domain::PcId;

    fn test_cert() -> (Vec<u8>, Vec<u8>, String) {
        let key = rcgen::KeyPair::generate().unwrap();
        let params = rcgen::CertificateParams::new(vec!["localhost".to_string()]).unwrap();
        let cert = params.self_signed(&key).unwrap();
        let der = cert.der().to_vec();
        let fp = fingerprint(&der);
        (der, key.serialize_der(), fp)
    }

    async fn serve_ready(cert_der: Vec<u8>, key_der: Vec<u8>) -> u16 {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let config = axum_server::tls_rustls::RustlsConfig::from_der(vec![cert_der], key_der)
            .await
            .unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let app = Router::new().route(
            "/ready",
            get(|| async { Json(serde_json::json!({ "ok": true })) }),
        );
        tokio::spawn(async move {
            let addr = SocketAddr::from(([127, 0, 0, 1], port));
            let _ = axum_server::bind_rustls(addr, config)
                .serve(app.into_make_service())
                .await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        port
    }

    #[tokio::test]
    async fn pinned_client_accepts_matching_leaf_and_rejects_mismatched_peer() {        let (server_der, server_key, server_fp) = test_cert();
        let (other_der, _, other_fp) = test_cert();
        let port = serve_ready(server_der.clone(), server_key).await;
        let pc_id = PcId::parse("pc-office-1").unwrap();

        let matching = remembered_qr(
            &pc_id,
            "Office",
            "127.0.0.1",
            port,
            &server_fp,
            "",
        );
        assert!(ready(&matching).await);

        let wrong_peer = remembered_qr(
            &pc_id,
            "Office",
            "127.0.0.1",
            port,
            &other_fp,
            "",
        );
        assert!(!ready(&wrong_peer).await);
        assert!(super::verify_peer_leaf(&server_fp, &server_der).is_ok());
        assert_eq!(
            super::verify_peer_leaf(&server_fp, &other_der).unwrap_err(),
            crate::domain::HostError::NotTrusted
        );

        let ca_key = rcgen::KeyPair::generate().unwrap();
        let mut ca_params = rcgen::CertificateParams::new(vec!["Fake Root".to_string()]).unwrap();
        ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let ca_cert = ca_params.self_signed(&ca_key).unwrap();
        let leaf_key = rcgen::KeyPair::generate().unwrap();
        let leaf_params = rcgen::CertificateParams::new(vec!["localhost".to_string()]).unwrap();
        let leaf_cert = leaf_params.signed_by(&leaf_key, &ca_cert, &ca_key).unwrap();
        let ca_port = serve_ready(leaf_cert.der().to_vec(), leaf_key.serialize_der()).await;
        let ca_qr = remembered_qr(
            &pc_id,
            "Office",
            "127.0.0.1",
            ca_port,
            &fingerprint(ca_cert.der()),
            "",
        );
        assert!(!ready(&ca_qr).await);
    }
}

#[cfg(test)]
mod connect_failure_tests {
    use std::net::Ipv4Addr;

    use super::classify_connect_failure;
    use crate::domain::HostError;

    #[test]
    fn refusal_points_at_the_endpoint_instead_of_the_firewall() {
        assert_eq!(
            classify_connect_failure(
                Ipv4Addr::new(192, 168, 1, 27),
                Ipv4Addr::new(192, 168, 1, 27),
                47654,
                false
            ),
            HostError::NoServer {
                host: "192.168.1.27".to_string(),
                port: 47654,
            }
        );
    }

    #[test]
    fn timeout_still_names_firewall_or_ap_isolation_on_the_same_subnet() {
        assert_eq!(
            classify_connect_failure(
                Ipv4Addr::new(192, 168, 1, 27),
                Ipv4Addr::new(192, 168, 1, 10),
                47654,
                true
            ),
            HostError::GuestWifiOrFirewall
        );
        assert_eq!(
            classify_connect_failure(
                Ipv4Addr::new(192, 168, 1, 27),
                Ipv4Addr::new(10, 10, 10, 2),
                47654,
                true
            ),
            HostError::DifferentSubnet {
                local: "192.168.1.27".to_string(),
                remote: "10.10.10.2".to_string(),
            }
        );
    }
}
