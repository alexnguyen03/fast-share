use std::fs;
use std::path::{Path, PathBuf};

use crate::domain::{DeviceId, HostError, ImageId, PhoneRecord, Settings};
use crate::ports::{HistoryBatch, Store};

pub struct FsStore {
    root: PathBuf,
}

impl FsStore {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, HostError> {
        let root = root.into();
        fs::create_dir_all(root.join("images")).map_err(|error| HostError::Storage(error.to_string()))?;
        Ok(Self { root })
    }

    fn settings_path(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    fn phones_path(&self) -> PathBuf {
        self.root.join("phones.json")
    }

    fn history_path(&self) -> PathBuf {
        self.root.join("history.json")
    }

    fn image_path(&self, file_name: &str) -> Result<PathBuf, HostError> {
        if !is_generated_name(file_name) {
            return Err(HostError::Storage("rejected image file name".into()));
        }
        let path = self.root.join("images").join(file_name);
        Ok(path)
    }

    pub fn image_file(&self, file_name: &str) -> Result<PathBuf, HostError> {
        self.image_path(file_name)
    }
}

fn is_generated_name(file_name: &str) -> bool {
    if file_name.contains(['/', '\\']) || file_name.matches('.').count() != 1 {
        return false;
    }
    let Some(stem) = file_name
        .strip_prefix("image-")
        .and_then(|value| value.strip_suffix(".png"))
    else {
        return false;
    };
    ImageId::parse(stem).is_ok()
}

impl Store for FsStore {
    fn load_settings(&self) -> Result<Settings, HostError> {
        if !self.settings_path().exists() {
            return Ok(Settings::default());
        }
        let text = fs::read_to_string(self.settings_path())
            .map_err(|error| HostError::Storage(error.to_string()))?;
        crate::domain::settings_from_json(&text)
    }

    fn save_settings(&mut self, settings: &Settings) -> Result<(), HostError> {
        let text = serde_json::to_string_pretty(settings)
            .map_err(|error| HostError::Storage(error.to_string()))?;
        fs::write(self.settings_path(), text).map_err(|error| HostError::Storage(error.to_string()))
    }

    fn get_phone(&self, id: &DeviceId) -> Result<Option<PhoneRecord>, HostError> {
        Ok(self.list_phones()?.into_iter().find(|phone| &phone.id == id))
    }

    fn upsert_phone(&mut self, phone: PhoneRecord) -> Result<(), HostError> {
        let mut phones = self.list_phones()?;
        if let Some(existing) = phones.iter_mut().find(|item| item.id == phone.id) {
            *existing = phone;
        } else {
            phones.push(phone);
        }
        write_json(&self.phones_path(), &phones)
    }

    fn list_phones(&self) -> Result<Vec<PhoneRecord>, HostError> {
        read_json_or_empty(&self.phones_path())
    }

    fn put_image(&mut self, file_name: &str, png: &[u8]) -> Result<(), HostError> {
        let path = self.image_path(file_name)?;
        fs::write(path, png).map_err(|error| HostError::Storage(error.to_string()))
    }

    fn read_image(&self, file_name: &str) -> Result<Vec<u8>, HostError> {
        let path = self.image_path(file_name)?;
        fs::read(path).map_err(|error| HostError::Storage(error.to_string()))
    }

    fn remove_image_file(&mut self, file_name: &str) -> Result<(), HostError> {
        let path = self.image_path(file_name)?;
        if path.exists() {
            fs::remove_file(path).map_err(|error| HostError::Storage(error.to_string()))?;
        }
        Ok(())
    }

    fn insert_batch(&mut self, batch: HistoryBatch) -> Result<(), HostError> {
        let mut batches = self.list_batches()?;
        batches.push(batch);
        write_json(&self.history_path(), &batches)
    }

    fn list_batches(&self) -> Result<Vec<HistoryBatch>, HostError> {
        read_json_or_empty(&self.history_path())
    }

    fn save_batches(&mut self, batches: Vec<HistoryBatch>) -> Result<(), HostError> {
        write_json(&self.history_path(), &batches)
    }
}

fn read_json_or_empty<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Vec<T>, HostError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path).map_err(|error| HostError::Storage(error.to_string()))?;
    serde_json::from_str(&text).map_err(|error| HostError::Storage(error.to_string()))
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), HostError> {
    let text = serde_json::to_string_pretty(value).map_err(|error| HostError::Storage(error.to_string()))?;
    fs::write(path, text).map_err(|error| HostError::Storage(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::FsStore;
    use crate::ports::Store;

    #[test]
    fn client_filenames_never_become_paths() {
        let dir = std::env::temp_dir().join(format!("fast-share-{}", uuid::Uuid::new_v4()));
        let mut store = FsStore::open(&dir).unwrap();
        let error = store.put_image("../secret.png", b"nope").unwrap_err();
        assert!(matches!(error, crate::domain::HostError::Storage(_)));
        assert!(!dir.join("secret.png").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
