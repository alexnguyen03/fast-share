use serde::{Deserialize, Serialize};

use super::relay::RelayInfo;

/// Largest plaintext carried by one Noise message (65 535 minus the 16-byte tag), minus CBOR framing room.
pub const CHUNK_BYTES: usize = 60_000;

/// First encrypted payload from the phone, sent inside the handshake.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hello {
    /// Present when the phone scanned a QR code.
    pub pairing_token: Option<String>,
    /// True when the phone wants to be trusted. False for a plain send: an unknown key is then
    /// refused at once instead of starting a pairing request.
    pub pair: bool,
    pub name: String,
}

/// One application message. A blob (image or text) is `Item`/`BeginText` followed by `Chunk`s.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Msg {
    BeginImages {
        batch_id: String,
        count: u32,
    },
    BeginText {
        batch_id: String,
        size: u32,
    },
    Item {
        size: u32,
    },
    Chunk(#[serde(with = "serde_bytes")] Vec<u8>),
    End,
    Ack,
    Error {
        code: String,
    },
    Paired,
    /// After pairing: the relay this computer is reachable through.
    Relay(RelayInfo),
    Rejected,
}
