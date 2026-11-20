use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use fast_share_relay::{router, Config};
use sha2::{Digest, Sha256};

const USAGE: &str = "\
Fast Share relay: pipes encrypted frames between a computer and a phone. Stores nothing.

Usage: fast-share-relay [options]
  --listen ADDR            address to listen on (default 0.0.0.0:8443)
  --public-host HOST       name or IP phones use to reach this relay (printed in the relay string)
  --token TOKEN            access token; or set RELAY_TOKEN. Without either, one is made and saved.
  --allow-open             no token at all (anyone may use this relay)
  --plain                  serve ws:// (for use behind a proxy that does TLS)
  --data-dir DIR           where the certificate and token are kept (default ./relay-data)
  --connects-per-minute N  phone connects allowed per address per minute (default 60)
  -h, --help               show this help";

struct Args {
    listen: SocketAddr,
    public_host: String,
    token: Option<String>,
    allow_open: bool,
    plain: bool,
    data_dir: PathBuf,
    connects_per_minute: usize,
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        listen: "0.0.0.0:8443".parse().map_err(|_| "bad default")?,
        public_host: "YOUR-HOST".into(),
        token: std::env::var("RELAY_TOKEN").ok().filter(|t| !t.is_empty()),
        allow_open: false,
        plain: false,
        data_dir: PathBuf::from("relay-data"),
        connects_per_minute: 60,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut value = |name: &str| it.next().ok_or(format!("{name} needs a value"));
        match flag.as_str() {
            "--listen" => args.listen = value("--listen")?.parse().map_err(|_| "bad --listen")?,
            "--public-host" => args.public_host = value("--public-host")?,
            "--token" => args.token = Some(value("--token")?),
            "--allow-open" => args.allow_open = true,
            "--plain" => args.plain = true,
            "--data-dir" => args.data_dir = PathBuf::from(value("--data-dir")?),
            "--connects-per-minute" => {
                args.connects_per_minute = value("--connects-per-minute")?
                    .parse()
                    .map_err(|_| "bad --connects-per-minute")?
            }
            "-h" | "--help" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other => return Err(format!("unknown option {other}\n\n{USAGE}")),
        }
    }
    Ok(args)
}

fn token(args: &Args) -> Result<Option<String>, String> {
    if args.allow_open {
        return Ok(None);
    }
    if let Some(token) = &args.token {
        return Ok(Some(token.clone()));
    }
    // First run without a token: make one and keep it, so a restart does not break the phones.
    let path = args.data_dir.join("token.txt");
    if let Ok(saved) = std::fs::read_to_string(&path) {
        return Ok(Some(saved.trim().to_string()));
    }
    let made = uuid::Uuid::new_v4().simple().to_string();
    std::fs::write(&path, &made).map_err(|e| e.to_string())?;
    Ok(Some(made))
}

/// A self-signed certificate kept in the data directory; phones pin its fingerprint.
fn certificate(dir: &Path) -> Result<(Vec<u8>, Vec<u8>), String> {
    let (cert_path, key_path) = (dir.join("cert.der"), dir.join("key.der"));
    if let (Ok(cert), Ok(key)) = (std::fs::read(&cert_path), std::fs::read(&key_path)) {
        return Ok((cert, key));
    }
    let key = rcgen::KeyPair::generate().map_err(|e| e.to_string())?;
    let cert = rcgen::CertificateParams::new(vec!["localhost".to_string()])
        .map_err(|e| e.to_string())?
        .self_signed(&key)
        .map_err(|e| e.to_string())?;
    let (cert, key) = (cert.der().to_vec(), key.serialize_der());
    std::fs::write(&cert_path, &cert).map_err(|e| e.to_string())?;
    std::fs::write(&key_path, &key).map_err(|e| e.to_string())?;
    Ok((cert, key))
}

#[tokio::main]
async fn main() {
    if let Err(message) = run().await {
        eprintln!("fast-share-relay: {message}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args = parse_args()?;
    std::fs::create_dir_all(&args.data_dir).map_err(|e| e.to_string())?;
    let token = token(&args)?;
    let config = Config {
        token: token.clone(),
        connects_per_minute: args.connects_per_minute,
        ..Config::default()
    };
    // Phones reach a connect with the address's connection info for the rate limit.
    let app = router(config).into_make_service_with_connect_info::<SocketAddr>();
    let port = args.listen.port();

    let mut string = format!("fastshare-relay://{}:{port}?", args.public_host);
    if args.plain {
        string.push_str("plain=1&");
    } else {
        let (cert, key) = certificate(&args.data_dir)?;
        string.push_str(&format!("fp={}&", hex::encode(Sha256::digest(&cert))));
        let _ = rustls::crypto::ring::default_provider().install_default();
        let tls = axum_server::tls_rustls::RustlsConfig::from_der(vec![cert], key)
            .await
            .map_err(|e| e.to_string())?;
        announce(&args, &string, token.as_deref());
        return axum_server::bind_rustls(args.listen, tls)
            .serve(app)
            .await
            .map_err(|e| e.to_string());
    }
    announce(&args, &string, token.as_deref());
    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .map_err(|e| e.to_string())?;
    axum::serve(listener, app).await.map_err(|e| e.to_string())
}

fn announce(args: &Args, string: &str, token: Option<&str>) {
    let full = match token {
        Some(token) => format!("{string}token={token}"),
        None => string.trim_end_matches(['&', '?']).to_string(),
    };
    println!("Fast Share relay listening on {}", args.listen);
    if token.is_none() {
        println!("WARNING: no token. Anyone who can reach this address can use the relay.");
    }
    if args.public_host == "YOUR-HOST" {
        println!("Replace YOUR-HOST below with the name or IP phones use to reach this machine.");
    }
    println!("Paste this into Fast Share on the computer:\n\n  {full}\n");
}
