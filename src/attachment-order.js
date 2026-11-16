const message = '附件顺序无效，请重新排列后保存。';

function invalid() {
  const error = new Error(message); error.code = 'VALIDATION'; return error;
}

/**
 * Saved files are identified only by a retained ID; uploads by their index in
 * saveEntry's files array. The plan must be an exact permutation of both sets.
 * Validate before any upload or write, then resolve only against trusted media.
 */
export function planAttachmentOrder(kept, fileCount, requested) {
  if (!Array.isArray(kept) || !Number.isSafeInteger(fileCount) || fileCount < 0) throw invalid();
  const ids = new Set(kept.map(value => value?.id));
  if (ids.size !== kept.length || [...ids].some(value => typeof value !== 'string' || !value)) throw invalid();
  if (requested === undefined) return [...kept.map(value => ({ id: value.id })), ...Array.from({ length: fileCount }, (_, fileIndex) => ({ fileIndex }))];
  if (!Array.isArray(requested) || requested.length !== kept.length + fileCount) throw invalid();
  const seen = new Set(), plan = [];
  for (const value of requested) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw invalid();
    let key, item;
    if (Object.hasOwn(value, 'id') && typeof value.id === 'string' && ids.has(value.id)) {
      key = `saved:${value.id}`; item = { id: value.id };
    } else if (Object.hasOwn(value, 'fileIndex') && Number.isSafeInteger(value.fileIndex) && value.fileIndex >= 0 && value.fileIndex < fileCount) {
      key = `upload:${value.fileIndex}`; item = { fileIndex: value.fileIndex };
    } else throw invalid();
    if (seen.has(key)) throw invalid();
    seen.add(key); plan.push(item);
  }
  return plan;
}

export function resolveAttachmentOrder(plan, kept, uploaded) {
  if (!Array.isArray(uploaded)) throw invalid();
  const checked = planAttachmentOrder(kept, uploaded.length, plan);
  const byId = new Map(kept.map(value => [value.id, value]));
  return checked.map(value => Object.hasOwn(value, 'id') ? byId.get(value.id) : uploaded[value.fileIndex]);
}
