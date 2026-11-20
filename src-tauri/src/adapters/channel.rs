//! The end-to-end channel from `docs/e2e.md`: a Noise XK handshake over any ordered frame
//! stream (LAN WebSocket now, relay pipe later), then one encrypted CBOR message per frame.

use sha2::{Digest, Sha256};
use snow::{Builder, TransportState};

use crate::adapters::keys::KeyPair;
use crate::domain::{DeviceId, HostError, Hello, Msg, CHUNK_BYTES};

pub const NOISE_PARAMS: &str = "Noise_XK_25519_ChaChaPoly_SHA256";
const MAX_FRAME: usize = 65_535;

/// An ordered stream of binary frames. `recv` returns `None` when the peer closed it.
#[allow(async_fn_in_trait)]
pub trait Frames {
    async fn send(&mut self, bytes: Vec<u8>) -> Result<(), HostError>;
    async fn recv(&mut self) -> Result<Option<Vec<u8>>, HostError>;
}

fn channel_err(error: impl std::fmt::Display) -> HostError {
    HostError::Channel(error.to_string())
}

/// Binds the handshake to the protocol version and to the desktop it is meant for.
fn prologue(responder_public: &[u8]) -> Vec<u8> {
    format!(
        "fast-share/2{}",
        DeviceId::from_public_key(responder_public).as_str()
    )
    .into_bytes()
}

pub struct Session {
    transport: TransportState,
}

pub struct Established {
    pub session: Session,
    /// The peer's static public key, authenticated by the handshake.
    pub remote_public: Vec<u8>,
    pub hash: Vec<u8>,
}

/// Six digits both screens show so the user can confirm there is no one in the middle.
pub fn sas(handshake_hash: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"fast-share-sas");
    hasher.update(handshake_hash);
    let digest = hasher.finalize();
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 1_000_000;
    format!("{value:06}")
}

fn new_builder<'a>(keys: &'a KeyPair, prologue: &'a [u8]) -> Result<Builder<'a>, HostError> {
    let params = NOISE_PARAMS.parse().map_err(channel_err)?;
    Builder::new(params)
        .prologue(prologue)
        .map_err(channel_err)?
        .local_private_key(&keys.private)
        .map_err(channel_err)
}

pub async fn handshake_initiator<F: Frames>(
    frames: &mut F,
    keys: &KeyPair,
    responder_public: &[u8],
    hello: &Hello,
) -> Result<Established, HostError> {
    let pro = prologue(responder_public);
    let mut state = new_builder(keys, &pro)?
        .remote_public_key(responder_public)
        .map_err(channel_err)?
        .build_initiator()
        .map_err(channel_err)?;
    let mut buf = vec![0u8; MAX_FRAME];
    let n = state.write_message(&[], &mut buf).map_err(channel_err)?;
    frames.send(buf[..n].to_vec()).await?;
    let reply = frames.recv().await?.ok_or_else(|| channel_err("closed"))?;
    state.read_message(&reply, &mut buf).map_err(channel_err)?;
    let mut payload = Vec::new();
    ciborium::ser::into_writer(hello, &mut payload).map_err(channel_err)?;
    let n = state.write_message(&payload, &mut buf).map_err(channel_err)?;
    frames.send(buf[..n].to_vec()).await?;
    finish(state)
}

pub async fn handshake_responder<F: Frames>(
    frames: &mut F,
    keys: &KeyPair,
) -> Result<(Established, Hello), HostError> {
    let pro = prologue(&keys.public);
    let mut state = new_builder(keys, &pro)?
        .build_responder()
        .map_err(channel_err)?;
    let mut buf = vec![0u8; MAX_FRAME];
    let first = frames.recv().await?.ok_or_else(|| channel_err("closed"))?;
    state.read_message(&first, &mut buf).map_err(channel_err)?;
    let n = state.write_message(&[], &mut buf).map_err(channel_err)?;
    frames.send(buf[..n].to_vec()).await?;
    let last = frames.recv().await?.ok_or_else(|| channel_err("closed"))?;
    let n = state.read_message(&last, &mut buf).map_err(channel_err)?;
    let hello: Hello = ciborium::de::from_reader(&buf[..n]).map_err(channel_err)?;
    Ok((finish(state)?, hello))
}

fn finish(state: snow::HandshakeState) -> Result<Established, HostError> {
    let hash = state.get_handshake_hash().to_vec();
    let remote_public = state
        .get_remote_static()
        .ok_or_else(|| channel_err("peer sent no static key"))?
        .to_vec();
    let transport = state.into_transport_mode().map_err(channel_err)?;
    Ok(Established {
        session: Session { transport },
        remote_public,
        hash,
    })
}

impl Session {
    pub async fn send<F: Frames>(&mut self, frames: &mut F, msg: &Msg) -> Result<(), HostError> {
        let mut plain = Vec::new();
        ciborium::ser::into_writer(msg, &mut plain).map_err(channel_err)?;
        let mut out = vec![0u8; MAX_FRAME];
        let n = self
            .transport
            .write_message(&plain, &mut out)
            .map_err(channel_err)?;
        frames.send(out[..n].to_vec()).await
    }

    /// `None` when the peer closed the stream. A frame that fails authentication is an error.
    pub async fn recv<F: Frames>(&mut self, frames: &mut F) -> Result<Option<Msg>, HostError> {
        let Some(frame) = frames.recv().await? else {
            return Ok(None);
        };
        let mut plain = vec![0u8; MAX_FRAME];
        let n = self
            .transport
            .read_message(&frame, &mut plain)
            .map_err(channel_err)?;
        ciborium::de::from_reader(&plain[..n])
            .map(Some)
            .map_err(channel_err)
    }

    /// Sends `size` announced by the caller's `Item`/`Begin*` message, then the bytes as chunks.
    pub async fn send_chunks<F: Frames>(
        &mut self,
        frames: &mut F,
        bytes: &[u8],
    ) -> Result<(), HostError> {
        for chunk in bytes.chunks(CHUNK_BYTES) {
            self.send(frames, &Msg::Chunk(chunk.to_vec())).await?;
        }
        Ok(())
    }

    /// Reads exactly `size` bytes of chunks. `size` was already checked against the caller's limit.
    pub async fn recv_chunks<F: Frames>(
        &mut self,
        frames: &mut F,
        size: usize,
    ) -> Result<Vec<u8>, HostError> {
        let mut bytes = Vec::with_capacity(size);
        while bytes.len() < size {
            match self.recv(frames).await? {
                Some(Msg::Chunk(chunk)) if bytes.len() + chunk.len() <= size => {
                    bytes.extend_from_slice(&chunk)
                }
                _ => return Err(channel_err("unexpected message while reading a blob")),
            }
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

    struct MemFrames {
        tx: UnboundedSender<Vec<u8>>,
        rx: UnboundedReceiver<Vec<u8>>,
    }

    impl Frames for MemFrames {
        async fn send(&mut self, bytes: Vec<u8>) -> Result<(), HostError> {
            self.tx.send(bytes).map_err(channel_err)
        }
        async fn recv(&mut self) -> Result<Option<Vec<u8>>, HostError> {
            Ok(self.rx.recv().await)
        }
    }

    fn pipe() -> (MemFrames, MemFrames) {
        let (a_tx, b_rx) = unbounded_channel();
        let (b_tx, a_rx) = unbounded_channel();
        (
            MemFrames { tx: a_tx, rx: a_rx },
            MemFrames { tx: b_tx, rx: b_rx },
        )
    }

    fn hello() -> Hello {
        Hello {
            pairing_token: Some("tok".into()),
            pair: true,
            name: "Phone".into(),
        }
    }

    #[tokio::test]
    async fn both_sides_agree_on_keys_hello_and_sas() {
        let phone = KeyPair::generate().unwrap();
        let desktop = KeyPair::generate().unwrap();
        let (mut p, mut d) = pipe();
        let h = hello();
        let (init, resp) = tokio::join!(
            handshake_initiator(&mut p, &phone, &desktop.public, &h),
            handshake_responder(&mut d, &desktop),
        );
        let init = init.unwrap();
        let (resp, got_hello) = resp.unwrap();
        assert_eq!(init.remote_public, desktop.public);
        assert_eq!(resp.remote_public, phone.public);
        assert_eq!(got_hello, h);
        assert_eq!(sas(&init.hash), sas(&resp.hash));
        assert_eq!(sas(&init.hash).len(), 6);
    }

    #[tokio::test]
    async fn a_phone_that_expects_another_desktop_key_fails() {
        let phone = KeyPair::generate().unwrap();
        let desktop = KeyPair::generate().unwrap();
        let someone_else = KeyPair::generate().unwrap();
        let (mut p, mut d) = pipe();
        let h = hello();
        // Each side owns its frames, so the stream closes when its handshake gives up.
        let (init, resp) = tokio::join!(
            async move { handshake_initiator(&mut p, &phone, &someone_else.public, &h).await },
            async move { handshake_responder(&mut d, &desktop).await },
        );
        assert!(resp.is_err());
        assert!(init.is_err());
    }

    #[tokio::test]
    async fn messages_and_large_blobs_round_trip_and_tampering_is_caught() {
        let phone = KeyPair::generate().unwrap();
        let desktop = KeyPair::generate().unwrap();
        let (mut p, mut d) = pipe();
        let h = hello();
        let (init, resp) = tokio::join!(
            handshake_initiator(&mut p, &phone, &desktop.public, &h),
            handshake_responder(&mut d, &desktop),
        );
        let (mut init, mut resp) = (init.unwrap().session, resp.unwrap().0.session);

        let blob: Vec<u8> = (0..150_000u32).map(|i| (i % 251) as u8).collect();
        init.send(&mut p, &Msg::Item { size: blob.len() as u32 }).await.unwrap();
        init.send_chunks(&mut p, &blob).await.unwrap();
        assert_eq!(
            resp.recv(&mut d).await.unwrap(),
            Some(Msg::Item { size: blob.len() as u32 })
        );
        assert_eq!(resp.recv_chunks(&mut d, blob.len()).await.unwrap(), blob);

        init.send(&mut p, &Msg::End).await.unwrap();
        let mut frame = d.rx.recv().await.unwrap();
        let last = frame.len() - 1;
        frame[last] ^= 1;
        let (tx, rx) = unbounded_channel();
        tx.send(frame).unwrap();
        let mut tampered = MemFrames { tx: d.tx.clone(), rx };
        assert!(resp.recv(&mut tampered).await.is_err());
    }
}
