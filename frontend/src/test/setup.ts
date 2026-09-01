import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

import { deleteDB } from 'idb';
import { beforeEach } from 'vitest';

beforeEach(async () => {
  await deleteDB('BaannoiPOS');
});
