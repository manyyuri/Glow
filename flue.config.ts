import { defineConfig } from '@flue/runtime/config';

export default defineConfig({
  target: 'node',
  // 自定义 provider 通过 src/providers.ts 的 setProvider 注册，
  // 不启用任何 pi-ai 内置 provider，加快启动且避免内置 provider 干扰。
  providers: [],
});
