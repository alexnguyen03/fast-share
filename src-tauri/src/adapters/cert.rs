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

pub fn write_private_bytes(path: &Path, bytes: &[u8]) -> Result<(), HostError> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| HostError::Storage(error.to_string()))?;
        file.write_all(bytes)
            .map_err(|error| HostError::Storage(error.to_string()))?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| HostError::Storage(error.to_string()))?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes).map_err(|error| HostError::Storage(error.to_string()))
    }
}

pub fn load_or_create(dir: &Path) -> Result<HostCert, HostError> {
    let cert_path = dir.join("host-cert.der");
    let key_path = dir.join("host-key.der");
    if cert_path.exists() && key_path.exists() {
        let cert_der =
            fs::read(&cert_path).map_err(|error| HostError::Storage(error.to_string()))?;
        let key_der = fs::read(&key_path).map_err(|error| HostError::Storage(error.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600));
        }
        return Ok(HostCert {
            fingerprint: fingerprint(&cert_der),
            cert_der,
            key_der,
        });
    }

    let key_pair =
        rcgen::KeyPair::generate().map_err(|error| HostError::Storage(error.to_string()))?;
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
    write_private_bytes(&key_path, &key_der)?;
    Ok(HostCert {
        fingerprint: fingerprint(&cert_der),
        cert_der,
        key_der,
    })
}
