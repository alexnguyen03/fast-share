use std::net::Ipv4Addr;

use crate::domain::HostError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LanSnapshot {
    pub ip: Ipv4Addr,
    pub subnet: String,
    pub addresses: Vec<(String, Ipv4Addr)>,
}

pub fn lan_ipv4() -> Ipv4Addr {
    lan_snapshot().ip
}

pub fn lan_snapshot() -> LanSnapshot {
    lan_snapshot_from(&list_ipv4_interfaces())
}

pub fn list_ipv4_interfaces() -> Vec<(String, Ipv4Addr)> {
    if_addrs::get_if_addrs()
        .ok()
        .map(|addrs| {
            addrs
                .into_iter()
                .filter_map(|iface| match iface.addr.ip() {
                    std::net::IpAddr::V4(ip) => Some((iface.name, ip)),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn lan_snapshot_from(candidates: &[(String, Ipv4Addr)]) -> LanSnapshot {
    let addresses: Vec<(String, Ipv4Addr)> = candidates
        .iter()
        .filter(|(name, ip)| is_usable_interface(name, *ip))
        .cloned()
        .collect();
    let ip = select_lan_ipv4(candidates).unwrap_or(Ipv4Addr::LOCALHOST);
    LanSnapshot {
        subnet: subnet_24(ip),
        ip,
        addresses,
    }
}

pub fn subnet_24(ip: Ipv4Addr) -> String {
    let [a, b, c, _] = ip.octets();
    format!("{a}.{b}.{c}.0/24")
}

pub fn reachability_error(local_ip: Ipv4Addr, target_ip: Ipv4Addr) -> HostError {
    match classify_unreachable(local_ip, target_ip) {
        ReachabilityReason::DifferentSubnet => HostError::DifferentSubnet {
            local: local_ip.to_string(),
            remote: target_ip.to_string(),
        },
        ReachabilityReason::GuestOrFirewall => HostError::GuestWifiOrFirewall,
    }
}

pub fn select_lan_ipv4(candidates: &[(String, Ipv4Addr)]) -> Option<Ipv4Addr> {
    let usable: Vec<&(String, Ipv4Addr)> = candidates
        .iter()
        .filter(|(name, ip)| is_usable_interface(name, *ip))
        .collect();
    usable
        .iter()
        .find(|(name, _)| is_wifi_interface(name))
        .or_else(|| usable.first())
        .map(|(_, ip)| *ip)
}

pub fn is_usable_interface(name: &str, ip: Ipv4Addr) -> bool {
    if is_virtual_adapter(name) {
        return false;
    }
    is_private_lan_ip(ip)
}

pub fn is_private_lan_ip(ip: Ipv4Addr) -> bool {
    if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast() {
        return false;
    }
    let [a, b, _, _] = ip.octets();
    if a == 172 && b == 17 {
        return false;
    }
    a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReachabilityReason {
    DifferentSubnet,
    GuestOrFirewall,
}

pub fn classify_unreachable(local_ip: Ipv4Addr, target_ip: Ipv4Addr) -> ReachabilityReason {
    if !same_subnet_24(local_ip, target_ip) {
        ReachabilityReason::DifferentSubnet
    } else {
        ReachabilityReason::GuestOrFirewall
    }
}

pub fn same_subnet_24(left: Ipv4Addr, right: Ipv4Addr) -> bool {
    if left.is_loopback() || right.is_loopback() {
        return true;
    }
    let l = left.octets();
    let r = right.octets();
    l[0] == r[0] && l[1] == r[1] && l[2] == r[2]
}

pub fn firewall_warning() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        windows_firewall_warning()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
static FIREWALL_WARNING_CACHE: std::sync::Mutex<Option<Option<String>>> =
    std::sync::Mutex::new(None);

#[cfg(target_os = "windows")]
fn windows_firewall_warning() -> Option<String> {
    if let Ok(guard) = FIREWALL_WARNING_CACHE.lock() {
        if let Some(cached) = &*guard {
            return cached.clone();
        }
    }
    let result = query_windows_firewall_warning();
    if let Ok(mut guard) = FIREWALL_WARNING_CACHE.lock() {
        *guard = Some(result.clone());
    }
    result
}

#[cfg(target_os = "windows")]
fn query_windows_firewall_warning() -> Option<String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let profile = Command::new("netsh")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["advfirewall", "monitor", "show", "currentprofile"])
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_ascii_lowercase())?;
    if !profile.contains("public") {
        return None;
    }
    let rule = Command::new("netsh")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "advfirewall",
            "firewall",
            "show",
            "rule",
            "name=Fast Share LAN",
        ])
        .output()
        .ok()
        .map(|out| {
            out.status.success() && !String::from_utf8_lossy(&out.stdout).contains("No rules")
        })
        .unwrap_or(false);
    if rule {
        None
    } else {
        Some("windows_public_firewall".to_string())
    }
}

pub fn allow_in_firewall(port: u16) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let args = format!(
            "advfirewall firewall add rule name=\"Fast Share LAN\" dir=in action=allow protocol=TCP localport={port}-47670 profile=any"
        );
        let status = std::process::Command::new("powershell")
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-NoProfile",
                "-Command",
                &format!("Start-Process netsh -ArgumentList '{args}' -Verb RunAs -Wait"),
            ])
            .status()
            .map_err(|error| error.to_string())?;
        if let Ok(mut guard) = FIREWALL_WARNING_CACHE.lock() {
            *guard = None;
        }
        if status.success() {
            Ok(())
        } else {
            Err("firewall rule was not added".to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = port;
        Ok(())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn is_mouse_button_down() -> bool {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetAsyncKeyState(vkey: i32) -> i16;
        }
        const VK_LBUTTON: i32 = 0x01;
        // SAFETY: GetAsyncKeyState is a stateless Win32 user32 query that takes a virtual-key integer code and dereferences no pointers.
        let state = unsafe { GetAsyncKeyState(VK_LBUTTON) };
        (state as u16 & 0x8000) != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

pub fn set_os_auto_start(enabled: bool) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let exe_path = format!("\"{}\"", exe.to_string_lossy());
        if enabled {
            let _ = Command::new("reg")
                .creation_flags(CREATE_NO_WINDOW)
                .args([
                    "add",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "FastShare",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &exe_path,
                    "/f",
                ])
                .status();
        } else {
            let _ = Command::new("reg")
                .creation_flags(CREATE_NO_WINDOW)
                .args([
                    "delete",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "FastShare",
                    "/f",
                ])
                .status();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
    }
}

fn is_virtual_adapter(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        "docker",
        "vethernet",
        "vmnet",
        "vbox",
        "br-",
        "rmnet",
        "ccmni",
        "dummy",
        "tun",
        "ppp",
        "clat",
    ]
    .iter()
    .any(|prefix| lower.contains(prefix))
}

fn is_wifi_interface(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    ["wlan", "wifi", "wl", "wi-fi", "en0", "wlp"]
        .iter()
        .any(|token| lower.contains(token))
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use super::{
        classify_unreachable, is_private_lan_ip, is_usable_interface, lan_snapshot_from,
        reachability_error, same_subnet_24, select_lan_ipv4, ReachabilityReason,
    };

    #[test]
    fn public_and_virtual_interfaces_are_not_selected_for_lan() {
        let candidates = vec![
            ("eth0".to_string(), Ipv4Addr::new(8, 8, 8, 8)),
            (
                "vEthernet (WSL)".to_string(),
                Ipv4Addr::new(192, 168, 50, 1),
            ),
            ("docker0".to_string(), Ipv4Addr::new(172, 17, 0, 1)),
            ("vmnet8".to_string(), Ipv4Addr::new(192, 168, 80, 1)),
            ("vboxnet0".to_string(), Ipv4Addr::new(192, 168, 56, 1)),
            ("br-1234".to_string(), Ipv4Addr::new(172, 18, 0, 1)),
            ("Wi-Fi".to_string(), Ipv4Addr::new(192, 168, 1, 24)),
        ];
        assert!(!is_private_lan_ip(Ipv4Addr::new(8, 8, 8, 8)));
        assert!(!is_usable_interface(
            "vEthernet (WSL)",
            Ipv4Addr::new(192, 168, 50, 1)
        ));
        assert_eq!(
            select_lan_ipv4(&candidates),
            Some(Ipv4Addr::new(192, 168, 1, 24))
        );
    }

    #[test]
    fn unreachable_classifier_distinguishes_double_nat_from_same_subnet_isolation() {
        let phone_double_nat = Ipv4Addr::new(192, 168, 0, 42);
        let pc_lan = Ipv4Addr::new(192, 168, 1, 10);
        assert!(!same_subnet_24(phone_double_nat, pc_lan));
        assert_eq!(
            classify_unreachable(phone_double_nat, pc_lan),
            ReachabilityReason::DifferentSubnet
        );

        let phone_same_subnet = Ipv4Addr::new(192, 168, 1, 42);
        assert!(same_subnet_24(phone_same_subnet, pc_lan));
        assert_eq!(
            classify_unreachable(phone_same_subnet, pc_lan),
            ReachabilityReason::GuestOrFirewall
        );
    }

    #[test]
    fn wifi_is_preferred_over_cellular_when_picking_lan_ip() {
        let candidates = vec![
            ("rmnet0".to_string(), Ipv4Addr::new(10, 42, 0, 12)),
            ("wlan0".to_string(), Ipv4Addr::new(192, 168, 1, 24)),
            ("dummy0".to_string(), Ipv4Addr::new(192, 168, 1, 1)),
        ];
        assert_eq!(
            select_lan_ipv4(&candidates),
            Some(Ipv4Addr::new(192, 168, 1, 24))
        );
    }

    #[test]
    fn lan_snapshot_shows_ip_subnet_and_usable_addresses() {
        let candidates = vec![
            ("rmnet0".to_string(), Ipv4Addr::new(10, 42, 0, 12)),
            ("wlan0".to_string(), Ipv4Addr::new(192, 168, 1, 24)),
        ];
        let snapshot = lan_snapshot_from(&candidates);
        assert_eq!(snapshot.ip, Ipv4Addr::new(192, 168, 1, 24));
        assert_eq!(snapshot.subnet, "192.168.1.0/24");
        assert_eq!(
            snapshot.addresses,
            vec![("wlan0".to_string(), Ipv4Addr::new(192, 168, 1, 24))]
        );
    }

    #[test]
    fn reachability_error_names_both_ipv4_addresses() {
        let error = reachability_error(
            Ipv4Addr::new(192, 168, 0, 42),
            Ipv4Addr::new(192, 168, 1, 10),
        );
        assert_eq!(
            error,
            crate::domain::HostError::DifferentSubnet {
                local: "192.168.0.42".to_string(),
                remote: "192.168.1.10".to_string(),
            }
        );
        assert!(error.to_string().contains("192.168.0.42"));
        assert!(error.to_string().contains("192.168.1.10"));
    }
}
