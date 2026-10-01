import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'indexer',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
