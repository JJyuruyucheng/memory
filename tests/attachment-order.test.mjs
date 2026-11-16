import test from 'node:test';
import assert from 'node:assert/strict';
import { planAttachmentOrder, resolveAttachmentOrder } from '../src/attachment-order.js';

const kept = [{ id: 'a', trusted: 1 }, { id: 'b', trusted: 2 }];

test('mixed saved/upload attachment order resolves trusted identities without mutating caller data', () => {
  const uploaded = [{ id: 'upload-0' }, { id: 'upload-1' }];
  const requested = [{ fileIndex: 1 }, { id: 'b' }, { fileIndex: 0 }, { id: 'a' }];
  const plan = planAttachmentOrder(kept, 2, requested);
  requested[0].fileIndex = 0;
  const ordered = resolveAttachmentOrder(plan, kept, uploaded);
  assert.deepEqual(ordered.map(value => value.id), ['upload-1', 'b', 'upload-0', 'a']);
  assert.equal(ordered[1], kept[1]);
  assert.deepEqual(kept.map(value => value.id), ['a', 'b']);
  assert.deepEqual(planAttachmentOrder(kept, 2), [{ id: 'a' }, { id: 'b' }, { fileIndex: 0 }, { fileIndex: 1 }]);
});

test('ordering rejects duplicate, missing, removed or cross-entry identities and forged positions', () => {
  for (const requested of [
    null, {}, [], [{ id: 'a' }], [{ id: 'a' }, { id: 'a' }, { fileIndex: 0 }],
    [{ id: 'a' }, { id: 'other-entry' }, { fileIndex: 0 }],
    [{ id: 'a' }, { id: 'b' }, { fileIndex: -1 }],
    [{ id: 'a' }, { id: 'b' }, { fileIndex: 1 }],
    [{ id: 'a' }, { id: 'b' }, { fileIndex: '0' }],
    [{ id: 'a', position: 0 }, { id: 'b' }, { fileIndex: 0 }],
    [{ id: 'a' }, { id: 'b' }, { fileIndex: 0, id: 'a' }],
    [{ id: 'a' }, { id: 'b' }, new Array(1)],
    [{ id: 'a' }, { id: 'b' }, Object.create({ fileIndex: 0 })],
    new Array(3),
  ]) assert.throws(() => planAttachmentOrder(kept, 1, requested), error => error.code === 'VALIDATION');
});
