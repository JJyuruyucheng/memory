export const MAX_PROFILE_NAME = 60;
export const MAX_AVATAR_JPEG_LENGTH = 65536;

export function validAvatarJpeg(value) {
  return typeof value === 'string' && value.length <= MAX_AVATAR_JPEG_LENGTH
    && value.length % 4 === 0 && /^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export function avatarImageUrl(jpeg) {
  return validAvatarJpeg(jpeg) ? `data:image/jpeg;base64,${jpeg}` : '';
}
