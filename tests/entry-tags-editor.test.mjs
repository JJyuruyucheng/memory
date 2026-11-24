import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEntryTags } from '../src/domain.js';
import { entryTagsMarkup, mountEntryTags } from '../src/entry-tags-editor.js';

function editorFixture(tags) {
  const element = () => ({
    dataset: {}, listeners: new Map(), attributes: new Map(), hidden: false,
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  });
  const input = Object.assign(element(), {
    value: '', selectionStart: 0, selectionEnd: 0,
    setCustomValidity(value) { this.validationMessage = value; },
    reportValidity() { return !this.validationMessage; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    focus() {},
  });
  const buttons = tags.map(tag => Object.assign(element(), { dataset: { suggestTag: tag } }));
  const library = { children: buttons, append(...children) { this.children = children; } };
  const chips = { innerHTML: '' }, label = { textContent: '' };
  const nodes = { '#entry-tag-text': input, '.entry-tag-chips': chips, '#entry-tag-error': element(),
    '.entry-tag-suggestions': library, '#entry-tag-library-label': label };
  const root = Object.assign(element(), {
    querySelector(selector) { return nodes[selector] || null; },
    querySelectorAll(selector) { return selector === '[data-suggest-tag]' ? buttons : []; },
  });
  return {
    root, input, chips, label, buttons,
    visible: () => library.children.filter(button => !button.hidden).map(button => button.dataset.suggestTag),
    query(value) { input.value = value; input.listeners.get('input')({ isComposing: false }); },
    click(tag) { root.listeners.get('click')({ target: { closest: () => buttons.find(button => button.dataset.suggestTag === tag) } }); },
  };
}

function popularTags() {
  return collectEntryTags(Array.from({ length: 4 }, (_, index) => ({
    id: `record-${index}`, authorId: 'a', status: 'published', type: 'note', deletedAt: null,
    occurredAt: '2026-11-01', tags: ['夜晚旅行', ...(index < 3 ? ['旅行'] : []),
      ...(index < 2 ? ['旅行日记'] : []), ...(index < 1 ? ['徒步'] : [])],
  })), { id: 'a', role: 'member' });
}

test('composer existing badges keep record-popularity order without sorting already selected tags', () => {
  const suggestions = popularTags();
  assert.deepEqual(suggestions, ['夜晚旅行', '旅行', '旅行日记', '徒步']);
  const markup = entryTagsMarkup(suggestions);
  assert.deepEqual([...markup.matchAll(/data-suggest-tag="([^"]+)"/gu)].map(match => match[1]), suggestions);
  const fixture = editorFixture(suggestions);
  const selected = ['徒步', '旅行日记'];
  const editor = mountEntryTags(fixture.root, { tags: selected, onChange() {} });
  assert.deepEqual(fixture.visible(), suggestions);
  assert.deepEqual(editor.draft(), { tags: selected, tagText: '' });
  assert.ok(fixture.chips.innerHTML.indexOf('编辑标签：徒步') < fixture.chips.innerHTML.indexOf('编辑标签：旅行日记'));
  assert.deepEqual(editor.validatedTags(), selected);
});

test('composer query still prioritizes exact then prefix matches, restores popularity order and appends selected tags', () => {
  const suggestions = popularTags(), fixture = editorFixture(suggestions);
  const editor = mountEntryTags(fixture.root, { tags: ['后选', '先选'], onChange() {} });
  fixture.query('旅行');
  assert.deepEqual(fixture.visible(), ['旅行', '旅行日记', '夜晚旅行']);
  assert.deepEqual(editor.draft(), { tags: ['后选', '先选'], tagText: '旅行' });
  assert.equal(fixture.label.textContent, '匹配标签');
  fixture.click('旅行');
  assert.deepEqual(editor.draft(), { tags: ['后选', '先选', '旅行'], tagText: '' });
  assert.deepEqual(fixture.visible(), suggestions);
  assert.equal(fixture.buttons.find(button => button.dataset.suggestTag === '旅行').attributes.get('aria-pressed'), 'true');
  fixture.query('旅行');
  assert.deepEqual(fixture.visible(), ['旅行日记', '夜晚旅行']);
  fixture.query('没有这个标签');
  assert.deepEqual(fixture.visible(), []);
  assert.equal(fixture.label.textContent, '没有匹配标签');
  fixture.query('');
  assert.deepEqual(fixture.visible(), suggestions);
  assert.deepEqual(editor.draft().tags, ['后选', '先选', '旅行']);
});
