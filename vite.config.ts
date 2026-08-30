import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { flue } from '@flue/vite';
import react from '@vitejs/plugin-react';

/**
 * flue 的 dev 控制器用 appType: 'custom' 接管所有请求，vite 不会对
 * index.html 走 transformIndexHtml 管线（@vitejs/plugin-react 的
 * react-refresh preamble 也由此注入）。这里加一个在 flue 控制器之前
 * 运行的中间件，把 / 和 /index.html 交给 vite 的 HTML 管线处理，
 * 从而既保留 React Fast Refresh，又避免「can't detect preamble」报错。
 */
function serveWebPage(): Plugin {
  let root = process.cwd();
  return {
    name: 'shiguang:serve-web',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '/').split('?')[0];
        if (url !== '/' && url !== '/index.html') return next();
        try {
          const html = await readFile(path.resolve(root, 'src/web/index.html'), 'utf8');
          const processed = await server.transformIndexHtml('/', html, req.url);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(processed);
        } catch (err) {
          next(err as Error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [serveWebPage(), flue(), react()],
  server: {
    port: 5173,
  },
});
