import { api, type Item } from "../../api";
import { deleteOfflineOperation, putOfflineOperation, type OfflineCreateOperation } from "../../offline";

/** Each save keeps one identity through lost responses and attachment retries. */
export async function applyCapture(operation: OfflineCreateOperation): Promise<Item> {
  const response = await api.syncOfflineOperation(operation.id, operation.kind, operation.payload);
  let item = response.result;
  operation.item = item;
  await putOfflineOperation(operation);
  if (operation.imageUrl && !operation.imageApplied) {
    await api.importPhotoFromUrl(item, operation.imageUrl);
    operation.imageApplied = true;
    await putOfflineOperation(operation);
  }
  if (operation.photo && !operation.photoApplied) {
    await api.uploadPhoto(item, operation.photo, operation.photoWidth, operation.photoHeight);
    operation.photoApplied = true;
    await putOfflineOperation(operation);
  }
  if (operation.imageUrl || operation.photo) item = await api.item(item.public_id);
  await deleteOfflineOperation(operation.id);
  if (item.barcode) {
    try {
      await api.queueEnrichment(item);
      await api.runEnrichment();
      const enrichment = await api.enrichment(item);
      for (const candidate of enrichment.candidates.filter((entry) => entry.status === "proposed" && Object.keys(entry.proposed).length > 0)) {
        item = await api.applyEnrichment(candidate.public_id);
      }
    } catch { /* Enrichment is optional; the item and attachments are already saved. */ }
  }
  return item;
}
