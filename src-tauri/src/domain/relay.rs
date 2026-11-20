use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::error::HostError;

/// A relay a company hosts itself. It only moves ciphertext (see `docs/e2e.md`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayInfo {
    /// `wss://host:port`, or `ws://host:port` when the relay sits behind a proxy.
    pub url: String,
    /// SHA-256 of the relay's self-signed certificate. Absent when a real certificate is used.
    #[serde(default)]
    pub fingerprint: Option<String>,
    /// Keeps strangers from using the relay. Not a secret about the data.
    #[serde(default)]
    pub token: Option<String>,
}

const SCHEME: &str = "fastshare-relay://";

impl RelayInfo {
    /// Checks a value that came from a QR code, a message, or a file.
    pub fn validate(&self) -> Result<(), HostError> {
        let rest = self
            .url
            .strip_prefix("wss://")
            .or_else(|| self.url.strip_prefix("ws://"))
            .ok_or(HostError::InvalidRelay)?;
        let (host, port) = rest.rsplit_once(':').ok_or(HostError::InvalidRelay)?;
        let host_ok = !host.is_empty()
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
        if !host_ok || port.parse::<u16>().map_or(true, |p| p == 0) {
            return Err(HostError::InvalidRelay);
        }
        if let Some(fp) = &self.fingerprint {
            if fp.len() != 64 || !fp.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(HostError::InvalidRelay);
            }
        }
        if self.token.as_deref().is_some_and(|t| t.len() > 256 || t.chars().any(char::is_control)) {
            return Err(HostError::InvalidRelay);
        }
        Ok(())
    }

    /// Reads the string the relay prints at start: `fastshare-relay://HOST:PORT?fp=…&token=…[&plain=1]`.
    pub fn parse(text: &str) -> Result<Self, HostError> {
        let rest = text
            .trim()
            .strip_prefix(SCHEME)
            .ok_or(HostError::InvalidRelay)?;
        let (address, query) = rest.split_once('?').unwrap_or((rest, ""));
        let (mut fingerprint, mut token, mut plain) = (None, None, false);
        for pair in query.split('&').filter(|pair| !pair.is_empty()) {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            match key {
                "fp" => fingerprint = Some(value.to_ascii_lowercase()),
                "token" => token = Some(value.to_string()),
                "plain" => plain = value == "1",
                _ => {}
            }
        }
        let info = Self {
            url: format!("{}://{}", if plain { "ws" } else { "wss" }, address),
            fingerprint,
            token,
        };
        info.validate()?;
        Ok(info)
    }

    /// The same string `parse` reads.
    #[cfg(test)]
    pub fn to_relay_string(&self) -> String {
        let plain = self.url.starts_with("ws://");
        let address = self
            .url
            .trim_start_matches("wss://")
            .trim_start_matches("ws://");
        let mut query = Vec::new();
        if let Some(fp) = &self.fingerprint {
            query.push(format!("fp={fp}"));
        }
        if let Some(token) = &self.token {
            query.push(format!("token={token}"));
        }
        if plain {
            query.push("plain=1".to_string());
        }
        format!("{SCHEME}{address}?{}", query.join("&"))
    }
}

/// Where a desktop waits for phones on the relay. Derived from the public key, so it is not a secret.
pub fn mailbox_for(public_key: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"fast-share-mailbox");
    hasher.update(public_key);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_relay_string_round_trips() {
        let fp = "ab".repeat(32);
        let text = format!("fastshare-relay://203.0.113.9:8443?fp={fp}&token=s3cret");
        let info = RelayInfo::parse(&text).unwrap();
        assert_eq!(info.url, "wss://203.0.113.9:8443");
        assert_eq!(info.fingerprint.as_deref(), Some(fp.as_str()));
        assert_eq!(RelayInfo::parse(&info.to_relay_string()).unwrap(), info);

        let plain = RelayInfo::parse("fastshare-relay://relay.example.com:443?token=t&plain=1").unwrap();
        assert_eq!(plain.url, "ws://relay.example.com:443");
        assert_eq!(RelayInfo::parse(&plain.to_relay_string()).unwrap(), plain);
    }

    #[test]
    fn junk_is_not_a_relay() {
        for bad in [
            "",
            "https://relay.example.com",
            "fastshare-relay://",
            "fastshare-relay://host-without-port",
            "fastshare-relay://bad host:1?token=t",
            "fastshare-relay://host:0",
            "fastshare-relay://host:99999",
            "fastshare-relay://host:443?fp=zz",
        ] {
            assert_eq!(RelayInfo::parse(bad), Err(HostError::InvalidRelay), "{bad}");
        }
    }

    #[test]
    fn the_mailbox_is_stable_and_differs_per_key() {
        assert_eq!(mailbox_for(&[1; 32]), mailbox_for(&[1; 32]));
        assert_ne!(mailbox_for(&[1; 32]), mailbox_for(&[2; 32]));
        assert_eq!(mailbox_for(&[1; 32]).len(), 64);
    }
}
