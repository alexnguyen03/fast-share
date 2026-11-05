use std::net::Ipv4Addr;

pub fn lan_ipv4() -> Ipv4Addr {
    let candidates: Vec<(String, Ipv4Addr)> = if_addrs::get_if_addrs()
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
        .unwrap_or_default();
    select_lan_ipv4(&candidates).unwrap_or(Ipv4Addr::LOCALHOST)
}

pub fn select_lan_ipv4(candidates: &[(String, Ipv4Addr)]) -> Option<Ipv4Addr> {
    candidates
        .iter()
        .find_map(|(name, ip)| is_usable_interface(name, *ip).then_some(*ip))
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
fn windows_firewall_warning() -> Option<String> {
    use std::process::Command;

    let profile = Command::new("netsh")
        .args(["advfirewall", "monitor", "show", "currentprofile"])
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_ascii_lowercase())?;
    if !profile.contains("public") {
        return None;
    }
    let rule = Command::new("netsh")
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
        let args = format!(
            "advfirewall firewall add rule name=\"Fast Share LAN\" dir=in action=allow protocol=TCP localport={port}-47670 profile=any"
        );
        let status = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!("Start-Process netsh -ArgumentList '{args}' -Verb RunAs -Wait"),
            ])
            .status()
            .map_err(|error| error.to_string())?;
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

fn is_virtual_adapter(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    ["docker", "vethernet", "vmnet", "vbox", "br-"]
        .iter()
        .any(|prefix| lower.contains(prefix))
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use super::{
        classify_unreachable, is_private_lan_ip, is_usable_interface, same_subnet_24,
        select_lan_ipv4, ReachabilityReason,
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
}
