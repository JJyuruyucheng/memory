import { MAX_AVATAR_JPEG_LENGTH, validAvatarJpeg } from './profile.js';

export const LOGIN_PHOTO_LIMITS = Object.freeze({ maxInputBytes: 15_000_000, maxOutputBytes: 5_000_000, maxPixels: 50_000_000, maxEdge: 1920 });
const invalid = message => { const error = new Error(message); error.code = 'VALIDATION'; return error; };

// Check actual raster headers before decoding. SVG/GIF/HTML and MIME spoofing do
// not enter the canvas. No source filename or metadata is copied to the output.
export function inspectLoginPhoto(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) throw invalid('图片不完整，请重新选择。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let mime, width, height;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) && String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR') {
    mime = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mime = 'image/jpeg'; let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid('JPEG 图片格式无效。');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    mime = 'image/webp';
    const kind = String.fromCharCode(...bytes.slice(12, 16));
    if (kind === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383;
    } else if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 47) {
      const bits = view.getUint32(21, true); width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383);
    }
  }
  if (!mime || !width || !height || width > 16000 || height > 16000 || width * height > LOGIN_PHOTO_LIMITS.maxPixels) throw invalid('请选择有效的 JPG、PNG 或 WebP 照片，像素过大的图片请先缩小。');
  return { mime, width, height };
}

function loadImage(blob) {
  if (typeof globalThis.createImageBitmap === 'function') return createImageBitmap(blob, { imageOrientation: 'from-image' });
  return new Promise((resolve, reject) => {
    const image = new Image(), url = URL.createObjectURL(blob);
    const timer = setTimeout(() => { URL.revokeObjectURL(url); image.src = ''; reject(invalid('图片读取超时，请重试。')); }, 20_000);
    const clear = () => { clearTimeout(timer); URL.revokeObjectURL(url); };
    image.onload = () => { clear(); resolve(image); };
    image.onerror = () => { clear(); reject(invalid('无法读取这张图片，请重新选择。')); };
    image.src = url;
  });
}

async function decodePhoto(file, decode) {
  if (!(file instanceof Blob) || !file.size || file.size > LOGIN_PHOTO_LIMITS.maxInputBytes) throw invalid('请选择不超过 15 MB 的照片。');
  const bytes = new Uint8Array(await file.arrayBuffer()), source = inspectLoginPhoto(bytes);
  if (file.type && file.type !== source.mime) throw invalid('图片格式与文件内容不符，请重新选择。');
  return decode(new Blob([bytes], { type: source.mime }));
}

const encodeJpeg = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(invalid('照片优化失败，请换一张重试。')), 'image/jpeg', quality);
});

export async function prepareLoginPhoto(file, { decode = loadImage, createCanvas = () => document.createElement('canvas'), randomId = () => crypto.randomUUID() } = {}) {
  const bitmap = await decodePhoto(file, decode);
  const canvas = createCanvas();
  try {
    const width = bitmap.width || bitmap.naturalWidth, height = bitmap.height || bitmap.naturalHeight;
    if (!width || !height || width * height > LOGIN_PHOTO_LIMITS.maxPixels) throw invalid('图片尺寸无法读取。');
    const ratio = Math.min(1, LOGIN_PHOTO_LIMITS.maxEdge / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d'); if (!context) throw invalid('浏览器暂时无法处理照片。');
    context.fillStyle = '#f7f8f5'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await encodeJpeg(canvas, .86);
    if (blob.size > 1_500_000) blob = await encodeJpeg(canvas, .72);
    if (!blob.size || blob.size > LOGIN_PHOTO_LIMITS.maxOutputBytes || blob.type !== 'image/jpeg') throw invalid('照片优化后仍过大，请先缩小图片。');
    return new File([blob], `login-photo-${randomId()}.jpg`, { type: 'image/jpeg' });
  } finally { bitmap.close?.(); canvas.width = 1; canvas.height = 1; }
}

export async function prepareProfileAvatar(file) {
  const bitmap = await decodePhoto(file, loadImage);
  const canvas = document.createElement('canvas');
  try {
    const width = bitmap.width || bitmap.naturalWidth;
    const height = bitmap.height || bitmap.naturalHeight;
    const square = Math.min(width, height);
    if (!square || width * height > LOGIN_PHOTO_LIMITS.maxPixels) throw invalid('图片尺寸无法读取。');
    const edge = Math.min(square, 256);
    canvas.width = edge; canvas.height = edge;
    const context = canvas.getContext('2d');
    if (!context) throw invalid('浏览器暂时无法处理头像。');
    context.fillStyle = '#f7f8f5'; context.fillRect(0, 0, edge, edge);
    context.drawImage(bitmap, (width - square) / 2, (height - square) / 2, square, square, 0, 0, edge, edge);
    const maxBytes = MAX_AVATAR_JPEG_LENGTH * 3 / 4;
    let jpeg = await encodeJpeg(canvas, .86);
    if (jpeg.size > maxBytes) jpeg = await encodeJpeg(canvas, .65);
    if (jpeg.size > maxBytes || jpeg.type !== 'image/jpeg') throw invalid('头像过大，请换一张照片。');
    const base64 = btoa(String.fromCharCode(...new Uint8Array(await jpeg.arrayBuffer())));
    if (!validAvatarJpeg(base64)) throw invalid('无法生成头像，请换一张照片。');
    return base64;
  } finally { bitmap.close?.(); canvas.width = 1; canvas.height = 1; }
}
