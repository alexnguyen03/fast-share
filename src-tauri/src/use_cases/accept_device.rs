use chrono::{DateTime, Duration, Utc};

use crate::domain::{
    validate_name, DeviceId, DeviceTrust, HostError, PhoneRecord,
};
use crate::ports::{Clock, Store};

#[derive(Clone, Debug)]
pub struct PairingTicket {
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub used: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PairOutcome {
    Pending { poll_token: String },
    Trusted { secret: String },
    Rejected,
}

pub fn issue_ticket(clock: &impl Clock) -> PairingTicket {
    PairingTicket {
        token: uuid::Uuid::new_v4().to_string(),
        expires_at: clock.now() + Duration::minutes(10),
        used: false,
    }
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
    ticket.used = true;

    if let Some(existing) = store.get_phone(&device_id)? {
        if existing.trust == DeviceTrust::Trusted {
            let secret = existing
                .secret
                .clone()
                .ok_or(HostError::NotTrusted)?;
            return Ok(PairOutcome::Trusted { secret });
        }
    }

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
    let mut phone = store
        .get_phone(device_id)?
        .ok_or(HostError::UnknownPhone)?;
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
            Ok(PairOutcome::Trusted { secret })
        }
        DeviceTrust::Forgotten | DeviceTrust::Unknown => Ok(PairOutcome::Rejected),
    }
}

pub fn accept_device(store: &mut impl Store, device_id: &DeviceId) -> Result<String, HostError> {
    let mut phone = store
        .get_phone(device_id)?
        .ok_or(HostError::UnknownPhone)?;
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
    let mut phone = store
        .get_phone(device_id)?
        .ok_or(HostError::UnknownPhone)?;
    phone.trust = DeviceTrust::Forgotten;
    phone.secret = None;
    phone.poll_token = None;
    store.upsert_phone(phone)?;
    Ok(())
}
