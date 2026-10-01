import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'database',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
