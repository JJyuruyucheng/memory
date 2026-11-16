import test from 'node:test';
import assert from 'node:assert/strict';
import { mountLoginVerification } from '../src/login-controller.js';

async function mount(t, { busy = false, renderError } = {}) {
  const previous = globalThis.turnstile;
  const submit = { disabled: true };
  const status = { textContent: '' };
  const retry = { hidden: true, addEventListener() {} };
  const container = {};
  let callbacks;
  const removed = [];
  globalThis.turnstile = {
    render(target, options) { assert.equal(target, container); callbacks = options; if (renderError) options['error-callback'](renderError); return 'widget-fixture'; },
    remove(widget) { removed.push(widget); },
    reset() {},
  };
  const form = { querySelector: selector => selector === '[type="submit"]' ? submit : null };
  const elements = { '#login-form': form, '#verification-status': status, '#verification-retry': retry, '#login-captcha': container };
  const control = mountLoginVerification({ querySelector: selector => elements[selector] }, {
    isBusy: () => busy,
    getConfig: async () => ({ configured: true, siteKey: 'sitekey-fixture-public', action: 'login' }),
  });
  t.after(() => { control.destroy(); if (previous === undefined) delete globalThis.turnstile; else globalThis.turnstile = previous; });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(callbacks);
  return { control, callbacks, submit, status, retry, removed };
}

test('验证码连接错误保留诊断编号并撤销先前通过的 token，不能降级登录', async t => {
  const fixture = await mount(t);
  fixture.callbacks.callback('fixture-success-token');
  assert.equal(fixture.control.getToken(), 'fixture-success-token');
  assert.equal(fixture.submit.disabled, false);
  fixture.callbacks['error-callback']('200500');
  assert.equal(fixture.control.getToken(), '');
  assert.equal(fixture.submit.disabled, true);
  assert.equal(fixture.retry.hidden, false);
  assert.equal(fixture.status.textContent, '安全验证连接失败，请检查网络后重新加载。（错误码：200500）');
});

test('组件初始化时立即报告的连接错误不会被默认提示覆盖', async t => {
  const fixture = await mount(t, { renderError: '200500' });
  assert.match(fixture.status.textContent, /安全验证连接失败.*错误码：200500/);
  assert.equal(fixture.control.getToken(), '');
  assert.equal(fixture.submit.disabled, true);
  assert.equal(fixture.retry.hidden, false);
});

test('配置、挑战失败和设备时间错误与网络错误区分，不误报账号密码错误', async t => {
  const fixture = await mount(t);
  for (const code of ['110100', '110110', '110200', '400020', '400021', '400070']) {
    fixture.callbacks['error-callback'](code);
    assert.match(fixture.status.textContent, /配置异常/);
    assert.ok(fixture.status.textContent.includes(code));
    assert.doesNotMatch(fixture.status.textContent, /网络|密码/);
  }
  for (const code of ['300030', '600010']) {
    fixture.callbacks['error-callback'](code);
    assert.match(fixture.status.textContent, /验证未通过/);
    assert.doesNotMatch(fixture.status.textContent, /网络|密码/);
  }
  fixture.callbacks['error-callback']('200100');
  assert.match(fixture.status.textContent, /设备时间或验证缓存异常/);
});

test('诊断编号只显示有限长度的字母数字，拒绝 HTML、对象和过长的回调数据', async t => {
  const fixture = await mount(t);
  for (const value of ['200500<script>alert(1)</script>', 'code with spaces', 'x'.repeat(100), { secret: 'not-a-code' }, undefined]) {
    fixture.callbacks.callback('fixture-success-token');
    fixture.callbacks['error-callback'](value);
    assert.equal(fixture.status.textContent, '安全验证未通过，请重新加载后重试。');
    assert.equal(fixture.control.getToken(), '');
    assert.equal(fixture.submit.disabled, true);
  }
  fixture.callbacks['error-callback'](200500);
  assert.match(fixture.status.textContent, /错误码：200500/);
  fixture.callbacks['error-callback']('Future123');
  assert.match(fixture.status.textContent, /错误码：Future123/);
});

test('验证过期和交互超时分别提示且都清除 token、禁用登录', async t => {
  const fixture = await mount(t);
  for (const [callback, message] of [['expired-callback', /验证已过期/], ['timeout-callback', /验证操作已超时/]]) {
    fixture.callbacks.callback('fixture-success-token');
    fixture.callbacks[callback]();
    assert.match(fixture.status.textContent, message);
    assert.equal(fixture.control.getToken(), '');
    assert.equal(fixture.submit.disabled, true);
    assert.equal(fixture.retry.hidden, false);
  }
  fixture.callbacks['error-callback']('110600');
  assert.match(fixture.status.textContent, /用时过长.*设备时间/);
  fixture.callbacks['error-callback']('110620');
  assert.match(fixture.status.textContent, /操作已超时/);
});

test('验证码通过仍尊重登录忙碌状态，卸载后旧回调不能恢复 token', async t => {
  const fixture = await mount(t, { busy: true });
  fixture.callbacks.callback('fixture-success-token');
  assert.equal(fixture.submit.disabled, true);
  assert.match(fixture.status.textContent, /正在登录/);
  fixture.control.destroy();
  fixture.callbacks.callback('late-token');
  assert.equal(fixture.control.getToken(), '');
  assert.deepEqual(fixture.removed, ['widget-fixture']);
});
