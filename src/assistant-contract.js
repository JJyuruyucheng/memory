export const ASSISTANT_PATH = '/api/assistant';
export const ASSISTANT_NAME = '瓜子';
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_REPLY_LENGTH = 12000;
export const MAX_HISTORY_LENGTH = 9;
export const MAX_HISTORY_CHARS = 12000;
export const ARTICLE_SLUG = /^[A-Za-z0-9_-]{1,96}$/;

export function requestHistory(transcript, current) {
  const messages = [{ role: 'user', content: current }];
  let length = current.length;
  for (let index = transcript.length - 2; index >= 0 && messages.length + 2 <= MAX_HISTORY_LENGTH; index -= 2) {
    const user = transcript[index], assistant = transcript[index + 1];
    length += user.content.length + assistant.content.length;
    if (length > MAX_HISTORY_CHARS) break;
    messages.unshift({ role: 'user', content: user.content }, { role: 'assistant', content: assistant.content });
  }
  return messages;
}
