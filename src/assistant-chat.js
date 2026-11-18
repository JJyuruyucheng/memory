import { icon } from './icons.js';
import { ARTICLE_SLUG, ASSISTANT_NAME as TITLE, MAX_MESSAGE_LENGTH, requestHistory } from './assistant-contract.js';
import { mountAssistantPosition } from './assistant-position.js';

const WELCOME = `你好，我是${TITLE}。想问这篇文章，还是找点别的内容？`;
const QUESTIONS = ['这篇文章讲了什么？', '这篇文章有哪些值得注意的点？'];
const art = name => `./assets/assistant/tabby-${name}.png`;
const avatar = `<img src="${art('launcher')}" width="74" height="74" alt="" draggable="false" />`;

export function mountAssistant(host, ask) {
  const events = new AbortController();
  const { signal } = events;
  const root = document.createElement('div');
  root.className = 'tabby-assistant';
  root.innerHTML = ask
    ? `<button type="button" class="tabby-launcher" aria-label="打开${TITLE}" aria-controls="tabby-chat" aria-expanded="false" title="${TITLE} · 按住拖动">${avatar}</button>
      <section id="tabby-chat" class="tabby-chat" role="dialog" aria-labelledby="tabby-title" hidden>
        <header class="tabby-header">
          <span class="tabby-avatar">${avatar}</span><h2 id="tabby-title" tabindex="-1">${TITLE}</h2>
          <button type="button" class="tabby-clear" aria-label="清空对话" disabled>${icon('trash')}<span>清空</span></button>
          <button type="button" class="tabby-close" aria-label="关闭对话">${icon('close')}</button>
        </header>
        <div class="tabby-conversation">
          <div class="tabby-empty"><img src="${art('welcome')}" width="110" height="110" alt="" /><p>${WELCOME}</p></div>
          <div class="tabby-quick" aria-label="文章快捷问题" hidden>${QUESTIONS.map(q => `<button type="button">${q}</button>`).join('')}</div>
          <div class="tabby-log" role="log" aria-label="聊天记录"></div>
          <div class="tabby-status" role="status" hidden>
            <img width="42" height="42" alt="" /><span></span><button type="button" class="tabby-retry" hidden>重试</button>
          </div>
        </div>
        <form class="tabby-compose">
          <label class="sr-only" for="tabby-input">消息内容</label>
          <textarea id="tabby-input" rows="1" maxlength="${MAX_MESSAGE_LENGTH}" placeholder="问问${TITLE}…" enterkeyhint="send" autocomplete="off"></textarea>
          <button type="submit" class="tabby-send" disabled>发送${icon('arrow')}</button>
        </form>
      </section>`
    : `<div class="tabby-launcher is-locked" role="img" aria-label="${TITLE}，登录后可用" title="登录后可用">${avatar}<span aria-hidden="true">${icon('lock')}</span></div>`;
  host.append(root);
  const launcher = root.querySelector('.tabby-launcher');
  const panel = root.querySelector('.tabby-chat');
  const layout = mountAssistantPosition(root, launcher, panel, { interactive: Boolean(ask), signal });
  const destroy = () => { events.abort(); root.remove(); };
  layout();
  if (!ask) return { destroy, setContext: layout };

  const heading = root.querySelector('#tabby-title');
  const conversation = root.querySelector('.tabby-conversation');
  const empty = root.querySelector('.tabby-empty');
  const quick = root.querySelector('.tabby-quick');
  const log = root.querySelector('.tabby-log');
  const status = root.querySelector('.tabby-status');
  const retry = root.querySelector('.tabby-retry');
  const clear = root.querySelector('.tabby-clear');
  const form = root.querySelector('.tabby-compose');
  const input = root.querySelector('#tabby-input');
  const send = root.querySelector('.tabby-send');
  const transcript = [];
  let articleSlug = '', articles, loadingArticles, turn, pending;

  function updateControls() {
    quick.hidden = !articles?.has(articleSlug);
    for (const button of quick.children) button.disabled = Boolean(pending);
    clear.disabled = !turn && !transcript.length && !input.value;
    send.disabled = Boolean(pending) || !input.value.trim();
    input.readOnly = Boolean(pending);
    form.setAttribute('aria-busy', String(Boolean(pending)));
  }

  function loadArticles() {
    if (!articleSlug || articles || loadingArticles) return;
    loadingArticles = ask(null, { signal }).then(slugs => {
      articles = new Set(slugs);
      updateControls();
    }).catch(() => {}).finally(() => { loadingArticles = null; });
  }

  function showStatus(kind, message = '') {
    status.hidden = !kind;
    if (!kind) return;
    status.querySelector('img').src = art(kind);
    status.querySelector('span').textContent = message;
    retry.hidden = kind !== 'retry';
  }

  function showMessage(role, content, sources = [], incomplete = false) {
    const row = document.createElement('div');
    row.className = `tabby-message tabby-message-${role}`;
    const text = document.createElement('p');
    text.textContent = content;
    row.append(text);
    if (incomplete) {
      const note = document.createElement('small');
      note.textContent = '回复未完整返回，可以继续追问。';
      row.append(note);
    }
    if (sources.length) {
      const links = document.createElement('ol');
      links.className = 'tabby-sources';
      links.setAttribute('aria-label', '参考文章');
      for (const { title, href } of sources) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = href;
        link.textContent = title;
        item.append(link);
        links.append(item);
      }
      row.append(links);
    }
    log.append(row);
    return row;
  }

  function scrollToLatest() { conversation.scrollTop = conversation.scrollHeight; }

  async function submit(question, contextSlug = articleSlug) {
    question = question.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!question || pending) return;
    const context = articles?.has(contextSlug) ? contextSlug : undefined;
    if (turn?.question !== question || turn?.context !== context) {
      turn?.node.remove();
      turn = { question, context, node: showMessage('user', question) };
    }
    const attempt = new AbortController();
    const attemptSignal = AbortSignal.any([attempt.signal, signal]);
    const messages = requestHistory(transcript, question);
    pending = attempt;
    input.value = question;
    empty.hidden = true;
    showStatus('thinking', '在想这件事…');
    updateControls();
    scrollToLatest();
    try {
      const { reply, sources, incomplete } = await ask({ messages, ...(context ? { articleSlug: context } : {}) }, { signal: attemptSignal });
      if (attemptSignal.aborted || pending !== attempt) return;
      transcript.push({ role: 'user', content: question }, { role: 'assistant', content: reply });
      showMessage('assistant', reply, sources, incomplete);
      input.value = '';
      turn = null;
      showStatus(null);
    } catch (error) {
      if (attemptSignal.aborted || pending !== attempt) return;
      const message = error?.name === 'TimeoutError' ? '等待回复超时，请重试。'
        : error instanceof TypeError ? '网络连接失败，请重试。' : error?.message || '助手暂时无法回复，请重试。';
      showStatus('retry', message);
    } finally {
      if (pending === attempt) { pending = null; updateControls(); scrollToLatest(); }
    }
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus({ preventScroll: true });
  }

  launcher.addEventListener('click', () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    loadArticles();
    layout();
    const mobile = matchMedia('(pointer: coarse), (max-width: 760px)').matches;
    (mobile ? heading : input).focus({ preventScroll: true });
    scrollToLatest();
  }, { signal });
  root.querySelector('.tabby-close').addEventListener('click', close, { signal });
  document.addEventListener('keydown', event => {
    const dialog = document.querySelector('dialog[open]');
    if (event.key !== 'Escape' || panel.hidden || (dialog && !dialog.contains(root))) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, { capture: true, signal });
  input.addEventListener('input', updateControls, { signal });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  }, { signal });
  form.addEventListener('submit', event => { event.preventDefault(); event.stopPropagation(); void submit(input.value); }, { signal });
  for (const button of quick.children) button.addEventListener('click', () => void submit(button.textContent), { signal });
  retry.addEventListener('click', () => { if (turn) void submit(turn.question, turn.context || ''); }, { signal });
  clear.addEventListener('click', () => {
    pending?.abort();
    pending = null;
    turn = null;
    transcript.length = 0;
    log.replaceChildren();
    input.value = '';
    empty.hidden = false;
    empty.querySelector('img').src = art('idle');
    empty.querySelector('p').textContent = '想聊点什么？';
    showStatus(null);
    updateControls();
    input.focus({ preventScroll: true });
    conversation.scrollTop = 0;
  }, { signal });

  return {
    destroy,
    setContext(contextHost, slug) {
      articleSlug = typeof slug === 'string' && ARTICLE_SLUG.test(slug) ? slug : '';
      if (root.parentElement !== contextHost) {
        const focused = root.contains(document.activeElement) && document.activeElement;
        contextHost.append(root);
        focused?.focus?.({ preventScroll: true });
      }
      updateControls();
      if (!panel.hidden) loadArticles();
      layout();
    },
  };
}
