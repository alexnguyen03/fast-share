use crate::domain::{HostError, ImageId};
use crate::ports::{Clipboard, Store};

pub fn copy_image(
    store: &impl Store,
    clipboard: &impl Clipboard,
    image_id: &ImageId,
) -> Result<(), HostError> {
    let batches = store.list_batches()?;
    let file_name = batches
        .iter()
        .flat_map(|batch| batch.images.iter())
        .find(|image| &image.id == image_id)
        .map(|image| image.file_name.clone())
        .ok_or(HostError::NotFound)?;
    let png = store.read_image(&file_name)?;
    clipboard.write_png(&png)?;
    Ok(())
}
