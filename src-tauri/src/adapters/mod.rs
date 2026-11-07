mod cert;
mod fs_store;
mod lan;
mod mdns;
mod os_clipboard;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod os_drag;
mod os_notifier;
pub mod phone_client;
pub mod shared_images;

pub use cert::{fingerprint, load_or_create, write_private_bytes, HostCert};
pub use fs_store::FsStore;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use lan::is_mouse_button_down;
pub use lan::{
    allow_in_firewall, classify_unreachable, firewall_warning, lan_ipv4, set_os_auto_start,
    ReachabilityReason,
};
pub use mdns::{advertise, browse_hosts, DiscoveredHost};
pub use os_clipboard::OsClipboard;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use os_drag::{start_native_file_drag, warm_drag_thumbnail_async};
pub use os_notifier::OsNotifier;
