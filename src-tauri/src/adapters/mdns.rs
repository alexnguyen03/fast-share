use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::domain::{require_lan_host, HostError};

static ADVERTISER: OnceLock<mdns_sd::ServiceDaemon> = OnceLock::new();
static ADVERTISED_SERVICE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscoveredHost {
    pub pc_id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
}

/// Register (or re-register) the host on the given LAN address. A rebind after
/// an IP change calls this again so the previous record with the stale address
/// is withdrawn instead of lingering on the network.
pub fn advertise(
    ip: Ipv4Addr,
    pc_id: &str,
    name: &str,
    port: u16,
    fingerprint: &str,
) -> Result<(), HostError> {
    let daemon = advertiser_daemon()?;
    let host = format!("{pc_id}.local.");
    let instance = format!("fast-share-{pc_id}");
    let properties = [("id", pc_id), ("name", name), ("fp", fingerprint)];
    let service = mdns_sd::ServiceInfo::new(
        "_fastshare._tcp.local.",
        &instance,
        &host,
        IpAddr::V4(ip),
        port,
        &properties[..],
    )
    .map_err(|error| HostError::Storage(error.to_string()))?;
    let fullname = service.get_fullname().to_string();
    let mut current = ADVERTISED_SERVICE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(previous) = current.take() {
        // Same service name: mdns-sd rejects a duplicate registration, so
        // withdraw the old record before publishing the new address.
        let _ = daemon.unregister(&previous);
    }
    daemon
        .register(service)
        .map_err(|error| HostError::Storage(error.to_string()))?;
    *current = Some(fullname);
    Ok(())
}

fn advertiser_daemon() -> Result<&'static mdns_sd::ServiceDaemon, HostError> {
    if let Some(daemon) = ADVERTISER.get() {
        return Ok(daemon);
    }
    let daemon = mdns_sd::ServiceDaemon::new()
        .map_err(|error| HostError::Storage(error.to_string()))?;
    let _ = ADVERTISER.set(daemon);
    ADVERTISER
        .get()
        .ok_or_else(|| HostError::Storage("mDNS daemon unavailable".to_string()))
}

pub fn browse_hosts(timeout: Duration) -> Vec<DiscoveredHost> {
    let Ok(daemon) = mdns_sd::ServiceDaemon::new() else {
        return Vec::new();
    };
    let Ok(receiver) = daemon.browse("_fastshare._tcp.local.") else {
        return Vec::new();
    };
    let deadline = Instant::now() + timeout;
    let mut hosts = Vec::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining.min(Duration::from_millis(200))) else {
            continue;
        };
        if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
            let Some(property) = info.get_property("id") else {
                continue;
            };
            let id = property.val_str();
            let port = info.get_port();
            if id.is_empty() || port == 0 {
                continue;
            }
            let name = info
                .get_property("name")
                .map(|prop| prop.val_str().to_string())
                .filter(|val| !val.trim().is_empty())
                .unwrap_or_else(|| "Computer".to_string());
            let fingerprint = info
                .get_property("fp")
                .map(|prop| prop.val_str().to_ascii_lowercase())
                .unwrap_or_default();
            let Some(ip) = info
                .get_addresses_v4()
                .into_iter()
                .map(|addr| addr.to_string())
                .find(|candidate| require_lan_host(candidate).is_ok())
            else {
                continue;
            };
            if let Some(existing) = hosts
                .iter_mut()
                .find(|item: &&mut DiscoveredHost| item.pc_id == id)
            {
                existing.name = name;
                existing.host = ip;
                existing.port = port;
                if !fingerprint.is_empty() {
                    existing.fingerprint = fingerprint;
                }
            } else {
                hosts.push(DiscoveredHost {
                    pc_id: id.to_string(),
                    name,
                    host: ip,
                    port,
                    fingerprint,
                });
            }
        }
    }
    hosts
}
