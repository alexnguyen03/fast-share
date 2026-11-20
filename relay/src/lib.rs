//! A relay that pipes WebSocket frames between a computer and a phone.
//! It never parses a frame, never writes one to disk, and queues nothing: a phone that
//! arrives while no computer is waiting gets a 409 at once. See `docs/relay.md`.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, oneshot};

/// One Noise message is at most 65 535 bytes; leave room for the WebSocket framing.
const MAX_FRAME: usize = 70_000;
const PING_EVERY: Duration = Duration::from_secs(25);

#[derive(Clone, Debug)]
pub struct Config {
    /// `None` only when the operator explicitly allowed an open relay.
    pub token: Option<String>,
    pub max_sessions_per_mailbox: usize,
    pub connects_per_minute: usize,
    pub idle_timeout: Duration,
    pub max_session: Duration,
    /// How long a phone waits for the computer to answer.
    pub session_wait: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            token: None,
            max_sessions_per_mailbox: 8,
            connects_per_minute: 60,
            idle_timeout: Duration::from_secs(300),
            max_session: Duration::from_secs(1800),
            session_wait: Duration::from_secs(10),
        }
    }
}

struct Mailbox {
    control: mpsc::Sender<String>,
    /// Tells a replaced control socket apart from the current one when it ends.
    generation: u64,
    sessions: usize,
}

struct Waiting {
    mailbox: String,
    answer: oneshot::Sender<WebSocket>,
}

struct Inner {
    config: Config,
    mailboxes: Mutex<HashMap<String, Mailbox>>,
    waiting: Mutex<HashMap<String, Waiting>>,
    attempts: Mutex<HashMap<IpAddr, Vec<Instant>>>,
    next_generation: Mutex<u64>,
}

type Shared = Arc<Inner>;

pub fn router(config: Config) -> Router {
    let shared: Shared = Arc::new(Inner {
        config,
        mailboxes: Mutex::new(HashMap::new()),
        waiting: Mutex::new(HashMap::new()),
        attempts: Mutex::new(HashMap::new()),
        next_generation: Mutex::new(0),
    });
    Router::new()
        .route("/m/{mailbox}/desktop", get(desktop))
        .route("/m/{mailbox}/connect", get(connect))
        .route("/m/{mailbox}/status", get(status))
        .route("/m/{mailbox}/s/{id}", get(answer))
        .with_state(shared)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn authorized(config: &Config, headers: &HeaderMap) -> bool {
    let Some(expected) = &config.token else {
        return true;
    };
    let given = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("");
    // Compare digests, so the comparison does not depend on where the strings first differ.
    let (a, b) = (Sha256::digest(expected), Sha256::digest(given));
    a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn valid_mailbox(mailbox: &str) -> bool {
    mailbox.len() == 64 && mailbox.chars().all(|c| c.is_ascii_hexdigit())
}

/// The computer's long-lived control socket. Phones announce themselves on it.
async fn desktop(
    State(shared): State<Shared>,
    Path(mailbox): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !authorized(&shared.config, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !valid_mailbox(&mailbox) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    ws.max_message_size(MAX_FRAME)
        .on_upgrade(move |socket| control_socket(shared, mailbox, socket))
}

async fn control_socket(shared: Shared, mailbox: String, mut socket: WebSocket) {
    let (tx, mut rx) = mpsc::channel::<String>(16);
    let generation = {
        let mut next = lock(&shared.next_generation);
        *next += 1;
        *next
    };
    // A new control socket replaces the old one: dropping its sender ends the old task.
    lock(&shared.mailboxes).insert(
        mailbox.clone(),
        Mailbox {
            control: tx,
            generation,
            sessions: 0,
        },
    );
    let mut ping = tokio::time::interval_at(tokio::time::Instant::now() + PING_EVERY, PING_EVERY);
    loop {
        tokio::select! {
            announce = rx.recv() => {
                let Some(text) = announce else { break };
                if socket.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => {
                if !matches!(incoming, Some(Ok(Message::Ping(_) | Message::Pong(_)))) {
                    // Anything else (including a close) ends the control socket.
                    break;
                }
            }
            _ = ping.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
        }
    }
    let mut mailboxes = lock(&shared.mailboxes);
    if mailboxes
        .get(&mailbox)
        .is_some_and(|current| current.generation == generation)
    {
        mailboxes.remove(&mailbox);
    }
}

fn allow_connect(shared: &Shared, ip: IpAddr) -> bool {
    let mut attempts = lock(&shared.attempts);
    let now = Instant::now();
    let recent = attempts.entry(ip).or_default();
    recent.retain(|at| now.duration_since(*at) < Duration::from_secs(60));
    if recent.len() >= shared.config.connects_per_minute {
        return false;
    }
    recent.push(now);
    true
}

/// Whether the computer behind `mailbox` is connected. Plain HTTP, so a phone can ask without
/// starting a session.
async fn status(
    State(shared): State<Shared>,
    Path(mailbox): Path<String>,
    headers: HeaderMap,
) -> StatusCode {
    if !authorized(&shared.config, &headers) {
        return StatusCode::UNAUTHORIZED;
    }
    if lock(&shared.mailboxes).contains_key(&mailbox) {
        StatusCode::OK
    } else {
        StatusCode::CONFLICT
    }
}

/// A phone asks to talk to the computer behind `mailbox`.
async fn connect(
    State(shared): State<Shared>,
    Path(mailbox): Path<String>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !authorized(&shared.config, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !valid_mailbox(&mailbox) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if !allow_connect(&shared, peer.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let control = {
        let mut mailboxes = lock(&shared.mailboxes);
        let Some(entry) = mailboxes.get_mut(&mailbox) else {
            // Nothing waits for this mailbox: say so now instead of queueing.
            return StatusCode::CONFLICT.into_response();
        };
        if entry.sessions >= shared.config.max_sessions_per_mailbox {
            return StatusCode::TOO_MANY_REQUESTS.into_response();
        }
        entry.sessions += 1;
        entry.control.clone()
    };
    ws.max_message_size(MAX_FRAME)
        .on_upgrade(move |socket| phone_session(shared, mailbox, control, socket))
}

async fn phone_session(
    shared: Shared,
    mailbox: String,
    control: mpsc::Sender<String>,
    phone: WebSocket,
) {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let (answer_tx, answer_rx) = oneshot::channel();
    lock(&shared.waiting).insert(
        id.clone(),
        Waiting {
            mailbox: mailbox.clone(),
            answer: answer_tx,
        },
    );
    let announced = control
        .send(format!("{{\"session\":\"{id}\"}}"))
        .await
        .is_ok();
    let desktop = if announced {
        tokio::time::timeout(shared.config.session_wait, answer_rx)
            .await
            .ok()
            .and_then(Result::ok)
    } else {
        None
    };
    lock(&shared.waiting).remove(&id);
    if let Some(desktop) = desktop {
        pipe(phone, desktop, &shared.config).await;
    }
    if let Some(entry) = lock(&shared.mailboxes).get_mut(&mailbox) {
        entry.sessions = entry.sessions.saturating_sub(1);
    }
}

/// The computer answers a session it was told about on its control socket.
async fn answer(
    State(shared): State<Shared>,
    Path((mailbox, id)): Path<(String, String)>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !authorized(&shared.config, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    ws.max_message_size(MAX_FRAME).on_upgrade(move |socket| async move {
        let waiting = lock(&shared.waiting).remove(&id);
        match waiting {
            // Only the computer that owns the mailbox may answer.
            Some(waiting) if waiting.mailbox == mailbox => {
                let _ = waiting.answer.send(socket);
            }
            _ => {}
        }
    })
}

/// Copies frames both ways. A send waits for the other side, which is the backpressure.
async fn pipe(mut phone: WebSocket, mut desktop: WebSocket, config: &Config) {
    let deadline = tokio::time::sleep(config.max_session);
    tokio::pin!(deadline);
    loop {
        let idle = tokio::time::sleep(config.idle_timeout);
        tokio::select! {
            frame = phone.recv() => {
                if !forward(frame, &mut desktop).await { break }
            }
            frame = desktop.recv() => {
                if !forward(frame, &mut phone).await { break }
            }
            _ = idle => break,
            _ = &mut deadline => break,
        }
    }
    let _ = phone.send(Message::Close(None)).await;
    let _ = desktop.send(Message::Close(None)).await;
}

async fn forward(frame: Option<Result<Message, axum::Error>>, to: &mut WebSocket) -> bool {
    match frame {
        Some(Ok(Message::Binary(bytes))) => to.send(Message::Binary(bytes)).await.is_ok(),
        Some(Ok(Message::Ping(_) | Message::Pong(_))) => true,
        // Text from a phone is not part of the protocol; a close or an error ends the session.
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Message as Ws;

    const MAILBOX: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    async fn start(config: Config) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = router(config).into_make_service_with_connect_info::<SocketAddr>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        port
    }

    fn request(
        port: u16,
        path: &str,
        token: Option<&str>,
    ) -> tokio_tungstenite::tungstenite::handshake::client::Request {
        let mut request = format!("ws://127.0.0.1:{port}{path}")
            .into_client_request()
            .unwrap();
        if let Some(token) = token {
            request
                .headers_mut()
                .insert("authorization", format!("Bearer {token}").parse().unwrap());
        }
        request
    }

    type Client = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    async fn dial(port: u16, path: &str, token: Option<&str>) -> Result<Client, u16> {
        match tokio_tungstenite::connect_async(request(port, path, token)).await {
            Ok((stream, _)) => Ok(stream),
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
                Err(response.status().as_u16())
            }
            Err(error) => panic!("unexpected error: {error}"),
        }
    }

    fn with_token() -> Config {
        Config {
            token: Some("s3cret".into()),
            ..Config::default()
        }
    }

    #[tokio::test]
    async fn frames_cross_in_both_directions_and_an_unknown_mailbox_gets_409() {
        let port = start(with_token()).await;
        let (desktop_path, connect_path) = (
            format!("/m/{MAILBOX}/desktop"),
            format!("/m/{MAILBOX}/connect"),
        );
        assert_eq!(dial(port, &connect_path, Some("s3cret")).await.err(), Some(409));

        let mut control = dial(port, &desktop_path, Some("s3cret")).await.unwrap();
        let mut phone = dial(port, &connect_path, Some("s3cret")).await.unwrap();
        let Some(Ok(Ws::Text(announce))) = control.next().await else {
            panic!("expected a session announcement");
        };
        let id = announce
            .as_str()
            .split('"')
            .nth(3)
            .expect("session id")
            .to_string();
        let mut desktop = dial(port, &format!("/m/{MAILBOX}/s/{id}"), Some("s3cret"))
            .await
            .unwrap();

        phone.send(Ws::Binary(vec![1, 2, 3].into())).await.unwrap();
        let Some(Ok(Ws::Binary(got))) = desktop.next().await else {
            panic!("desktop should receive the phone's frame");
        };
        assert_eq!(got.to_vec(), vec![1, 2, 3]);
        desktop.send(Ws::Binary(vec![9; 60_000].into())).await.unwrap();
        let Some(Ok(Ws::Binary(back))) = phone.next().await else {
            panic!("phone should receive the desktop's frame");
        };
        assert_eq!(back.len(), 60_000);
    }

    #[tokio::test]
    async fn status_says_whether_the_computer_is_connected() {
        let port = start(with_token()).await;
        let url = format!("/m/{MAILBOX}/status");
        // A plain HTTP request, written by hand to keep the test free of an HTTP client.
        let ask = |token: &'static str| {
            let url = url.clone();
            async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
                let request = format!(
                    "GET {url} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
                );
                stream.write_all(request.as_bytes()).await.unwrap();
                let mut reply = String::new();
                stream.read_to_string(&mut reply).await.unwrap();
                reply.split_whitespace().nth(1).unwrap().to_string()
            }
        };
        assert_eq!(ask("s3cret").await, "409");
        assert_eq!(ask("nope").await, "401");
        let _control = dial(port, &format!("/m/{MAILBOX}/desktop"), Some("s3cret"))
            .await
            .unwrap();
        assert_eq!(ask("s3cret").await, "200");
    }

    #[tokio::test]
    async fn a_wrong_or_missing_token_is_refused() {
        let port = start(with_token()).await;
        for token in [None, Some("nope")] {
            for path in ["desktop", "connect"] {
                let path = format!("/m/{MAILBOX}/{path}");
                assert_eq!(dial(port, &path, token).await.err(), Some(401));
            }
        }
    }

    #[tokio::test]
    async fn a_new_control_socket_replaces_the_old_one() {
        let port = start(with_token()).await;
        let path = format!("/m/{MAILBOX}/desktop");
        let mut first = dial(port, &path, Some("s3cret")).await.unwrap();
        let _second = dial(port, &path, Some("s3cret")).await.unwrap();
        // The old socket is closed by the relay.
        let ended = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match first.next().await {
                    None | Some(Err(_)) | Some(Ok(Ws::Close(_))) => return,
                    Some(Ok(_)) => continue,
                }
            }
        })
        .await;
        assert!(ended.is_ok(), "the replaced control socket should be closed");
        let connect = format!("/m/{MAILBOX}/connect");
        assert!(dial(port, &connect, Some("s3cret")).await.is_ok());
    }

    #[tokio::test]
    async fn sessions_per_mailbox_and_connects_per_address_are_capped() {
        let config = Config {
            max_sessions_per_mailbox: 2,
            connects_per_minute: 100,
            ..with_token()
        };
        let port = start(config).await;
        let _control = dial(port, &format!("/m/{MAILBOX}/desktop"), Some("s3cret"))
            .await
            .unwrap();
        let connect = format!("/m/{MAILBOX}/connect");
        let _a = dial(port, &connect, Some("s3cret")).await.unwrap();
        let _b = dial(port, &connect, Some("s3cret")).await.unwrap();
        assert_eq!(dial(port, &connect, Some("s3cret")).await.err(), Some(429));

        let strict = Config {
            connects_per_minute: 2,
            ..with_token()
        };
        let port = start(strict).await;
        let _control = dial(port, &format!("/m/{MAILBOX}/desktop"), Some("s3cret"))
            .await
            .unwrap();
        let _a = dial(port, &connect, Some("s3cret")).await.unwrap();
        let _b = dial(port, &connect, Some("s3cret")).await.unwrap();
        assert_eq!(dial(port, &connect, Some("s3cret")).await.err(), Some(429));
    }

    #[tokio::test]
    async fn another_mailbox_cannot_answer_a_session() {
        let port = start(with_token()).await;
        let mut control = dial(port, &format!("/m/{MAILBOX}/desktop"), Some("s3cret"))
            .await
            .unwrap();
        let _phone = dial(port, &format!("/m/{MAILBOX}/connect"), Some("s3cret"))
            .await
            .unwrap();
        let Some(Ok(Ws::Text(announce))) = control.next().await else {
            panic!("announcement");
        };
        let id = announce.as_str().split('"').nth(3).unwrap().to_string();
        let other = "f".repeat(64);
        let mut stranger = dial(port, &format!("/m/{other}/s/{id}"), Some("s3cret"))
            .await
            .unwrap();
        // The relay drops a socket that answers for a mailbox that does not own the session.
        let ended = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match stranger.next().await {
                    None | Some(Err(_)) | Some(Ok(Ws::Close(_))) => return,
                    Some(Ok(_)) => continue,
                }
            }
        })
        .await;
        assert!(ended.is_ok());
    }
}
