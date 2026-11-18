import { escapeHtml as esc } from './domain.js';
import { icon } from './icons.js';
import { prepareProfileAvatar } from './login-photo-image.js';
import { mountLoginVerification } from './login-controller.js';
import { MAX_PROFILE_NAME } from './profile.js';

export function profileEditorMarkup(user, avatar, canChangePassword) {
  return `<h2>个人资料</h2>
    <form id="profile-form">
      <div class="profile-picture-row"><div class="profile-avatar-preview">${avatar(user)}</div>
        <div class="profile-picture-actions">
          <label class="secondary profile-photo-picker">${icon('photo')}<span>更换头像</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="更换头像" /></label>
          <button type="button" class="text-button profile-photo-reset" ${user.avatarJpeg ? '' : 'hidden'}>恢复默认头像</button>
        </div>
      </div>
      <label>展示昵称<input name="name" value="${esc(user.name)}" maxlength="${MAX_PROFILE_NAME}" autocomplete="nickname" required /></label>
      <p class="form-error" role="alert"></p>
      <button class="primary profile-save" type="submit">${icon('check')}保存资料</button>
    </form>
    ${canChangePassword ? `<details class="profile-password">
      <summary>${icon('lock')}更改登录密码 ${icon('down', 'profile-password-chevron')}</summary>
      <form id="profile-password-form">
        <label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" maxlength="256" required /></label>
        <label>新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="256" required /></label>
        <label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" maxlength="256" required /></label>
        <div class="profile-verification"><div id="login-captcha"></div>
          <p id="verification-status" role="status"></p>
          <button type="button" id="verification-retry" class="text-button" hidden>重新加载验证</button>
        </div>
        <p class="form-error" role="alert"></p>
        <div class="profile-password-actions"><small>更新后请用新密码重新登录。</small>
          <button type="submit" class="primary" disabled>更新密码</button></div>
      </form>
    </details>` : ''}`;
}

export function mountProfileEditor(root, { user, avatar, saveProfile, changePassword, getConfig, onSaved, onPasswordSaved }) {
  const controller = new AbortController();
  const events = { signal: controller.signal };
  const form = root.querySelector('#profile-form');
  const name = form.elements.name;
  const preview = form.querySelector('.profile-avatar-preview');
  const picker = form.querySelector('input[type=file]');
  const remove = form.querySelector('.profile-photo-reset');
  const save = form.querySelector('[type=submit]');
  const error = form.querySelector('.form-error');
  const details = root.querySelector('.profile-password');
  const passwordForm = root.querySelector('#profile-password-form');
  const update = passwordForm?.querySelector('[type=submit]');
  let selected, preparing = false, busy = false, selection = 0, verification;

  function drawAvatar() {
    const jpeg = selected === undefined ? user.avatarJpeg : selected;
    preview.innerHTML = avatar({ ...user, name: name.value.trim() || user.name, avatarJpeg: jpeg });
    remove.hidden = !jpeg;
  }
  name.addEventListener('input', drawAvatar, events);
  remove.addEventListener('click', () => {
    if (busy) return;
    selection++; preparing = false; save.disabled = false;
    selected = null; error.textContent = ''; drawAvatar();
  }, events);
  picker.addEventListener('change', async () => {
    const file = picker.files[0]; picker.value = '';
    if (!file || busy) return;
    const request = ++selection;
    preparing = true; save.disabled = true; error.textContent = '';
    try {
      const jpeg = await prepareProfileAvatar(file);
      if (request === selection && !controller.signal.aborted) { selected = jpeg; drawAvatar(); }
    } catch (failure) {
      if (request === selection && !controller.signal.aborted) error.textContent = failure.message || '头像无法读取，请换一张。';
    } finally {
      if (request === selection && !controller.signal.aborted) { preparing = false; save.disabled = busy; }
    }
  }, events);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || preparing) return;
    busy = true; save.disabled = true; error.textContent = '';
    try {
      await saveProfile({ name: name.value, avatarJpeg: selected });
      if (!controller.signal.aborted) onSaved();
    } catch (failure) {
      if (!controller.signal.aborted) error.textContent = failure.message || '资料未能保存，请重试。';
    } finally {
      busy = false; save.disabled = preparing;
      if (update && verification?.getToken()) update.disabled = false;
    }
  }, events);

  if (passwordForm) {
    const passwordError = passwordForm.querySelector('.form-error');
    details.addEventListener('toggle', () => {
      if (details.open) {
        verification ||= mountLoginVerification(root, {
          form: passwordForm, isBusy: () => busy, getConfig, busyMessage: '正在更新密码，请稍候…',
          size: passwordForm.querySelector('#login-captcha').clientWidth < 300 ? 'compact' : 'flexible',
        });
      } else if (!busy) {
        verification?.destroy(); verification = null;
        passwordForm.reset(); passwordError.textContent = ''; update.disabled = true;
      }
    }, events);
    details.querySelector('summary').addEventListener('click', event => { if (busy) event.preventDefault(); }, events);
    passwordForm.addEventListener('submit', async event => {
      event.preventDefault();
      const captchaToken = verification?.getToken();
      if (busy || !captchaToken) return;
      const { currentPassword, newPassword, confirmPassword } = Object.fromEntries(new FormData(passwordForm));
      if (newPassword !== confirmPassword) { passwordError.textContent = '请确认两次输入的新密码一致。'; return; }
      busy = true; update.disabled = true; save.disabled = true; passwordError.textContent = '';
      passwordForm.reset();
      try {
        await changePassword({ currentPassword, newPassword, captchaToken });
        if (!controller.signal.aborted) await onPasswordSaved();
      } catch (failure) {
        if (!controller.signal.aborted) passwordError.textContent = failure.message || '暂时无法更新密码，请重试。';
      } finally {
        busy = false; save.disabled = preparing;
        verification?.reset();
      }
    }, events);
  }
  return {
    get isSaving() { return busy; },
    destroy() { controller.abort(); verification?.destroy(); passwordForm?.reset(); },
  };
}
