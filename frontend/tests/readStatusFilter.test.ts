import assert from 'node:assert/strict';
import test from 'node:test';

import { syncReadStatusChange } from '../src/utils/readStatusFilter.ts';

test('updates locally and reloads after every status change while a read filter is active', async () => {
  let updates = 0;
  let reloads = 0;
  const updateLocal = () => {
    updates += 1;
  };
  const reload = async () => {
    reloads += 1;
  };

  await syncReadStatusChange('unread', updateLocal, reload);
  await syncReadStatusChange('read', updateLocal, reload);

  assert.equal(updates, 2);
  assert.equal(reloads, 2);
});

test('updates locally without reload when all articles are shown', async () => {
  let updates = 0;
  let reloads = 0;

  await syncReadStatusChange(
    'all',
    () => {
      updates += 1;
    },
    async () => {
      reloads += 1;
    },
  );

  assert.equal(updates, 1);
  assert.equal(reloads, 0);
});
