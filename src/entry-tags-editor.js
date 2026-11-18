import { escapeHtml as esc, MAX_ENTRY_TAGS, MAX_TAG_LENGTH } from './domain.js';
import { icon } from './icons.js';

const separators = /[,，]/;
const tagFromText = value => value.trim().replace(/^[#＃]+\s*/, '');

export function entryTagsMarkup(suggestions) {
  return `<section class="editor-tags" aria-labelledby="entry-tags-label">
    <div class="entry-tag-heading"><label id="entry-tags-label" for="entry-tag-text">小标签</label><span>必填</span></div>
    <div class="entry-tag-field">
      <span class="entry-tag-chips"></span>
      <input type="text" id="entry-tag-text" placeholder="输入标签，用逗号分隔" autocomplete="off"
        enterkeyhint="done" maxlength="${MAX_ENTRY_TAGS * (MAX_TAG_LENGTH + 2)}" aria-describedby="entry-tag-help entry-tag-error" required />
    </div>
    <span class="sr-only" id="entry-tag-help">输入逗号添加标签，在标签后按退格可继续编辑。</span>
    <p id="entry-tag-error" class="entry-tag-error" role="status" hidden></p>
    ${suggestions.length ? `<div class="entry-tag-library">
      <p id="entry-tag-library-label">已有标签</p>
      <div class="entry-tag-suggestions" role="group" aria-labelledby="entry-tag-library-label">
        ${suggestions.map(tag => `<button type="button" class="tag-filter" data-suggest-tag="${esc(tag)}" aria-pressed="false">#${esc(tag)}</button>`).join('')}
      </div>
    </div>` : ''}
  </section>`;
}

export function mountEntryTags(root, { tags = [], tagText = '', onChange }) {
  const input = root.querySelector('#entry-tag-text');
  const chips = root.querySelector('.entry-tag-chips');
  const error = root.querySelector('#entry-tag-error');
  const suggestions = root.querySelectorAll('[data-suggest-tag]');
  const savedTags = Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string') : [];
  let committed = [...new Set(savedTags.map(tag => tag.trim()).filter(Boolean))];
  let showError = false;
  input.value = typeof tagText === 'string' ? tagText : '';

  function add(values) {
    committed = [...new Set([...committed, ...values.map(tagFromText).filter(Boolean)])];
  }

  function renderChips() {
    chips.innerHTML = committed.map((tag, index) => `<span class="entry-tag-chip">
      <button type="button" data-edit-tag="${index}" aria-label="编辑标签：${esc(tag)}">#${esc(tag)}</button>
      <button type="button" data-remove-tag="${index}" aria-label="移除标签：${esc(tag)}">${icon('close')}</button>
    </span>`).join('');
    const current = new Set(committed);
    for (const button of suggestions) button.setAttribute('aria-pressed', String(current.has(button.dataset.suggestTag)));
  }

  function values() {
    return [...new Set([...committed, ...input.value.split(separators).map(tagFromText).filter(Boolean)])];
  }

  function updateValidity() {
    const current = values();
    let message = '';
    if (!current.length) message = '请添加至少一个小标签。';
    else if (current.length > MAX_ENTRY_TAGS) message = `每条记录最多 ${MAX_ENTRY_TAGS} 个小标签。`;
    else if (current.some(tag => tag.length > MAX_TAG_LENGTH)) message = `每个小标签最多 ${MAX_TAG_LENGTH} 个字符。`;
    input.required = !committed.length;
    input.setCustomValidity(message);
    error.hidden = !showError || !message;
    error.textContent = error.hidden ? '' : message;
    if (error.hidden) input.removeAttribute('aria-invalid');
    else input.setAttribute('aria-invalid', 'true');
    return current;
  }

  function changed(chipsChanged = true) {
    if (chipsChanged) renderChips();
    updateValidity();
    onChange();
  }

  function acceptSeparators() {
    const parts = input.value.split(separators);
    const pending = parts.pop();
    if (parts.length) {
      const caret = Math.max(0, input.selectionStart - (input.value.length - pending.length));
      add(parts);
      input.value = pending;
      input.setSelectionRange(caret, caret);
    }
    changed(parts.length > 0);
  }

  function editTag(index, suffix = '') {
    const [tag] = committed.splice(index, 1);
    input.value = tag + suffix;
    changed();
    input.focus({ preventScroll: true });
    input.setSelectionRange(tag.length, tag.length);
  }

  function deleteSeparator(event) {
    if (event.isComposing || !event.cancelable || !committed.length || input.selectionStart !== 0 || input.selectionEnd !== 0) return;
    event.preventDefault();
    editTag(committed.length - 1, input.value);
  }

  input.addEventListener('input', event => { if (!event.isComposing) acceptSeparators(); });
  input.addEventListener('compositionend', acceptSeparators);
  input.addEventListener('beforeinput', event => { if (event.inputType === 'deleteContentBackward') deleteSeparator(event); });
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Backspace') deleteSeparator(event);
    if (event.key === 'Enter') {
      event.preventDefault();
      add(input.value.split(separators));
      input.value = '';
      changed();
    }
  });
  input.addEventListener('invalid', () => { showError = true; updateValidity(); });

  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.suggestTag !== undefined) {
      const tag = button.dataset.suggestTag;
      const index = committed.indexOf(tag);
      if (index === -1) committed.push(tag);
      else committed.splice(index, 1);
      const pending = tagFromText(input.value);
      if (pending === tag || (index === -1 && tag.startsWith(pending))) input.value = '';
      changed();
    } else if (button.dataset.editTag !== undefined) {
      add(input.value.split(separators));
      editTag(Number(button.dataset.editTag));
    } else if (button.dataset.removeTag !== undefined) {
      committed.splice(Number(button.dataset.removeTag), 1);
      changed();
      input.focus({ preventScroll: true });
    }
  });

  renderChips();
  updateValidity();
  return {
    draft: () => ({ tags: [...committed], tagText: input.value }),
    validatedTags() {
      const current = updateValidity();
      return input.reportValidity() ? current : null;
    },
  };
}
