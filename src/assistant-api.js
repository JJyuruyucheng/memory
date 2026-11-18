import { ARTICLE_SLUG, ASSISTANT_PATH, MAX_REPLY_LENGTH, MODEL_ID } from './assistant-contract.js';

const SOURCE_LINK = /^#timeline\?entry=[A-Za-z0-9_-]{1,96}$/;
const WEATHER_LINKS = new Set(['https://open-meteo.com/', 'https://creativecommons.org/licenses/by/4.0/']);

export async function requestAssistant(token, payload, signal) {
  const method = payload ? 'POST' : 'GET';
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  if (payload) headers['Content-Type'] = 'application/json';
  const response = await fetch(ASSISTANT_PATH, {
    method, headers, signal, cache: 'no-store', redirect: 'error',
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 404 ? '当前站点尚未启用 AI 助手。' : '助手暂时无法连接，请重试。';
    const error = new Error(typeof value?.error?.message === 'string' ? value.error.message.slice(0, 160) : message);
    error.status = response.status;
    throw error;
  }
  if (!payload && Array.isArray(value?.articleSlugs)) {
    return { articleSlugs: value.articleSlugs.filter(slug => typeof slug === 'string' && ARTICLE_SLUG.test(slug)),
      models: (Array.isArray(value.models) ? value.models : []).filter(model => typeof model === 'string' && MODEL_ID.test(model)),
      defaultModel: typeof value.defaultModel === 'string' && MODEL_ID.test(value.defaultModel) ? value.defaultModel : '' };
  }
  if (typeof value?.reply !== 'string' || !value.reply.trim()) throw new Error('助手暂时没有返回文字，请重试。');
  const sources = Array.isArray(value.sources) ? value.sources.filter(source => typeof source?.title === 'string'
    && typeof source.href === 'string' && (SOURCE_LINK.test(source.href) || WEATHER_LINKS.has(source.href))).slice(0, 3) : [];
  return { reply: value.reply.slice(0, MAX_REPLY_LENGTH), sources, incomplete: value.incomplete === true };
}
