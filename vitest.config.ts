import { defineConfig } from 'vitest/config';

// Keep vitest inside the checkout. Without an explicit exclude the default
// glob walks into `.claude/worktrees/**` (agent worktrees created by the
// harness) and runs every test file four times against one shared Redis.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/.git/**'],
  },
});
