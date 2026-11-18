import { icon } from './icons.js';
import { CONFIG } from './config.js';
import { ARTICLE_SLUG, ASSISTANT_NAME as TITLE, MAX_MESSAGE_LENGTH, requestHistory } from './assistant-contract.js';
import { mountAssistantPosition } from './assistant-position.js';
import { mascotMarkup, mountAssistantMascot, tabbyArt as art } from './assistant-mascot.js';

const WELCOME = `你好，我是${TITLE}。可以问我朝夕里的共享记录，也可以查天气。`;
const QUESTIONS = ['这篇文章讲了什么？', '这篇文章有哪些值得注意的点？'];
const timeLabel = new Intl.DateTimeFormat('zh-CN', { timeZone: CONFIG.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const models = { 'gpt-6.1-terra': 'GPT-6.1 Terra', 'gpt-6.2-sol': 'GPT-6.2 Sol', 'gpt-6-luna': 'GPT-6 Luna', 'gpt-5-mini': 'GPT-5 mini', 'gpt-4.1-mini': 'GPT-4.1 mini' };
const avatar = `<img src="${art('launcher')}" width="74" height="74" alt="" draggable="false" />`;

export function mountAssistant(host, ask) {
  const events = new AbortController();
  const { signal } = events;
  const root = document.createElement('div');
  root.className = 'tabby-assistant';
  const mascot = mascotMarkup();
  root.innerHTML = ask
    ? `<button type="button" class="tabby-launcher" aria-label="打开${TITLE}" aria-controls="tabby-chat" aria-expanded="false" title="${TITLE} · 按住拖动">${mascot}</button>
      <section id="tabby-chat" class="tabby-chat" role="dialog" aria-labelledby="tabby-title" hidden>
        <header class="tabby-header">
          <span class="tabby-avatar">${avatar}</span><h2 id="tabby-title" tabindex="-1">${TITLE}</h2>
          <select class="tabby-model" aria-label="选择模型" title="选择模型" disabled><option value="">默认模型</option></select>
          <button type="button" class="tabby-clear" aria-label="清空对话" disabled>${icon('trash')}<span>清空</span></button>
          <button type="button" class="tabby-close" aria-label="关闭对话">${icon('close')}</button>
        </header>
        <div class="tabby-conversation">
          <div class="tabby-context" hidden><span></span><button type="button" aria-label="取消引用记录">${icon('close')}</button></div>
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
    : `<div class="tabby-launcher is-locked" role="img" aria-label="${TITLE}，登录后可用" title="登录后可用">${mascot}<span class="tabby-lock" aria-hidden="true">${icon('lock')}</span></div>`;
  host.append(root);
  const launcher = root.querySelector('.tabby-launcher');
  const panel = root.querySelector('.tabby-chat');
  const motion = mountAssistantMascot(launcher, signal);
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
  const select = root.querySelector('.tabby-model');
  const reference = root.querySelector('.tabby-context');
  const transcript = [];
  let articleSlug = '', selectedRecord, referenceSlug, options, loadingOptions, turn, pending;
  const currentArticle = () => selectedRecord?.id || articleSlug;

  function updateControls() {
    quick.hidden = !currentArticle();
    reference.hidden = !selectedRecord;
    reference.querySelector('span').textContent = selectedRecord?.title || '';
    for (const button of quick.children) button.disabled = Boolean(pending);
    clear.disabled = !turn && !transcript.length && !input.value;
    send.disabled = Boolean(pending) || !input.value.trim();
    form.setAttribute('aria-busy', String(Boolean(pending)));
  }

  function loadOptions() {
    if (options || loadingOptions) return;
    loadingOptions = ask(null, { signal }).then(data => {
      options = data;
      if (data.models.length) {
        select.replaceChildren(...data.models.map(id => new Option(Object.hasOwn(models, id) ? models[id] : id, id)));
        select.value = data.defaultModel || data.models[0];
        select.title = select.value;
        select.disabled = data.models.length < 2;
      }
    }).catch(() => {}).finally(() => { loadingOptions = null; });
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
        if (href.startsWith('https://')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        item.append(link);
        links.append(item);
      }
      row.append(links);
    }
    const sent = new Date();
    const time = document.createElement('time');
    time.dateTime = sent.toISOString();
    time.textContent = timeLabel.format(sent);
    row.append(time);
    log.append(row);
    return row;
  }

  function scrollToLatest() { conversation.scrollTop = conversation.scrollHeight; }

  async function submit(question, contextSlug = currentArticle(), previous = referenceSlug) {
    question = question.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!question || pending) return;
    const context = ARTICLE_SLUG.test(contextSlug ?? '') ? contextSlug : undefined;
    if (turn?.question !== question || turn?.context !== context) {
      turn?.node.remove();
      turn = { question, context, previous, node: showMessage('user', question) };
    }
    const attempt = new AbortController();
    const attemptSignal = AbortSignal.any([attempt.signal, signal]);
    const messages = requestHistory(transcript, question);
    pending = attempt;
    empty.hidden = true;
    motion.setThinking(true);
    showStatus('thinking', '在想这件事…');
    updateControls();
    scrollToLatest();
    try {
      const { reply, sources, incomplete } = await ask({ messages, articleSlug: context, referenceSlug: previous,
        model: select.value || undefined }, { signal: attemptSignal });
      if (attemptSignal.aborted || pending !== attempt) return;
      transcript.push({ role: 'user', content: question }, { role: 'assistant', content: reply });
      showMessage('assistant', reply, sources, incomplete);
      if (sources.length === 1 && sources[0].href.startsWith('#timeline?entry=')) referenceSlug = sources[0].href.slice(16);
      turn = null;
      showStatus(null);
    } catch (error) {
      if (attemptSignal.aborted || pending !== attempt) return;
      const message = error?.name === 'TimeoutError' ? '等待回复超时，请重试。'
        : error instanceof TypeError ? '网络连接失败，请重试。' : error?.message || '助手暂时无法回复，请重试。';
      showStatus('retry', message);
    } finally {
      if (pending === attempt) {
        pending = null;
        motion.setThinking(false);
        updateControls();
        scrollToLatest();
      }
    }
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus({ preventScroll: true });
  }

  function open() {
    motion.wake();
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    loadOptions();
    layout();
    const mobile = matchMedia('(pointer: coarse), (max-width: 760px)').matches;
    (mobile ? heading : input).focus({ preventScroll: true });
    scrollToLatest();
  }
  launcher.addEventListener('click', () => { if (panel.hidden) open(); else close(); }, { signal });
  select.addEventListener('change', () => { select.title = select.value; }, { signal });
  reference.querySelector('button').addEventListener('click', () => { selectedRecord = null; updateControls(); input.focus(); }, { signal });
  root.querySelector('.tabby-close').addEventListener('click', close, { signal });
  document.addEventListener('keydown', event => {
    const dialog = document.querySelector('dialog[open]');
    if (event.key !== 'Escape' || panel.hidden || (dialog && !dialog.contains(root))) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, { capture: true, signal });
  panel.addEventListener('pointerdown', motion.wake, { signal, passive: true });
  input.addEventListener('input', () => { motion.wake(); updateControls(); }, { signal });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  }, { signal });
  form.addEventListener('submit', event => {
    event.preventDefault();
    event.stopPropagation();
    const question = input.value.trim();
    if (!question || pending) return;
    input.value = '';
    void submit(question);
  }, { signal });
  for (const button of quick.children) button.addEventListener('click', () => void submit(button.textContent), { signal });
  retry.addEventListener('click', () => { if (turn) void submit(turn.question, turn.context || '', turn.previous); }, { signal });
  clear.addEventListener('click', () => {
    pending?.abort();
    pending = null;
    motion.setThinking(false);
    turn = null;
    referenceSlug = undefined;
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
    openForEntry(id, title) {
      if (!ARTICLE_SLUG.test(id)) return;
      selectedRecord = { id, title: title || '当前随记' };
      updateControls();
      open();
    },
    setContext(contextHost, slug) {
      articleSlug = typeof slug === 'string' && ARTICLE_SLUG.test(slug) ? slug : '';
      if (root.parentElement !== contextHost) {
        const focused = root.contains(document.activeElement) && document.activeElement;
        contextHost.append(root);
        focused?.focus?.({ preventScroll: true });
      }
      updateControls();
      if (!panel.hidden) loadOptions();
      layout();
    },
  };
}
