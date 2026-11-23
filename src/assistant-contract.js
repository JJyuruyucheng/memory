export const ASSISTANT_PATH = '/api/assistant';
export const ASSISTANT_NAME = '瓜子';
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_REPLY_LENGTH = 12000;
export const MAX_HISTORY_LENGTH = 9;
export const MAX_HISTORY_CHARS = 12000;
export const ARTICLE_SLUG = /^[A-Za-z0-9_-]{1,96}$/;
export const MODEL_ID = /^[a-z0-9][a-z0-9._:-]{0,100}$/i;
export const ASSISTANT_PAGES = Object.freeze([
  'timeline', 'events', 'album', 'stats', 'favorites', 'anniversaries', 'us',
  'points', 'shop', 'backpack', 'admin', 'shop-admin', 'trash',
]);
export const isAssistantPage = value => typeof value === 'string' && ASSISTANT_PAGES.includes(value);

// Page hints aid navigation; the server still authorizes every data read.
// Never include the DOM, form values, account details or loaded records here.
export function assistantContext({ page, articleSlug, referenceSlug } = {}) {
  return {
    ...(isAssistantPage(page) ? { page } : {}),
    ...(typeof articleSlug === 'string' && ARTICLE_SLUG.test(articleSlug) ? { articleSlug } : {}),
    ...(typeof referenceSlug === 'string' && ARTICLE_SLUG.test(referenceSlug) ? { referenceSlug } : {}),
  };
}

export function requestHistory(transcript, current) {
  const messages = [{ role: 'user', content: current }];
  let length = current.length;
  for (let index = transcript.length - 2; index >= 0 && messages.length + 2 <= MAX_HISTORY_LENGTH; index -= 2) {
    const user = transcript[index], assistant = transcript[index + 1];
    const answer = assistant.citesSharedRecord ? '上一轮引用了共享记录，需按当前可见范围重新查阅。' : assistant.content;
    length += user.content.length + answer.length;
    if (length > MAX_HISTORY_CHARS) break;
    messages.unshift({ role: 'user', content: user.content }, { role: 'assistant', content: answer });
  }
  return messages;
}
