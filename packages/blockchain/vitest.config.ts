import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'blockchain',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
