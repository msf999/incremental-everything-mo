/**
 * FORK (2026-11-15, R-038): which queue a URL belongs to. Run with `npm test`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { queueOfPath } from './queue_url';

describe('queueOfPath', () => {
  it('the daily queue', () => {
    assert.deepEqual(queueOfPath('/flashcards'), { inQueue: true });
    assert.deepEqual(queueOfPath('/flashcards/'), { inQueue: true });
    assert.deepEqual(queueOfPath('https://www.remnote.com/flashcards'), { inQueue: true });
  });
  it("a document's queue, in every mode", () => {
    const doc = { inQueue: true, subQueueId: 'N5DLB9ttUQsYXY0pe' };
    assert.deepEqual(queueOfPath('/flashcards/N5DLB9ttUQsYXY0pe'), doc);
    assert.deepEqual(queueOfPath('/flashcards/N5DLB9ttUQsYXY0pe/'), doc);
    for (const mode of ['all', 'ordered', 'all_no_srs', 'ordered_no_srs', 'need_to_learn']) {
      assert.deepEqual(queueOfPath(`/flashcards/N5DLB9ttUQsYXY0pe/${mode}`), doc);
    }
    assert.deepEqual(queueOfPath('https://www.remnote.com/flashcards/N5DLB9ttUQsYXY0pe?x=1#y'), doc);
  });
  it('anything else is not a queue', () => {
    for (const path of [
      '/flashcards_home',
      '/document/abc',
      '/w/kb/Title-abc',
      '/need_to_learn/exam1/doc1/shuffled',
      '/filtered_queue/kb1',
      '/flashcards/a/b/c',
      '',
    ]) {
      assert.equal(queueOfPath(path).inQueue, false, path);
    }
    assert.equal(queueOfPath(undefined).inQueue, false);
    assert.equal(queueOfPath(null).inQueue, false);
  });
  it('an id that is not valid percent-encoding is kept as it is', () => {
    assert.deepEqual(queueOfPath('/flashcards/a%zz'), { inQueue: true, subQueueId: 'a%zz' });
  });
});
