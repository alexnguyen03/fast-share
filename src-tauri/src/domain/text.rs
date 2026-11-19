use super::error::HostError;

pub const MAX_TEXT_BYTES: usize = 1024 * 1024;

/// Text must have visible content, fit the cap, and carry no NUL (it would truncate the OS clipboard).
pub fn validate_text(text: &str) -> Result<(), HostError> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(HostError::TextTooLarge);
    }
    if text.trim().is_empty() || text.contains('\0') {
        return Err(HostError::InvalidText);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_text_and_rejects_empty_nul_and_oversized() {
        assert_eq!(validate_text("hello"), Ok(()));
        assert_eq!(validate_text("  \n"), Err(HostError::InvalidText));
        assert_eq!(validate_text("a\0b"), Err(HostError::InvalidText));
        assert_eq!(
            validate_text(&"a".repeat(MAX_TEXT_BYTES + 1)),
            Err(HostError::TextTooLarge)
        );
        assert_eq!(validate_text(&"a".repeat(MAX_TEXT_BYTES)), Ok(()));
    }
}
