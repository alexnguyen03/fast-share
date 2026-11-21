//! The name of the Wi-Fi network the phone is on. Android reads it in Kotlin (MainActivity),
//! so only iOS lives here. iOS hands the name only to an app with location permission and the
//! Access WiFi Information entitlement; without them it reports no name.

/// `None` when the name is unknown: no permission, not on Wi-Fi, or not a phone.
pub fn wifi_name() -> Option<String> {
    #[cfg(target_os = "ios")]
    {
        ios::wifi_name()
    }
    #[cfg(not(target_os = "ios"))]
    {
        None
    }
}

/// Shows the system location prompt once; later calls do nothing.
pub fn request_wifi_permission() {
    #[cfg(target_os = "ios")]
    ios::request_location();
}

#[cfg(target_os = "ios")]
mod ios {
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    type CFTypeRef = *const c_void;
    type CFIndex = isize;
    const UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CFTypeRef) -> CFIndex;
        fn CFArrayGetValueAtIndex(array: CFTypeRef, index: CFIndex) -> CFTypeRef;
        fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
        fn CFStringCreateWithCString(alloc: CFTypeRef, text: *const c_char, encoding: u32) -> CFTypeRef;
        fn CFStringGetCString(text: CFTypeRef, buffer: *mut c_char, size: CFIndex, encoding: u32) -> bool;
        fn CFRelease(object: CFTypeRef);
    }

    #[link(name = "SystemConfiguration", kind = "framework")]
    extern "C" {
        fn CNCopySupportedInterfaces() -> CFTypeRef;
        fn CNCopyCurrentNetworkInfo(interface: CFTypeRef) -> CFTypeRef;
    }

    // `class!(CLLocationManager)` needs the framework linked into the app.
    #[link(name = "CoreLocation", kind = "framework")]
    extern "C" {}

    pub fn wifi_name() -> Option<String> {
        // SAFETY: plain CoreFoundation calls; every object we copy or create is released once.
        unsafe {
            let interfaces = CNCopySupportedInterfaces();
            if interfaces.is_null() {
                return None;
            }
            let key = CFStringCreateWithCString(std::ptr::null(), c"SSID".as_ptr(), UTF8);
            let mut found = None;
            for index in 0..CFArrayGetCount(interfaces) {
                let info = CNCopyCurrentNetworkInfo(CFArrayGetValueAtIndex(interfaces, index));
                if info.is_null() {
                    continue;
                }
                let ssid = CFDictionaryGetValue(info, key);
                if !ssid.is_null() {
                    let mut buffer = [0 as c_char; 256];
                    if CFStringGetCString(ssid, buffer.as_mut_ptr(), buffer.len() as CFIndex, UTF8) {
                        found = Some(CStr::from_ptr(buffer.as_ptr()).to_string_lossy().into_owned());
                    }
                }
                CFRelease(info);
                if found.is_some() {
                    break;
                }
            }
            CFRelease(key);
            CFRelease(interfaces);
            found.filter(|name| !name.is_empty())
        }
    }

    struct Manager(Retained<AnyObject>);
    // SAFETY: the manager is only created and used on the main thread (see `run_on_main_thread`).
    unsafe impl Send for Manager {}
    unsafe impl Sync for Manager {}

    // The prompt needs a manager that lives on; one for the whole app is enough.
    static MANAGER: OnceLock<Manager> = OnceLock::new();

    pub fn request_location() {
        let manager = MANAGER.get_or_init(|| {
            // SAFETY: `new` returns a retained CLLocationManager.
            Manager(unsafe { msg_send![class!(CLLocationManager), new] })
        });
        // SAFETY: a plain method with no arguments on a live CLLocationManager.
        unsafe {
            let _: () = msg_send![&*manager.0, requestWhenInUseAuthorization];
        }
    }
}
