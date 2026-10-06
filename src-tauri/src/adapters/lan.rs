use std::net::Ipv4Addr;

pub fn lan_ipv4() -> Ipv4Addr {
    if_addrs::get_if_addrs()
        .ok()
        .and_then(|addrs| {
            addrs.into_iter().find_map(|iface| match iface.addr.ip() {
                std::net::IpAddr::V4(ip) if is_usable(ip) => Some(ip),
                _ => None,
            })
        })
        .unwrap_or(Ipv4Addr::LOCALHOST)
}

fn is_usable(ip: Ipv4Addr) -> bool {
    if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast() {
        return false;
    }
    let octets = ip.octets();
    if octets[0] == 172 && octets[1] == 17 {
        return false;
    }
    true
}
