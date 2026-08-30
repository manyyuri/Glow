import { defineConfig } from 'vitest/config';

// 纯函数单测：不加载 vite.config.ts（那里有 flue() 插件，只属于 dev/build）。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
