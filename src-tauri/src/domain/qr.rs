use std::net::Ipv4Addr;

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::error::HostError;
use super::ids::PcId;
use super::relay::RelayInfo;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPayload {
    pub v: u8,
    pub pc_id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub token: String,
    /// TLS certificate pin: an extra layer, the channel does not rely on it.
    pub fingerprint: String,
    /// The desktop's X25519 public key (standard base64). This is what the phone trusts.
    pub pub_key: String,
    /// Where to reach the computer from outside the Wi-Fi, when it has a relay.
    #[serde(default)]
    pub relay: Option<RelayInfo>,
    pub expires_at: String,
}

pub fn parse_qr(text: &str) -> Result<QrPayload, HostError> {
    let payload: QrPayload = serde_json::from_str(text).map_err(|_| HostError::PairingExpired)?;
    if payload.v != 2 {
        return Err(HostError::PairingExpired);
    }
    PcId::parse(&payload.pc_id)?;
    super::settings::validate_name(&payload.name)?;
    require_lan_host(&payload.host)?;
    if let Some(relay) = &payload.relay {
        relay.validate()?;
    }
    if payload.port == 0 {
        return Err(HostError::Unreachable);
    }
    if payload.token.len() < 8 || payload.fingerprint.len() != 64 {
        return Err(HostError::PairingExpired);
    }
    if !payload.fingerprint.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(HostError::PairingExpired);
    }
    let key = base64::engine::general_purpose::STANDARD
        .decode(payload.pub_key.trim())
        .map_err(|_| HostError::PairingExpired)?;
    if key.len() != 32 {
        return Err(HostError::PairingExpired);
    }
    let expires = DateTime::parse_from_rfc3339(&payload.expires_at)
        .map_err(|_| HostError::PairingExpired)?
        .with_timezone(&Utc);
    if expires <= Utc::now() {
        return Err(HostError::PairingExpired);
    }
    Ok(QrPayload {
        fingerprint: payload.fingerprint.to_ascii_lowercase(),
        pub_key: payload.pub_key.trim().to_string(),
        ..payload
    })
}

pub fn require_lan_host(host: &str) -> Result<(), HostError> {
    let ip: Ipv4Addr = host.parse().map_err(|_| HostError::Unreachable)?;
    if is_lan(ip) {
        Ok(())
    } else {
        Err(HostError::Unreachable)
    }
}

#[cfg(test)]
mod tests {
    use super::parse_qr;
    use crate::domain::HostError;

    #[test]
    fn a_public_address_is_not_a_destination() {
        let payload = r#"{
            "v": 2,
            "pcId": "pc-office1",
            "name": "Office",
            "host": "8.8.8.8",
            "port": 47654,
            "token": "tokentoken",
            "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "pubKey": "YQ==",
            "expiresAt": "2099-01-01T00:00:00Z"
        }"#;
        assert_eq!(parse_qr(payload).unwrap_err(), HostError::Unreachable);
    }
}

fn is_lan(ip: Ipv4Addr) -> bool {
    if ip.is_loopback() {
        return true;
    }
    let [a, b, _, _] = ip.octets();
    a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}
