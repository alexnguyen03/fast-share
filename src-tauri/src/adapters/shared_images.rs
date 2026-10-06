use std::fs;
use std::path::{Path, PathBuf};

use crate::domain::HostError;

pub fn take_inbox(inbox: &Path) -> Result<Vec<Vec<u8>>, HostError> {
    let manifest_path = inbox.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&manifest_path).map_err(|error| HostError::Storage(error.to_string()))?;
    let manifest: Manifest =
        serde_json::from_str(&text).map_err(|error| HostError::Storage(error.to_string()))?;
    let mut images = Vec::new();
    for name in manifest.images {
        let path = inbox_file(inbox, &name)?;
        let bytes = fs::read(&path).map_err(|error| HostError::Storage(error.to_string()))?;
        images.push(bytes);
        let _ = fs::remove_file(path);
    }
    let _ = fs::remove_file(manifest_path);
    Ok(images)
}

#[cfg(target_os = "ios")]
pub fn ios_app_group(group: &str) -> Option<PathBuf> {
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSFileManager, NSString};

    let _ = MainThreadMarker::new();
    let manager = NSFileManager::defaultManager();
    let identifier = NSString::from_str(group);
    let url = manager.containerURLForSecurityApplicationGroupIdentifier(&identifier)?;
    let path = url.path()?.to_string();
    Some(PathBuf::from(path))
}

#[cfg(not(target_os = "ios"))]
pub fn ios_app_group(_group: &str) -> Option<PathBuf> {
    None
}

#[derive(serde::Deserialize)]
struct Manifest {
    images: Vec<String>,
}

fn inbox_file(inbox: &Path, name: &str) -> Result<PathBuf, HostError> {
    if name.is_empty()
        || name.contains(['/', '\\'])
        || name.contains("..")
        || !name
            .rsplit_once('.')
            .is_some_and(|(_, ext)| matches!(ext.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp"))
    {
        return Err(HostError::Storage("rejected shared image name".into()));
    }
    let path = inbox.join(name);
    let inbox_root = inbox
        .canonicalize()
        .map_err(|error| HostError::Storage(error.to_string()))?;
    let file = path
        .canonicalize()
        .map_err(|error| HostError::Storage(error.to_string()))?;
    if !file.starts_with(&inbox_root) {
        return Err(HostError::Storage("rejected shared image path".into()));
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::take_inbox;

    #[test]
    fn shared_names_cannot_escape_the_inbox() {
        let dir = std::env::temp_dir().join(format!("fast-share-inbox-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("manifest.json"), r#"{"images":["../secret.png"]}"#).unwrap();
        let error = take_inbox(&dir).unwrap_err();
        assert!(matches!(error, crate::domain::HostError::Storage(_)));
        let _ = std::fs::remove_dir_all(dir);
    }
}
