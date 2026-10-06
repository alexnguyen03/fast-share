use chrono::{DateTime, Utc};

use crate::domain::{BatchId, DeviceId, HostError, ImageId, PhoneRecord, Settings};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRecord {
    pub id: ImageId,
    pub file_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryBatch {
    pub id: BatchId,
    pub phone_id: DeviceId,
    pub phone_name: String,
    pub received_at: DateTime<Utc>,
    pub images: Vec<ImageRecord>,
}

pub trait Store: Send {
    fn load_settings(&self) -> Result<Settings, HostError>;
    fn save_settings(&mut self, settings: &Settings) -> Result<(), HostError>;
    fn get_phone(&self, id: &DeviceId) -> Result<Option<PhoneRecord>, HostError>;
    fn upsert_phone(&mut self, phone: PhoneRecord) -> Result<(), HostError>;
    fn list_phones(&self) -> Result<Vec<PhoneRecord>, HostError>;
    fn put_image(&mut self, file_name: &str, png: &[u8]) -> Result<(), HostError>;
    fn read_image(&self, file_name: &str) -> Result<Vec<u8>, HostError>;
    fn remove_image_file(&mut self, file_name: &str) -> Result<(), HostError>;
    fn insert_batch(&mut self, batch: HistoryBatch) -> Result<(), HostError>;
    fn list_batches(&self) -> Result<Vec<HistoryBatch>, HostError>;
    fn save_batches(&mut self, batches: Vec<HistoryBatch>) -> Result<(), HostError>;
}

#[cfg_attr(not(test), allow(dead_code))]
pub struct MemoryStore {
    pub settings: Settings,
    pub phones: Vec<PhoneRecord>,
    pub batches: Vec<HistoryBatch>,
    pub files: Vec<(String, Vec<u8>)>,
}

#[cfg_attr(not(test), allow(dead_code))]
impl MemoryStore {
    pub fn new() -> Self {
        Self {
            settings: Settings::default(),
            phones: Vec::new(),
            batches: Vec::new(),
            files: Vec::new(),
        }
    }
}

impl Store for MemoryStore {
    fn load_settings(&self) -> Result<Settings, HostError> {
        Ok(self.settings.clone())
    }

    fn save_settings(&mut self, settings: &Settings) -> Result<(), HostError> {
        self.settings = settings.clone();
        Ok(())
    }

    fn get_phone(&self, id: &DeviceId) -> Result<Option<PhoneRecord>, HostError> {
        Ok(self.phones.iter().find(|phone| &phone.id == id).cloned())
    }

    fn upsert_phone(&mut self, phone: PhoneRecord) -> Result<(), HostError> {
        if let Some(existing) = self.phones.iter_mut().find(|item| item.id == phone.id) {
            *existing = phone;
        } else {
            self.phones.push(phone);
        }
        Ok(())
    }

    fn list_phones(&self) -> Result<Vec<PhoneRecord>, HostError> {
        Ok(self.phones.clone())
    }

    fn put_image(&mut self, file_name: &str, png: &[u8]) -> Result<(), HostError> {
        if let Some((_, bytes)) = self.files.iter_mut().find(|(name, _)| name == file_name) {
            *bytes = png.to_vec();
        } else {
            self.files.push((file_name.to_string(), png.to_vec()));
        }
        Ok(())
    }

    fn read_image(&self, file_name: &str) -> Result<Vec<u8>, HostError> {
        self.files
            .iter()
            .find(|(name, _)| name == file_name)
            .map(|(_, bytes)| bytes.clone())
            .ok_or(HostError::NotFound)
    }

    fn remove_image_file(&mut self, file_name: &str) -> Result<(), HostError> {
        self.files.retain(|(name, _)| name != file_name);
        Ok(())
    }

    fn insert_batch(&mut self, batch: HistoryBatch) -> Result<(), HostError> {
        self.batches.push(batch);
        Ok(())
    }

    fn list_batches(&self) -> Result<Vec<HistoryBatch>, HostError> {
        Ok(self.batches.clone())
    }

    fn save_batches(&mut self, batches: Vec<HistoryBatch>) -> Result<(), HostError> {
        self.batches = batches;
        Ok(())
    }
}
