import assert from 'node:assert/strict';
import test from 'node:test';
import { changePasswordWithVerification } from '../src/supabase-client.js';

const config = { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublishableKey: 'sb_publishable_test' };
const user = { id: 'verified-test-user' };
const input = { email: 'test@example.com', userId: user.id, currentPassword: 'test-current', newPassword: 'test-changed', captchaToken: 'test-captcha' };

function sdkWithLogin(result) {
  const order = [];
  return {
    order,
    createClient(origin, key, options) {
      assert.equal(origin, config.supabaseUrl);
      assert.equal(key, config.supabasePublishableKey);
      assert.equal(options.auth.persistSession, false);
      assert.equal(options.auth.autoRefreshToken, false);
      return { auth: {
        async signInWithPassword(credentials) {
          assert.deepEqual(credentials, { email: input.email, password: input.currentPassword, options: { captchaToken: input.captchaToken } });
          order.push('verify'); return result;
        },
        async updateUser(fields) {
          assert.deepEqual(fields, { password: input.newPassword, current_password: input.currentPassword });
          order.push('update'); return { data: { user }, error: null };
        },
        async signOut(options) { assert.deepEqual(options, { scope: 'local' }); order.push('release'); },
      } };
    },
  };
}

test('验证当前密码与当前账号后才更新密码，并结束临时会话', async () => {
  const sdk = sdkWithLogin({ data: { user, session: {} }, error: null });
  await changePasswordWithVerification(sdk, config, input, () => sdk.order.push('identity'));
  assert.deepEqual(sdk.order, ['verify', 'identity', 'update', 'release']);
});

test('验证失败、账号不符和原会话取消时均不更新密码', async () => {
  for (const [result, expected] of [
    [{ data: null, error: { status: 400 } }, ['verify']],
    [{ data: { user: { id: 'wrong-user' }, session: {} } }, ['verify', 'release']],
  ]) {
    const sdk = sdkWithLogin(result);
    await assert.rejects(changePasswordWithVerification(sdk, config, input, () => assert.fail()), /当前密码或安全验证未通过/);
    assert.deepEqual(sdk.order, expected);
  }
  const sdk = sdkWithLogin({ data: { user, session: {} } });
  await assert.rejects(changePasswordWithVerification(sdk, config, input, () => { throw new Error('session ended'); }), /session ended/);
  assert.deepEqual(sdk.order, ['verify', 'release']);
});
