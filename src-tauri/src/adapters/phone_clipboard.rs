//! Reading the clipboard on iOS straight from UIPasteboard. The web API
//! (navigator.clipboard.readText) makes WebKit show its own "Paste" bubble first, so a tap on
//! the paste button did not drop the text into the field.

/// The clipboard text on iOS (empty when it holds no text); `None` on other platforms, where
/// Android reads it in Kotlin and the desktop never asks.
pub fn read_text() -> Option<String> {
    #[cfg(target_os = "ios")]
    {
        use objc2::rc::Retained;
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        use objc2_foundation::NSString;
        // SAFETY: plain UIKit getters on the shared pasteboard; called on the main thread
        // (synchronous Tauri commands run there).
        unsafe {
            let board: Option<Retained<AnyObject>> = msg_send![class!(UIPasteboard), generalPasteboard];
            let text: Option<Retained<NSString>> = match board {
                Some(board) => msg_send![&*board, string],
                None => None,
            };
            Some(text.map(|value| value.to_string()).unwrap_or_default())
        }
    }
    #[cfg(not(target_os = "ios"))]
    {
        None
    }
}
