use chrono::{DateTime, Duration, Utc};

use crate::domain::{validate_name, DeviceId, DeviceTrust, HostError, PhoneRecord};
use crate::ports::{Clock, Store};

#[derive(Clone, Debug)]
pub struct PairingTicket {
    pub token: String,
    pub code: String,
    pub expires_at: DateTime<Utc>,
    pub used: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PairOutcome {
    Pending { poll_token: String },
    Trusted { secret: Option<String> },
    Rejected,
}

fn six_digit_code(seed: &uuid::Uuid) -> String {
    let bytes = seed.as_bytes();
    let num = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 900_000 + 100_000;
    format!("{num:06}")
}

pub fn issue_ticket(clock: &impl Clock) -> PairingTicket {
    let token_uuid = uuid::Uuid::new_v4();
    let code_uuid = uuid::Uuid::new_v4();
    PairingTicket {
        token: token_uuid.to_string(),
        code: six_digit_code(&code_uuid),
        expires_at: clock.now() + Duration::minutes(10),
        used: false,
    }
}

pub fn submit_pair_code(
    store: &mut impl Store,
    ticket: &mut PairingTicket,
    code: &str,
    device_id: DeviceId,
    name: &str,
    now: DateTime<Utc>,
) -> Result<PairOutcome, HostError> {
    let trimmed = code.trim();
    if trimmed.len() != 6 || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err(HostError::PairingExpired);
    }
    if ticket.used || ticket.code != trimmed || ticket.expires_at <= now {
        return Err(HostError::PairingExpired);
    }
    let token = ticket.token.clone();
    submit_pair(store, ticket, &token, device_id, name, now)
}

pub fn submit_pair(
    store: &mut impl Store,
    ticket: &mut PairingTicket,
    token: &str,
    device_id: DeviceId,
    name: &str,
    now: DateTime<Utc>,
) -> Result<PairOutcome, HostError> {
    validate_name(name)?;
    if ticket.used || ticket.token != token || ticket.expires_at <= now {
        return Err(HostError::PairingExpired);
    }

    if let Some(existing) = store.get_phone(&device_id)? {
        if existing.trust == DeviceTrust::Trusted {
            return Ok(PairOutcome::Trusted { secret: None });
        }
    }

    ticket.used = true;
    let poll_token = uuid::Uuid::new_v4().to_string();
    store.upsert_phone(PhoneRecord {
        id: device_id,
        name: name.trim().to_string(),
        trust: DeviceTrust::PendingAcceptance,
        secret: None,
        poll_token: Some(poll_token.clone()),
    })?;
    Ok(PairOutcome::Pending { poll_token })
}

pub fn pair_status(
    store: &mut impl Store,
    device_id: &DeviceId,
    poll_token: &str,
) -> Result<PairOutcome, HostError> {
    let mut phone = store.get_phone(device_id)?.ok_or(HostError::UnknownPhone)?;
    if phone.poll_token.as_deref() != Some(poll_token) {
        return Err(HostError::UnknownPhone);
    }
    match phone.trust {
        DeviceTrust::PendingAcceptance => Ok(PairOutcome::Pending {
            poll_token: poll_token.to_string(),
        }),
        DeviceTrust::Trusted => {
            let secret = phone.secret.clone().ok_or(HostError::NotTrusted)?;
            phone.poll_token = None;
            store.upsert_phone(phone)?;
            Ok(PairOutcome::Trusted {
                secret: Some(secret),
            })
        }
        DeviceTrust::Forgotten | DeviceTrust::Unknown => Ok(PairOutcome::Rejected),
    }
}

pub fn accept_device(store: &mut impl Store, device_id: &DeviceId) -> Result<String, HostError> {
    let mut phone = store.get_phone(device_id)?.ok_or(HostError::UnknownPhone)?;
    if phone.trust != DeviceTrust::PendingAcceptance {
        return Err(HostError::NotTrusted);
    }
    let secret = uuid::Uuid::new_v4().to_string();
    phone.trust = DeviceTrust::Trusted;
    phone.secret = Some(secret.clone());
    store.upsert_phone(phone)?;
    Ok(secret)
}

pub fn reject_device(store: &mut impl Store, device_id: &DeviceId) -> Result<(), HostError> {
    mark_forgotten(store, device_id)
}

pub fn forget_device(store: &mut impl Store, device_id: &DeviceId) -> Result<(), HostError> {
    mark_forgotten(store, device_id)
}

fn mark_forgotten(store: &mut impl Store, device_id: &DeviceId) -> Result<(), HostError> {
    let mut phone = store.get_phone(device_id)?.ok_or(HostError::UnknownPhone)?;
    phone.trust = DeviceTrust::Forgotten;
    phone.secret = None;
    phone.poll_token = None;
    store.upsert_phone(phone)?;
    Ok(())
}
