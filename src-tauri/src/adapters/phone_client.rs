use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as TlsError, SignatureScheme};
use serde::Deserialize;

use crate::domain::{parse_qr, require_lan_host, BatchId, DeviceId, HostError, PcId, QrPayload};

const READY_TIMEOUT: Duration = Duration::from_millis(1500);
const SHORT_TIMEOUT: Duration = Duration::from_secs(8);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug)]
pub struct PairReply {
    pub status: String,
    pub poll_token: Option<String>,
    pub secret: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairBody {
    status: String,
    poll_token: Option<String>,
    secret: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairCodeBody {
    status: String,
    poll_token: Option<String>,
    secret: Option<String>,
    pc_id: String,
    name: String,
    fingerprint: String,
    cert_der: String,
}

fn connection_error(host: &str) -> HostError {
    if let Ok(target_ip) = host.parse::<std::net::Ipv4Addr>() {
        let local_ip = crate::adapters::lan_ipv4();
        return match crate::adapters::classify_unreachable(local_ip, target_ip) {
            crate::adapters::ReachabilityReason::DifferentSubnet => HostError::DifferentSubnet,
            crate::adapters::ReachabilityReason::GuestOrFirewall => HostError::GuestWifiOrFirewall,
        };
    }
    HostError::Unreachable
}

pub async fn pair(
    qr_text: &str,
    device_id: &DeviceId,
    name: &str,
) -> Result<(QrPayload, PairReply), HostError> {
    let qr = parse_qr(qr_text)?;
    let client = pinned_client(&qr, SHORT_TIMEOUT)?;
    let response = client
        .post(format!("https://{}:{}/pair", qr.host, qr.port))
        .json(&serde_json::json!({
            "token": qr.token,
            "deviceId": device_id.as_str(),
            "name": name,
        }))
        .send()
        .await
        .map_err(|_| connection_error(&qr.host))?;
    let reply = read_pair(response).await?;
    Ok((qr, reply))
}

pub async fn pair_with_code_endpoint(
    host: &str,
    port: u16,
    expected_fingerprint: Option<&str>,
    code: &str,
    device_id: &DeviceId,
    name: &str,
) -> Result<(QrPayload, PairReply), HostError> {
    require_lan_host(host)?;
    if port == 0 {
        return Err(HostError::Unreachable);
    }
    let client = if let Some(fp) = expected_fingerprint.filter(|val| !val.is_empty()) {
        let qr = QrPayload {
            v: 1,
            pc_id: "pc-bootstrap".to_string(),
            name: "Computer".to_string(),
            host: host.to_string(),
            port,
            token: String::new(),
            fingerprint: fp.to_string(),
            cert_der: String::new(),
            expires_at: String::new(),
        };
        pinned_client(&qr, SHORT_TIMEOUT)?
    } else {
        bootstrap_client(SHORT_TIMEOUT)?
    };
    let response = client
        .post(format!("https://{host}:{port}/pair/code"))
        .json(&serde_json::json!({
            "code": code.trim(),
            "deviceId": device_id.as_str(),
            "name": name,
        }))
        .send()
        .await
        .map_err(|_| connection_error(host))?;
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 410 {
            HostError::PairingExpired
        } else {
            connection_error(host)
        });
    }
    let body: PairCodeBody = response.json().await.map_err(|_| HostError::Unreachable)?;
    let pc_id = PcId::parse(&body.pc_id)?;
    let der = base64::engine::general_purpose::STANDARD
        .decode(body.cert_der.trim())
        .map_err(|_| HostError::NotTrusted)?;
    let actual = crate::adapters::fingerprint(&der);
    if actual != body.fingerprint.to_ascii_lowercase() {
        return Err(HostError::NotTrusted);
    }
    if let Some(expected) = expected_fingerprint.filter(|val| !val.is_empty()) {
        if actual != expected.to_ascii_lowercase() {
            return Err(HostError::NotTrusted);
        }
    }
    let qr = remembered_qr(
        &pc_id,
        &body.name,
        host,
        port,
        &actual,
        body.cert_der.trim(),
    );
    let reply = PairReply {
        status: body.status,
        poll_token: body.poll_token,
        secret: body.secret,
    };
    Ok((qr, reply))
}

pub async fn pair_status(
    qr: &QrPayload,
    device_id: &DeviceId,
    poll_token: &str,
) -> Result<PairReply, HostError> {
    let client = pinned_client(qr, SHORT_TIMEOUT)?;
    let response = client
        .post(format!("https://{}:{}/pair/status", qr.host, qr.port))
        .json(&serde_json::json!({
            "deviceId": device_id.as_str(),
            "pollToken": poll_token,
        }))
        .send()
        .await
        .map_err(|_| connection_error(&qr.host))?;
    read_pair(response).await
}

pub async fn send_batch(
    qr: &QrPayload,
    device_id: &DeviceId,
    secret: &str,
    batch_id: &BatchId,
    images: &[Vec<u8>],
) -> Result<(), HostError> {
    if images.is_empty() {
        return Err(HostError::ImageUndecodable);
    }
    let encoded: Vec<String> = images
        .iter()
        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
        .collect();
    let client = pinned_client(qr, UPLOAD_TIMEOUT)?;
    let response = client
        .post(format!("https://{}:{}/batches", qr.host, qr.port))
        .json(&serde_json::json!({
            "deviceId": device_id.as_str(),
            "secret": secret,
            "batchId": batch_id.as_str(),
            "images": encoded,
        }))
        .send()
        .await
        .map_err(|_| connection_error(&qr.host))?;
    if response.status().is_success() {
        Ok(())
    } else if response.status().as_u16() == 403 {
        Err(HostError::NotTrusted)
    } else if response.status().as_u16() == 413 {
        Err(HostError::ImageTooLarge)
    } else if response.status().as_u16() == 400 {
        Err(HostError::ImageUndecodable)
    } else {
        Err(HostError::Unreachable)
    }
}

pub async fn ready(qr: &QrPayload) -> bool {
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
    cert_der: &str,
) -> QrPayload {
    QrPayload {
        v: 1,
        pc_id: pc_id.as_str().to_string(),
        name: name.to_string(),
        host: host.to_string(),
        port,
        token: String::new(),
        fingerprint: fingerprint.to_string(),
        cert_der: cert_der.to_string(),
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

fn pinned_client(qr: &QrPayload, timeout: Duration) -> Result<reqwest::Client, HostError> {
    require_lan_host(&qr.host)?;
    let expected = qr.fingerprint.to_ascii_lowercase();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(HostError::NotTrusted);
    }
    if !qr.cert_der.trim().is_empty() {
        let der = base64::engine::general_purpose::STANDARD
            .decode(qr.cert_der.trim())
            .map_err(|_| HostError::NotTrusted)?;
        if crate::adapters::fingerprint(&der) != expected {
            return Err(HostError::NotTrusted);
        }
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PinnedVerifier {
        fingerprint: expected,
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

async fn read_pair(response: reqwest::Response) -> Result<PairReply, HostError> {
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 410 {
            HostError::PairingExpired
        } else {
            HostError::Unreachable
        });
    }
    let body: PairBody = response.json().await.map_err(|_| HostError::Unreachable)?;
    Ok(PairReply {
        status: body.status,
        poll_token: body.poll_token,
        secret: body.secret,
    })
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use axum::routing::get;
    use axum::{Json, Router};
    use base64::Engine;

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
    async fn pinned_client_accepts_matching_leaf_and_rejects_mismatched_peer() {
        let (server_der, server_key, server_fp) = test_cert();
        let (other_der, _, other_fp) = test_cert();
        let port = serve_ready(server_der.clone(), server_key).await;
        let pc_id = PcId::parse("pc-office-1").unwrap();

        let matching = remembered_qr(
            &pc_id,
            "Office",
            "127.0.0.1",
            port,
            &server_fp,
            &base64::engine::general_purpose::STANDARD.encode(&server_der),
        );
        assert!(ready(&matching).await);

        let wrong_peer = remembered_qr(
            &pc_id,
            "Office",
            "127.0.0.1",
            port,
            &other_fp,
            &base64::engine::general_purpose::STANDARD.encode(&other_der),
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
            &base64::engine::general_purpose::STANDARD.encode(ca_cert.der()),
        );
        assert!(!ready(&ca_qr).await);
    }
}
