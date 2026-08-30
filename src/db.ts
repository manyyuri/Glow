/**
 * 拾光 · 家庭美容院 —— SQLite 持久化适配器。
 * 让 vite dev / vite build / flue run 共用同一持久化存储，
 * 服务重启不丢会话与 usePersistentState。
 */
import { sqlite } from '@flue/runtime/node';

export default sqlite('./data/flue.db');
