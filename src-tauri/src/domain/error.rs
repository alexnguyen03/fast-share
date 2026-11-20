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
    #[error("text is too large")]
    TextTooLarge,
    #[error("text is empty or invalid")]
    InvalidText,
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
    #[error(
        "two devices are on different networks: this device {local} vs other {remote} (subnet mismatch / double NAT)"
    )]
    DifferentSubnet { local: String, remote: String },
    #[error("connection timed out: Guest Wi-Fi / AP isolation or Windows Firewall blocks TCP to the computer")]
    GuestWifiOrFirewall,
    #[error(
        "could not reach a Fast Share server at {host}:{port}: the computer app may be closed, asleep, or showing a different IP:port under the QR code"
    )]
    NoServer { host: String, port: u16 },
    #[error("mDNS multicast is filtered on this Wi-Fi; enter the computer IP:port shown under the QR code")]
    MulticastFiltered,
    #[error("the relay refused this device: check the relay token")]
    RelayRefused,
    #[error("could not reach the relay: check its address, that its port is open, and the network")]
    RelayUnreachable,
    #[error("the relay's certificate is not the one in the relay string: paste the relay string again")]
    RelayPinMismatch,
    #[error("the computer is not connected to the relay: open Fast Share on it and check Settings, Relay")]
    RelayComputerOffline,
    #[error("the relay took the connection but the computer did not answer through it")]
    RelayNoAnswer,
    #[error("relay address is not valid")]
    InvalidRelay,
    #[error("too many pending requests, try again in a moment")]
    Busy,
    #[error("secure channel failed: {0}")]
    Channel(String),
    #[error("{0}")]
    Storage(String),
}
