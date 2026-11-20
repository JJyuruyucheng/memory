import { inspectLoginPhoto } from './login-photo-image.js';

const errors = {
  POINTS_SOLD_OUT: '这件商品已兑完。',
  POINTS_LOW_BALANCE: '可用积分不足。',
  POINTS_CHANGED: '商品信息刚更新，请刷新后确认。',
  POINTS_CHECKIN_EARLY: '请继续在前台停留至签到完成。',
  POINTS_CHECKIN_EXPIRED: '签到计时已更新，请再停留一分钟。',
  POINTS_UNAVAILABLE: '这项操作暂时不可用，请刷新核对。',
  POINTS_REQUEST_CONFLICT: '这次请求已处理，请先查看背包。',
  POINTS_INVALID_PRODUCT: '请核对名称、售价、库存和封面。',
  POINTS_INVALID_CHALLENGE: '请核对挑战标题和奖励分。',
  POINTS_INVALID_REQUEST: '排序未保存，请重新加载商品。',
};

export function pointsError(message) {
  const code = typeof message === 'string' && message.match(/^POINTS_[A-Z_]+$/u)?.[0];
  return code && errors[code] ? Object.assign(new Error(errors[code]), { code }) : null;
}

async function prepareCover(file) {
  if (!file?.size || file.size > 10_000_000) throw new Error('请选择 10 MB 以内的 JPG、PNG 或 WebP。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime } = inspectLoginPhoto(bytes);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f7f4e9';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    for (const quality of [0.86, 0.7, 0.55]) {
      const cover = canvas.toDataURL('image/webp', quality);
      if (cover.startsWith('data:image/webp;base64,') && cover.length <= 240_023) return cover;
    }
    throw new Error('封面压缩失败，请换一张图片。');
  } finally { bitmap.close(); }
}

export function makePointsProvider(rpc, checkAdmin) {
  return {
    pointsSummary: () => rpc('points_summary'),
    pointsCatalog: () => rpc('points_catalog'),
    pointsBackpack: () => rpc('points_backpack'),
    pointsNotifications: () => rpc('points_notifications'),
    pointsReadNotifications: (ids = null) => rpc('points_read_notifications', { p_ids: ids }, true),
    pointsBeginCheckin: () => rpc('points_begin_checkin', {}, true),
    pointsFinishCheckin: token => rpc('points_finish_checkin', { p_token: token }, true),
    pointsRedeem: (productId, version, requestId) => rpc('points_redeem', { p_product_id: productId, p_version: version, p_request_id: requestId }, true),
    pointsUse: id => rpc('points_use', { p_order_id: id }, true),
    pointsConfirmMemory: id => rpc('points_confirm_memory', { p_entry_id: id }, true),
    pointsConfirmChallenge: id => rpc('points_confirm_challenge', { p_challenge_id: id }, true),
    pointsAdminCatalog: () => rpc('points_admin_catalog'),
    pointsAdminReorder: ids => rpc('points_admin_reorder_products', { p_product_ids: ids }, true),
    pointsAdminOrders: () => rpc('points_admin_orders'),
    pointsAdminChallenges: () => rpc('points_admin_challenges'),
    pointsAdminSaveProduct: product => rpc('points_admin_save_product', {
      p_product_id: product.id || null, p_version: product.version ?? null, p_name: product.name,
      p_description: product.description, p_price: product.price, p_stock: product.stock,
      p_cover: product.cover || null, p_active: product.active,
    }, true),
    pointsAdminCreateChallenge: challenge => rpc('points_admin_create_challenge', {
      p_title: challenge.title, p_description: challenge.description, p_reward: challenge.reward,
    }, true),
    async pointsUploadCover(file) {
      const admin = checkAdmin(), cover = await prepareCover(file);
      if (admin !== checkAdmin()) throw new Error('账号已切换，请重新打开商品编辑页。');
      return cover;
    },
  };
}
