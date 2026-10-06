use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum HostError {
    #[error("unknown phone")]
    UnknownPhone,
    #[error("phone is not trusted")]
    NotTrusted,
    #[error("pairing expired")]
    PairingExpired,
    #[error("pairing was rejected")]
    #[allow(dead_code)]
    PairingRejected,
    #[error("image is too large")]
    ImageTooLarge,
    #[error("image could not be decoded")]
    ImageUndecodable,
    #[error("retention must be 1 through 90")]
    InvalidRetention,
    #[error("display name is empty")]
    InvalidName,
    #[error("unknown settings field")]
    UnknownSettingsField,
    #[error("invalid id")]
    InvalidId,
    #[error("not found")]
    NotFound,
    #[error("computer did not receive")]
    Unreachable,
    #[error("{0}")]
    Storage(String),
}
