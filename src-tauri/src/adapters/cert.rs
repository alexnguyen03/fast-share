use std::fs;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::domain::HostError;

pub struct HostCert {
    pub cert_der: Vec<u8>,
    pub key_der: Vec<u8>,
    pub fingerprint: String,
}

pub fn fingerprint(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}

pub fn load_or_create(dir: &Path) -> Result<HostCert, HostError> {
    let cert_path = dir.join("host-cert.der");
    let key_path = dir.join("host-key.der");
    if cert_path.exists() && key_path.exists() {
        let cert_der = fs::read(&cert_path).map_err(|error| HostError::Storage(error.to_string()))?;
        let key_der = fs::read(&key_path).map_err(|error| HostError::Storage(error.to_string()))?;
        return Ok(HostCert {
            fingerprint: fingerprint(&cert_der),
            cert_der,
            key_der,
        });
    }

    let key_pair = rcgen::KeyPair::generate().map_err(|error| HostError::Storage(error.to_string()))?;
    let mut params = rcgen::CertificateParams::new(vec!["localhost".to_string()])
        .map_err(|error| HostError::Storage(error.to_string()))?;
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "Fast Share");
    let cert = params
        .self_signed(&key_pair)
        .map_err(|error| HostError::Storage(error.to_string()))?;
    let cert_der = cert.der().to_vec();
    let key_der = key_pair.serialize_der();
    fs::write(&cert_path, &cert_der).map_err(|error| HostError::Storage(error.to_string()))?;
    fs::write(&key_path, &key_der).map_err(|error| HostError::Storage(error.to_string()))?;
    Ok(HostCert {
        fingerprint: fingerprint(&cert_der),
        cert_der,
        key_der,
    })
}
