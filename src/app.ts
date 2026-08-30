/**
 * 拾光 · 家庭美容院 —— 路由表（Hono）。
 * - /api/agents/shiguang：agent 的 HTTP 面（createAgentRouter）
 * - /：Web 聊天页（vite dev 下由 indexHtmlMiddleware 提供页面源码）
 */
import { Hono } from 'hono';
import { createAgentRouter } from '@flue/runtime/routing';
import { Shiguang } from './agents/shiguang';
import { registerProviders } from './providers';
import indexHtml from './web/index.html?raw';

// 构建裁剪保险：agent 模块已注册，这里再调一次（幂等）。
registerProviders();

const app = new Hono();

app.get('/health', (c) => c.json({ service: 'shiguang', status: 'ok', tagline: '你家楼下 24 小时不打烊的家庭美容院' }));

app.route('/api/agents/shiguang', createAgentRouter(Shiguang));

// 聊天页：根路径与 /index.html 都返回前端页面。
app.get('/', (c) => c.html(indexHtml));
app.get('/index.html', (c) => c.html(indexHtml));

export default app;
