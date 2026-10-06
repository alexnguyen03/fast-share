use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

use crate::adapters::phone_client::{self, remembered_qr};
use crate::domain::{BatchId, DeviceId, DeviceTrust, HostError, ImageId, PcId, MAX_IMAGE_BYTES};
use crate::ports::Store;
use crate::runtime::{qr_png, SharedHost};
use crate::use_cases::{
    accept_device, copy_image, delete_all, delete_image, forget_device, reject_device, update_settings,
};

const APP_GROUP: &str = "group.com.alexnguyen03.fastshare";

fn text_err(error: HostError) -> String {
    error.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhoneView {
    id: String,
    name: String,
    trust: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostStatus {
    ready: bool,
    pc_name: String,
    retention_days: u32,
    qr_png_base64: String,
    pending: Vec<PhoneView>,
    trusted_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageView {
    id: String,
    png_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchView {
    id: String,
    phone_name: String,
    received_at: String,
    images: Vec<ImageView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DestinationView {
    pc_id: String,
    name: String,
    online: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairView {
    status: String,
}

#[tauri::command]
pub(crate) fn surface() -> &'static str {
    if cfg!(any(target_os = "ios", target_os = "android")) {
        "phone"
    } else {
        "desktop"
    }
}

#[tauri::command]
pub(crate) fn host_status(state: tauri::State<'_, SharedHost>) -> Result<HostStatus, String> {
    let mut host = state.lock().map_err(text_err)?;
    let settings = host.store.load_settings().map_err(text_err)?;
    let phones = host.store.list_phones().map_err(text_err)?;
    let payload = host.qr_payload().map_err(text_err)?;
    let png = qr_png(&payload).map_err(text_err)?;
    let pending = phones
        .iter()
        .filter(|phone| phone.trust == DeviceTrust::PendingAcceptance)
        .map(phone_view)
        .collect();
    let trusted_count = phones
        .iter()
        .filter(|phone| phone.trust == DeviceTrust::Trusted)
        .count();
    Ok(HostStatus {
        ready: true,
        pc_name: settings.pc_display_name,
        retention_days: settings.history_retention_days,
        qr_png_base64: base64::engine::general_purpose::STANDARD.encode(png),
        pending,
        trusted_count,
    })
}

#[tauri::command]
pub(crate) fn list_phones(state: tauri::State<'_, SharedHost>) -> Result<Vec<PhoneView>, String> {
    let host = state.lock().map_err(text_err)?;
    let phones = host.store.list_phones().map_err(text_err)?;
    Ok(phones
        .iter()
        .filter(|phone| phone.trust != DeviceTrust::Unknown)
        .map(phone_view)
        .collect())
}

#[tauri::command]
pub(crate) fn accept_phone(state: tauri::State<'_, SharedHost>, device_id: String) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = DeviceId::parse(device_id).map_err(text_err)?;
    accept_device(&mut host.store, &id).map(|_| ()).map_err(text_err)
}

#[tauri::command]
pub(crate) fn reject_phone(state: tauri::State<'_, SharedHost>, device_id: String) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = DeviceId::parse(device_id).map_err(text_err)?;
    reject_device(&mut host.store, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn forget_phone(state: tauri::State<'_, SharedHost>, device_id: String) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = DeviceId::parse(device_id).map_err(text_err)?;
    forget_device(&mut host.store, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn list_history(state: tauri::State<'_, SharedHost>) -> Result<Vec<BatchView>, String> {
    let host = state.lock().map_err(text_err)?;
    let mut batches = host.store.list_batches().map_err(text_err)?;
    batches.sort_by(|left, right| right.received_at.cmp(&left.received_at));
    let mut views = Vec::new();
    for batch in batches {
        let mut images = Vec::new();
        for image in batch.images {
            let png = host.store.read_image(&image.file_name).map_err(text_err)?;
            images.push(ImageView {
                id: image.id.as_str().to_string(),
                png_base64: base64::engine::general_purpose::STANDARD.encode(png),
            });
        }
        views.push(BatchView {
            id: batch.id.as_str().to_string(),
            phone_name: batch.phone_name,
            received_at: batch.received_at.to_rfc3339(),
            images,
        });
    }
    Ok(views)
}

#[tauri::command]
pub(crate) fn copy_history_image(state: tauri::State<'_, SharedHost>, image_id: String) -> Result<(), String> {
    let host = state.lock().map_err(text_err)?;
    let id = ImageId::parse(image_id).map_err(text_err)?;
    copy_image(&host.store, &host.clipboard, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn open_history_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedHost>,
    image_id: String,
) -> Result<(), String> {
    let host = state.lock().map_err(text_err)?;
    let id = ImageId::parse(image_id).map_err(text_err)?;
    let batches = host.store.list_batches().map_err(text_err)?;
    let file_name = batches
        .iter()
        .flat_map(|batch| batch.images.iter())
        .find(|image| image.id == id)
        .map(|image| image.file_name.clone())
        .ok_or_else(|| HostError::NotFound.to_string())?;
    let path = host.store.image_file(&file_name).map_err(text_err)?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_history_image(state: tauri::State<'_, SharedHost>, image_id: String) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = ImageId::parse(image_id).map_err(text_err)?;
    delete_image(&mut host.store, &id).map_err(text_err)
}

#[tauri::command]
pub(crate) fn delete_history(state: tauri::State<'_, SharedHost>) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    delete_all(&mut host.store).map_err(text_err)
}

#[tauri::command]
pub(crate) fn get_settings(state: tauri::State<'_, SharedHost>) -> Result<crate::domain::Settings, String> {
    let host = state.lock().map_err(text_err)?;
    host.store.load_settings().map_err(text_err)
}

#[tauri::command]
pub(crate) fn update_host_settings(state: tauri::State<'_, SharedHost>, patch: String) -> Result<crate::domain::Settings, String> {
    let mut host = state.lock().map_err(text_err)?;
    update_settings(&mut host.store, &patch, chrono::Utc::now()).map_err(text_err)
}

#[tauri::command]
pub(crate) fn phone_identity(state: tauri::State<'_, SharedHost>) -> Result<PhoneIdentityView, String> {
    let host = state.lock().map_err(text_err)?;
    Ok(PhoneIdentityView {
        device_id: host.phone.device_id.as_str().to_string(),
        name: host.phone.name.clone(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhoneIdentityView {
    device_id: String,
    name: String,
}

#[tauri::command]
pub(crate) fn set_phone_name(state: tauri::State<'_, SharedHost>, name: String) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    host.set_phone_name(&name).map_err(text_err)
}

#[tauri::command]
pub(crate) fn list_known_pcs(state: tauri::State<'_, SharedHost>) -> Result<Vec<DestinationView>, String> {
    let host = state.lock().map_err(text_err)?;
    Ok(host
        .known_pcs
        .iter()
        .map(|pc| DestinationView {
            pc_id: pc.pc_id.as_str().to_string(),
            name: pc.name.clone(),
            online: false,
        })
        .collect())
}

#[tauri::command]
pub(crate) fn forget_pc(state: tauri::State<'_, SharedHost>, pc_id: String) -> Result<(), String> {
    let mut host = state.lock().map_err(text_err)?;
    let id = PcId::parse(pc_id).map_err(text_err)?;
    host.known_pcs.retain(|pc| pc.pc_id != id);
    host.save_phone_book().map_err(text_err)
}

#[tauri::command]
pub(crate) async fn pair_with_qr(state: tauri::State<'_, SharedHost>, payload: String) -> Result<PairView, String> {
    let (device_id, name) = {
        let host = state.lock().map_err(text_err)?;
        (host.phone.device_id.clone(), host.phone.name.clone())
    };
    let (qr, reply) = phone_client::pair(&payload, &device_id, &name)
        .await
        .map_err(text_err)?;
    let mut host = state.lock().map_err(text_err)?;
    let pc_id = PcId::parse(&qr.pc_id).map_err(text_err)?;
    host.known_pcs.retain(|pc| pc.pc_id != pc_id);
    host.known_pcs.insert(
        0,
        crate::runtime::KnownPc {
            pc_id,
            name: qr.name.clone(),
            host: qr.host.clone(),
            port: qr.port,
            fingerprint: qr.fingerprint.clone(),
            cert_der: qr.cert_der.clone(),
            secret: if reply.status == "trusted" {
                reply.secret.clone()
            } else {
                None
            },
            poll_token: if reply.status == "pending" {
                reply.poll_token.clone()
            } else {
                None
            },
        },
    );
    host.save_phone_book().map_err(text_err)?;
    Ok(PairView { status: reply.status })
}

#[tauri::command]
pub(crate) async fn poll_pair(state: tauri::State<'_, SharedHost>, pc_id: String) -> Result<PairView, String> {
    let (device_id, qr, poll_token) = {
        let host = state.lock().map_err(text_err)?;
        let id = PcId::parse(pc_id).map_err(text_err)?;
        let pc = host
            .known_pcs
            .iter()
            .find(|pc| pc.pc_id == id)
            .ok_or_else(|| HostError::NotFound.to_string())?;
        let poll_token = pc
            .poll_token
            .clone()
            .ok_or_else(|| HostError::NotTrusted.to_string())?;
        let qr = remembered_qr(
            &pc.pc_id,
            &pc.name,
            &pc.host,
            pc.port,
            &pc.fingerprint,
            &pc.cert_der,
        );
        (host.phone.device_id.clone(), qr, poll_token)
    };
    let reply = phone_client::pair_status(&qr, &device_id, &poll_token)
        .await
        .map_err(text_err)?;
    let mut host = state.lock().map_err(text_err)?;
    if let Some(pc) = host.known_pcs.iter_mut().find(|pc| pc.pc_id.as_str() == qr.pc_id) {
        if reply.status == "trusted" {
            pc.secret = reply.secret.clone();
            pc.poll_token = None;
        } else if reply.status == "rejected" {
            pc.secret = None;
            pc.poll_token = None;
        }
    }
    host.save_phone_book().map_err(text_err)?;
    Ok(PairView { status: reply.status })
}

#[tauri::command]
pub(crate) async fn discover_destinations(state: tauri::State<'_, SharedHost>) -> Result<Vec<DestinationView>, String> {
    let ids = tokio::task::spawn_blocking(|| crate::adapters::browse_ids(Duration::from_millis(700)))
        .await
        .unwrap_or_default();
    let pcs = {
        let host = state.lock().map_err(text_err)?;
        host.known_pcs.clone()
    };
    let mut views = Vec::new();
    for pc in pcs {
        let mut online = ids.iter().any(|id| id == pc.pc_id.as_str());
        if !online {
            let qr = remembered_qr(
                &pc.pc_id,
                &pc.name,
                &pc.host,
                pc.port,
                &pc.fingerprint,
                &pc.cert_der,
            );
            online = phone_client::ready(&qr).await;
        }
        views.push(DestinationView {
            pc_id: pc.pc_id.as_str().to_string(),
            name: pc.name,
            online,
        });
    }
    Ok(views)
}

#[tauri::command]
pub(crate) async fn send_batch(
    state: tauri::State<'_, SharedHost>,
    pc_id: String,
    images: Vec<String>,
) -> Result<(), String> {
    if images.is_empty() {
        return Err(HostError::ImageUndecodable.to_string());
    }
    let mut decoded = Vec::new();
    for image in images {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(image.trim())
            .map_err(|_| HostError::ImageUndecodable.to_string())?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(HostError::ImageTooLarge.to_string());
        }
        decoded.push(bytes);
    }
    let (device_id, secret, qr) = {
        let host = state.lock().map_err(text_err)?;
        let id = PcId::parse(pc_id).map_err(text_err)?;
        let pc = host
            .known_pcs
            .iter()
            .find(|pc| pc.pc_id == id)
            .ok_or_else(|| HostError::NotFound.to_string())?;
        let secret = pc
            .secret
            .clone()
            .ok_or_else(|| HostError::NotTrusted.to_string())?;
        let qr = remembered_qr(
            &pc.pc_id,
            &pc.name,
            &pc.host,
            pc.port,
            &pc.fingerprint,
            &pc.cert_der,
        );
        (host.phone.device_id.clone(), secret, qr)
    };
    phone_client::send_batch(&qr, &device_id, &secret, &BatchId::generate(), &decoded)
        .await
        .map_err(text_err)
}

#[tauri::command]
pub(crate) fn take_shared_images(state: tauri::State<'_, SharedHost>) -> Result<Vec<String>, String> {
    let inbox = shared_inbox(&state)?;
    let images = crate::adapters::shared_images::take_inbox(&inbox).map_err(text_err)?;
    Ok(images
        .into_iter()
        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
        .collect())
}

fn shared_inbox(state: &SharedHost) -> Result<std::path::PathBuf, String> {
    if let Some(group) = app_group_dir() {
        return Ok(group.join("incoming"));
    }
    let host = state.lock().map_err(text_err)?;
    Ok(host.data_dir.join("incoming"))
}

fn app_group_dir() -> Option<std::path::PathBuf> {
    crate::adapters::shared_images::ios_app_group(APP_GROUP)
}

pub fn invoke_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        surface,
        host_status,
        list_phones,
        accept_phone,
        reject_phone,
        forget_phone,
        list_history,
        copy_history_image,
        open_history_image,
        delete_history_image,
        delete_history,
        get_settings,
        update_host_settings,
        phone_identity,
        set_phone_name,
        list_known_pcs,
        forget_pc,
        pair_with_qr,
        poll_pair,
        discover_destinations,
        send_batch,
        take_shared_images,
    ]
}

fn phone_view(phone: &crate::domain::PhoneRecord) -> PhoneView {
    let trust = match phone.trust {
        DeviceTrust::Unknown => "unknown",
        DeviceTrust::PendingAcceptance => "pending",
        DeviceTrust::Trusted => "trusted",
        DeviceTrust::Forgotten => "forgotten",
    };
    PhoneView {
        id: phone.id.as_str().to_string(),
        name: phone.name.clone(),
        trust: trust.to_string(),
    }
}
