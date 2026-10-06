use std::net::IpAddr;
use std::time::{Duration, Instant};

use crate::domain::HostError;

pub fn advertise(pc_id: &str, name: &str, port: u16) -> Result<(), HostError> {
    let ip = super::lan_ipv4();
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|error| HostError::Storage(error.to_string()))?;
    let host = format!("{pc_id}.local.");
    let instance = format!("fast-share-{pc_id}");
    let properties = [("id", pc_id), ("name", name)];
    let service = mdns_sd::ServiceInfo::new(
        "_fastshare._tcp.local.",
        &instance,
        &host,
        IpAddr::V4(ip),
        port,
        &properties[..],
    )
    .map_err(|error| HostError::Storage(error.to_string()))?;
    daemon
        .register(service)
        .map_err(|error| HostError::Storage(error.to_string()))?;
    // The daemon unregisters the service when dropped. Keep it for the process lifetime.
    std::mem::forget(daemon);
    Ok(())
}

pub fn browse_ids(timeout: Duration) -> Vec<String> {
    let Ok(daemon) = mdns_sd::ServiceDaemon::new() else {
        return Vec::new();
    };
    let Ok(receiver) = daemon.browse("_fastshare._tcp.local.") else {
        return Vec::new();
    };
    let deadline = Instant::now() + timeout;
    let mut ids = Vec::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining.min(Duration::from_millis(200))) else {
            continue;
        };
        if let mdns_sd::ServiceEvent::ServiceResolved(info) = event {
            if let Some(property) = info.get_property("id") {
                let id = property.val_str();
                if !id.is_empty() {
                    ids.push(id.to_string());
                }
            }
        }
    }
    ids
}
