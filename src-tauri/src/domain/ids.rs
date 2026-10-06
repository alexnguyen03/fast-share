use serde::{Deserialize, Serialize};

use super::error::HostError;

fn safe_id(value: &str) -> bool {
    let len = value.len();
    (8..=64).contains(&len)
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn parse(value: impl Into<String>) -> Result<Self, HostError> {
                let value = value.into();
                if safe_id(&value) {
                    Ok(Self(value))
                } else {
                    Err(HostError::InvalidId)
                }
            }

            pub fn generate() -> Self {
                Self(uuid::Uuid::new_v4().to_string())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

id_type!(DeviceId);
id_type!(PcId);
id_type!(BatchId);
id_type!(ImageId);
