use chrono::{DateTime, Duration, Utc};

use crate::domain::{validate_name, DeviceId, DeviceTrust, HostError, PhoneRecord};
use crate::ports::{Clock, Store};

/// Pending requests older than this are dropped, so an unanswered request cannot linger.
const REQUEST_TTL_MINUTES: i64 = 2;
/// At most this many requests may wait for the user at once.
const MAX_PENDING: usize = 5;

#[derive(Clone, Debug)]
pub struct PairingTicket {
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub used: bool,
}

pub fn issue_ticket(clock: &impl Clock) -> PairingTicket {
    PairingTicket {
        token: uuid::Uuid::new_v4().to_string(),
        expires_at: clock.now() + Duration::minutes(10),
        used: false,
    }
}

/// A phone with an unknown key asks to be trusted. With a QR token (mode A) the key is vouched
/// for by the QR; without one (mode B) the user must compare `sas` on both screens.
/// Returns the phone's id. An already trusted key returns immediately.
pub fn request_pairing(
    store: &mut impl Store,
    ticket: &mut PairingTicket,
    token: Option<&str>,
    public_key: &[u8],
    name: &str,
    sas: &str,
    now: DateTime<Utc>,
) -> Result<DeviceId, HostError> {
    validate_name(name)?;
    let device_id = DeviceId::from_public_key(public_key);
    let key_text = base64_key(public_key);
    if let Some(existing) = store.get_phone(&device_id)? {
        if existing.trust == DeviceTrust::Trusted && existing.public_key.as_deref() == Some(&key_text)
        {
            return Ok(device_id);
        }
    }
    if let Some(token) = token {
        if ticket.used || ticket.token != token || ticket.expires_at <= now {
            return Err(HostError::PairingExpired);
        }
    }
    expire_requests(store, now)?;
    let pending = store
        .list_phones()?
        .iter()
        .filter(|phone| phone.trust == DeviceTrust::PendingAcceptance && phone.id != device_id)
        .count();
    if pending >= MAX_PENDING {
        return Err(HostError::Busy);
    }
    if token.is_some() {
        ticket.used = true;
    }
    store.upsert_phone(PhoneRecord {
        id: device_id.clone(),
        name: name.trim().to_string(),
        trust: DeviceTrust::PendingAcceptance,
        public_key: Some(key_text),
        sas: token.is_none().then(|| sas.to_string()),
        requested_at: Some(now),
    })?;
    Ok(device_id)
}

fn expire_requests(store: &mut impl Store, now: DateTime<Utc>) -> Result<(), HostError> {
    for phone in store.list_phones()? {
        let stale = phone.trust == DeviceTrust::PendingAcceptance
            && phone
                .requested_at
                .map_or(true, |at| at + Duration::minutes(REQUEST_TTL_MINUTES) <= now);
        if stale {
            mark_forgotten(store, &phone.id)?;
        }
    }
    Ok(())
}

pub fn base64_key(public_key: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(public_key)
}

pub fn accept_device(store: &mut impl Store, device_id: &DeviceId) -> Result<(), HostError> {
    let mut phone = store.get_phone(device_id)?.ok_or(HostError::UnknownPhone)?;
    if phone.trust != DeviceTrust::PendingAcceptance {
        return Err(HostError::NotTrusted);
    }
    phone.trust = DeviceTrust::Trusted;
    phone.sas = None;
    store.upsert_phone(phone)
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
    phone.public_key = None;
    phone.sas = None;
    store.upsert_phone(phone)?;
    Ok(())
}
