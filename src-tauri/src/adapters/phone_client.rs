use std::time::Duration;

use base64::Engine;
use serde::Deserialize;

use crate::domain::{parse_qr, require_lan_host, BatchId, DeviceId, HostError, PcId, QrPayload};

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

pub async fn pair(qr_text: &str, device_id: &DeviceId, name: &str) -> Result<(QrPayload, PairReply), HostError> {
    let qr = parse_qr(qr_text)?;
    let client = pinned_client(&qr)?;
    let response = client
        .post(format!("https://{}:{}/pair", qr.host, qr.port))
        .json(&serde_json::json!({
            "token": qr.token,
            "deviceId": device_id.as_str(),
            "name": name,
        }))
        .send()
        .await
        .map_err(|_| HostError::Unreachable)?;
    let reply = read_pair(response).await?;
    Ok((qr, reply))
}

pub async fn pair_status(
    qr: &QrPayload,
    device_id: &DeviceId,
    poll_token: &str,
) -> Result<PairReply, HostError> {
    let client = pinned_client(qr)?;
    let response = client
        .post(format!("https://{}:{}/pair/status", qr.host, qr.port))
        .json(&serde_json::json!({
            "deviceId": device_id.as_str(),
            "pollToken": poll_token,
        }))
        .send()
        .await
        .map_err(|_| HostError::Unreachable)?;
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
    let client = pinned_client(qr)?;
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
        .map_err(|_| HostError::Unreachable)?;
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
    let Ok(client) = pinned_client(qr) else {
        return false;
    };
    client
        .get(format!("https://{}:{}/ready", qr.host, qr.port))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

pub fn remembered_qr(pc_id: &PcId, name: &str, host: &str, port: u16, fingerprint: &str, cert_der: &str) -> QrPayload {
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

fn pinned_client(qr: &QrPayload) -> Result<reqwest::Client, HostError> {
    require_lan_host(&qr.host)?;
    let der = base64::engine::general_purpose::STANDARD
        .decode(qr.cert_der.trim())
        .map_err(|_| HostError::NotTrusted)?;
    let actual = crate::adapters::fingerprint(&der);
    if actual != qr.fingerprint.to_ascii_lowercase() {
        return Err(HostError::NotTrusted);
    }
    let cert = reqwest::Certificate::from_der(&der).map_err(|_| HostError::NotTrusted)?;
    reqwest::Client::builder()
        .add_root_certificate(cert)
        .danger_accept_invalid_hostnames(true)
        .timeout(Duration::from_secs(8))
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
    let body: PairBody = response
        .json()
        .await
        .map_err(|_| HostError::Unreachable)?;
    Ok(PairReply {
        status: body.status,
        poll_token: body.poll_token,
        secret: body.secret,
    })
}
