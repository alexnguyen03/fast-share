use std::fs;
use std::path::Path;

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::domain::{DeviceId, HostError};

use super::write_private_bytes;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// A device's long-term X25519 identity.
#[derive(Clone)]
pub struct KeyPair {
    pub private: Vec<u8>,
    pub public: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct KeyFile {
    private: String,
    public: String,
}

impl KeyPair {
    pub fn generate() -> Result<Self, HostError> {
        let params = crate::adapters::channel::NOISE_PARAMS
            .parse()
            .map_err(|_| HostError::Storage("bad noise params".into()))?;
        let pair = snow::Builder::new(params)
            .generate_keypair()
            .map_err(|error| HostError::Storage(error.to_string()))?;
        Ok(Self {
            private: pair.private,
            public: pair.public,
        })
    }

    pub fn public_b64(&self) -> String {
        B64.encode(&self.public)
    }

    pub fn device_id(&self) -> DeviceId {
        DeviceId::from_public_key(&self.public)
    }
}

/// The key file sits in the app data directory with owner-only permissions where the OS has them.
/// shortcut: not wrapped by Android Keystore / iOS Keychain yet, upgrade before a public release.
pub fn load_or_create_keys(dir: &Path) -> Result<KeyPair, HostError> {
    let path = dir.join("keys.json");
    if path.exists() {
        let text = fs::read_to_string(&path).map_err(|error| HostError::Storage(error.to_string()))?;
        let file: KeyFile =
            serde_json::from_str(&text).map_err(|error| HostError::Storage(error.to_string()))?;
        let private = B64
            .decode(file.private)
            .map_err(|error| HostError::Storage(error.to_string()))?;
        let public = B64
            .decode(file.public)
            .map_err(|error| HostError::Storage(error.to_string()))?;
        if private.len() != 32 || public.len() != 32 {
            return Err(HostError::Storage("keys.json is malformed".into()));
        }
        return Ok(KeyPair { private, public });
    }
    let pair = KeyPair::generate()?;
    let text = serde_json::to_string(&KeyFile {
        private: B64.encode(&pair.private),
        public: B64.encode(&pair.public),
    })
    .map_err(|error| HostError::Storage(error.to_string()))?;
    write_private_bytes(&path, text.as_bytes())?;
    Ok(pair)
}

pub fn decode_public_key(text: &str) -> Result<Vec<u8>, HostError> {
    let bytes = B64.decode(text.trim()).map_err(|_| HostError::NotTrusted)?;
    if bytes.len() != 32 {
        return Err(HostError::NotTrusted);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_persist_and_the_id_follows_the_key() {
        let dir = std::env::temp_dir().join(format!("fs-keys-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let first = load_or_create_keys(&dir).unwrap();
        let again = load_or_create_keys(&dir).unwrap();
        assert_eq!(first.public, again.public);
        assert_eq!(first.device_id(), again.device_id());
        assert_ne!(first.public, KeyPair::generate().unwrap().public);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_public_key_must_be_32_bytes() {
        assert!(decode_public_key("AAAA").is_err());
        assert!(decode_public_key(&B64.encode([7u8; 32])).is_ok());
    }
}
