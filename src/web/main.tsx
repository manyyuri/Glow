import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFlueAgent } from '@flue/react';
import type { FlueConversationMessage, FlueConversationPart } from '@flue/sdk';
import { DAILY_RITUALS, WEEKLY_RITUALS, type Ritual } from '../rituals';

const LS_KEY = 'shiguang-conversation-id';
const LS_DONE_KEY = 'shiguang-done';

function newConversationId(): string {
  return crypto.randomUUID();
}

function getConversationId(): string {
  let id = localStorage.getItem(LS_KEY);
  if (!id) {
    id = newConversationId();
    localStorage.setItem(LS_KEY, id);
  }
  return id;
}

interface LocalChecklist {
  daily: string[];
  weekly: string[];
}

function loadChecklist(): LocalChecklist {
  try {
    return JSON.parse(localStorage.getItem(LS_DONE_KEY) ?? '{"daily":[],"weekly":[]}');
  } catch {
    return { daily: [], weekly: [] };
  }
}

/** 把 dynamic-tool part 的 output 归一化（兼容 {output} 包络与裸对象）。 */
function toolOutput(part: FlueConversationPart): any {
  if (part.type !== 'dynamic-tool' || part.state !== 'output-available') return undefined;
  const o = part.output as any;
  if (o && typeof o === 'object' && 'output' in o && !Array.isArray(o.output)) return o.output;
  return o;
}

function textOf(part: FlueConversationPart): string | null {
  return part.type === 'text' ? part.text : null;
}

/** 只展示真正聊天气泡：user / assistant，忽略 system 信号与工具过程。 */
function chatMessages(messages: FlueConversationMessage[]) {
  return messages.filter((m) => m.role === 'user' || m.role === 'assistant');
}

/** 从 system 信号里读「老板记得你」文本（tagName = salon-memory）。 */
function salonMemory(messages: FlueConversationMessage[]): string | null {
  for (const msg of messages) {
    if (msg.role !== 'system') continue;
    if (msg.signal?.tagName !== 'salon-memory') continue;
    const text = msg.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as any).text as string)
      .join('')
      .trim();
    if (text) return text;
  }
  return null;
}

function RitualRow({ r, done, disabled, onCheck }: { r: Ritual; done: boolean; disabled: boolean; onCheck: () => void }) {
  return (
    <li className={`ritual-row ${done ? 'done' : ''}`}>
      <span className="ritual-emoji">{r.emoji}</span>
      <span className="ritual-name">{r.name}</span>
      {r.period === 'daily' && r.slot ? <span className="ritual-slot">{slotLabel(r.slot)}</span> : null}
      <button
        className="ritual-check"
        disabled={disabled}
        onClick={onCheck}
        aria-label={`完成${r.name}`}
      >
        {done ? '✓' : '打卡'}
      </button>
    </li>
  );
}

function slotLabel(slot: NonNullable<Ritual['slot']>): string {
  if (slot === 'morning') return '晨间';
  if (slot === 'evening') return '晚间';
  return '';
}

interface ChecklistMirror extends LocalChecklist {
  synced: boolean;
}

function App() {
  const [conversationId, setConversationId] = useState<string>(() => getConversationId());
  const [draft, setDraft] = useState('');
  const [mirror, setMirror] = useState<ChecklistMirror>(() => ({ ...loadChecklist(), synced: false }));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, status, error, sendMessage, refresh } = useFlueAgent({
    url: `/api/agents/shiguang/${conversationId}`,
    live: 'sse',
  });

  // 从 agent 的结构化工具输出同步左侧清单（agent 是唯一状态源）。
  useEffect(() => {
    let nextDaily = mirror.daily;
    let nextWeekly = mirror.weekly;
    let changed = false;
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== 'dynamic-tool' || part.state !== 'output-available') continue;
        const out = toolOutput(part);
        if (!out) continue;
        if (part.toolName === 'complete_ritual' && Array.isArray(out.doneToday)) {
          nextDaily = out.doneToday;
          nextWeekly = Array.isArray(out.doneWeek) ? out.doneWeek : nextWeekly;
          changed = true;
        } else if (part.toolName === 'today_status') {
          if (Array.isArray(out.dailyDone)) {
            nextDaily = out.dailyDone;
            nextWeekly = Array.isArray(out.weeklyDone) ? out.weeklyDone : nextWeekly;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      setMirror((m) => {
        const next = { ...m, daily: nextDaily, weekly: nextWeekly, synced: true };
        try {
          localStorage.setItem(LS_DONE_KEY, JSON.stringify({ daily: nextDaily, weekly: nextWeekly }));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
  }, [messages]);

  // 自动滚动到底部。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const visible = useMemo(() => chatMessages(messages), [messages]);
  const memory = useMemo(() => salonMemory(messages), [messages]);

  function doSend(text: string) {
    const value = text.trim();
    if (!value || status === 'submitted' || status === 'streaming') return;
    setDraft('');
    void sendMessage(value).catch(() => undefined);
  }

  function onCheck(r: Ritual) {
    if (mirror.daily.includes(r.id) || mirror.weekly.includes(r.id)) return;
    const key = r.period === 'daily' ? 'daily' : 'weekly';
    setMirror((m) => {
      const next = { ...m, [key]: [...m[key], r.id] };
      try {
        localStorage.setItem(LS_DONE_KEY, JSON.stringify({ daily: next.daily, weekly: next.weekly }));
      } catch {
        /* ignore */
      }
      return next;
    });
    doSend(`完成 ${r.name}`);
  }

  function newSession() {
    const id = newConversationId();
    localStorage.setItem(LS_KEY, id);
    localStorage.removeItem(LS_DONE_KEY);
    setMirror({ daily: [], weekly: [], synced: false });
    setConversationId(id);
  }

  const busy = status === 'submitted' || status === 'streaming' || status === 'connecting';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">✨</span>
          <div>
            <h1>拾光 · 家庭美容院</h1>
            <p className="tagline">你家楼下 24 小时不打烊的护理陪伴</p>
          </div>
        </div>
        <button className="ghost" onClick={newSession}>
          ＋ 新会话
        </button>
      </header>

      <main className="layout">
        {/* 左栏 · 今日护理清单 */}
        <aside className="panel checklist-panel">
          {memory ? (
            <section className="memory">
              <h2>🧠 老板记得你</h2>
              <pre className="memory-body">{memory.replace(/^老板记得你\n?/, '')}</pre>
            </section>
          ) : null}

          <section>
            <h2>🗓️ 今日护理</h2>
            <ul className="ritual-list">
              {DAILY_RITUALS.map((r) => (
                <RitualRow
                  key={r.id}
                  r={r}
                  done={mirror.daily.includes(r.id)}
                  disabled={busy || mirror.daily.includes(r.id)}
                  onCheck={() => onCheck(r)}
                />
              ))}
            </ul>
          </section>

          <section>
            <h2>🗓️ 本周护理</h2>
            <ul className="ritual-list">
              {WEEKLY_RITUALS.map((r) => (
                <RitualRow
                  key={r.id}
                  r={r}
                  done={mirror.weekly.includes(r.id)}
                  disabled={busy || mirror.weekly.includes(r.id)}
                  onCheck={() => onCheck(r)}
                />
              ))}
            </ul>
          </section>

          <section className="quick">
            <h2>⚡ 快捷动作</h2>
            <div className="quick-grid">
              <button onClick={() => doSend('帮我分析一下今天的皮肤状态，来做个皮肤日志')}>🔍 皮肤分析</button>
              <button onClick={() => doSend('今天进度')}>📊 今日进度</button>
              <button onClick={() => doSend('这周复盘一下')}>🗃️ 本周复盘</button>
              <button
                onClick={() => {
                  setDraft('记一条护理心得：');
                  inputRef.current?.focus();
                }}
              >
                📝 写日记
              </button>
            </div>
          </section>
        </aside>

        {/* 右栏 · 对话区 */}
        <section className="panel chat-panel">
          <div className="chat-head">
            <span className="dot" />
            {conversationId.slice(0, 8)}
            <button className="ghost small" onClick={() => refresh()} title="重新同步">
              ↻
            </button>
          </div>

          <div className="messages" ref={scrollRef} aria-live="polite">
            {visible.length === 0 && (
              <div className="empty">
                <div className="empty-emoji">🧖</div>
                <p>嗨，我是拾光。</p>
                <p>今天想先做哪件事？左边点一下，或者直接跟我说。</p>
              </div>
            )}
            {visible.map((msg, i) => (
              <Bubble key={msg.id ?? i} msg={msg} />
            ))}
            {(status === 'submitted' || status === 'streaming') && (
              <div className="bubble assistant typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            )}
          </div>

          {error ? <div className="error-banner" role="alert">连接出错了：{error.message}。刷新试试。</div> : null}

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              doSend(draft);
            }}
          >
            <textarea
              ref={inputRef}
              id="chat-input"
              name="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="告诉我你现在的状态，比如：洗完脸了 / 想学泡脚 / 今天皮肤有点干…"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              {busy ? '…' : '发送'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}

function Bubble({ msg }: { msg: FlueConversationMessage }) {
  const isUser = msg.role === 'user';
  const parts = msg.parts;
  const text = parts.map(textOf).filter((t): t is string => t !== null).join('');
  if (!text) return null;
  return (
    <div className={`bubble ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && <span className="bubble-avatar">✨</span>}
      <div className="bubble-text">{text}</div>
    </div>
  );
}

// ---------- 样式 ----------

const styles = `
:root {
  --bg: #f4ede1;
  --panel: #fffaf2;
  --panel-2: #fbf3e6;
  --line: #e9dcc8;
  --ink: #4a3f33;
  --muted: #a08d79;
  --accent: #b98a5e;
  --accent-soft: #f0dfc8;
  --user: #e8d8c2;
  --ok: #8a9b6e;
  --shadow: 0 10px 30px rgba(150, 120, 80, 0.12);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
  background: linear-gradient(160deg, #f4ede1 0%, #efe4d2 100%);
  color: var(--ink);
}
#root { height: 100vh; display: flex; flex-direction: column; }
.app { display: flex; flex-direction: column; height: 100vh; max-width: 1200px; margin: 0 auto; width: 100%; }

.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; gap: 12px;
}
.brand { display: flex; align-items: center; gap: 12px; }
.brand-logo { font-size: 30px; }
.brand h1 { margin: 0; font-size: 20px; letter-spacing: 1px; }
.tagline { margin: 2px 0 0; font-size: 12px; color: var(--muted); }

button { cursor: pointer; border: none; font-family: inherit; }
button:disabled { opacity: 0.55; cursor: not-allowed; }
.ghost {
  background: transparent; border: 1px solid var(--line); color: var(--ink);
  border-radius: 999px; padding: 8px 14px; font-size: 13px;
}
.ghost:hover { background: var(--panel); }
.ghost.small { padding: 4px 8px; font-size: 12px; }

.layout {
  flex: 1; display: grid; grid-template-columns: 360px 1fr; gap: 16px;
  padding: 0 20px 20px; min-height: 0;
}
@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; overflow: auto; }
  .chat-panel { min-height: 70vh; }
}

.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 20px;
  box-shadow: var(--shadow); display: flex; flex-direction: column; min-height: 0;
}
.checklist-panel { padding: 18px; gap: 18px; overflow: auto; }
.checklist-panel h2 { margin: 0 0 10px; font-size: 15px; }

.ritual-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ritual-row {
  display: flex; align-items: center; gap: 10px;
  background: var(--panel-2); border-radius: 12px; padding: 8px 10px;
  border: 1px solid transparent;
}
.ritual-row.done { background: #f2efe4; opacity: 0.85; }
.ritual-emoji { font-size: 18px; width: 24px; text-align: center; }
.ritual-name { flex: 1; font-size: 14px; }
.ritual-slot { font-size: 11px; color: var(--muted); }
.ritual-check {
  background: var(--accent); color: #fff; border-radius: 999px;
  padding: 5px 12px; font-size: 12px; min-width: 46px;
}
.ritual-row.done .ritual-check { background: var(--ok); }

.memory { background: var(--accent-soft); border: 1px dashed var(--accent); border-radius: 14px; padding: 12px 14px; }
.memory h2 { margin: 0 0 8px; font-size: 15px; }
.memory-body { margin: 0; white-space: pre-wrap; font-family: inherit; font-size: 13px; line-height: 1.7; color: var(--ink); }

.quick h2 { margin-top: 4px; }
.quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.quick-grid button {
  background: var(--accent-soft); color: var(--ink); border-radius: 12px;
  padding: 10px 8px; font-size: 13px; text-align: left;
}
.quick-grid button:hover { background: #e8d2b2; }

.chat-panel { overflow: hidden; }
.chat-head {
  display: flex; align-items: center; gap: 8px; padding: 12px 18px;
  border-bottom: 1px solid var(--line); font-size: 12px; color: var(--muted);
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }

.messages { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.empty { text-align: center; color: var(--muted); margin: 48px auto; font-size: 14px; }
.empty-emoji { font-size: 44px; margin-bottom: 8px; }

.bubble { display: flex; gap: 8px; max-width: 82%; }
.bubble.user { align-self: flex-end; flex-direction: row-reverse; }
.bubble-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--accent-soft); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.bubble-text {
  padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.65;
  white-space: pre-wrap; word-break: break-word;
}
.bubble.assistant .bubble-text { background: var(--panel-2); border: 1px solid var(--line); border-top-left-radius: 4px; }
.bubble.user .bubble-text { background: var(--user); border-top-right-radius: 4px; }

.bubble.typing { align-self: flex-start; align-items: center; padding: 14px 16px; border-radius: 16px; background: var(--panel-2); border: 1px solid var(--line); gap: 4px; }
.typing-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite; }
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }

.error-banner { margin: 0 18px 10px; padding: 10px 14px; background: #f6dddd; color: #9c3f3f; border-radius: 12px; font-size: 13px; }

.composer {
  display: flex; gap: 10px; padding: 12px 18px 16px; border-top: 1px solid var(--line); align-items: flex-end;
}
.composer textarea {
  flex: 1; resize: none; border: 1px solid var(--line); border-radius: 14px; background: var(--panel-2);
  padding: 10px 12px; font-family: inherit; font-size: 14px; color: var(--ink); outline: none;
}
.composer textarea:focus { border-color: var(--accent); }
.composer button {
  background: var(--accent); color: #fff; border-radius: 14px; padding: 10px 18px; font-size: 14px; height: 42px;
}
.composer button:hover:not(:disabled) { background: #a87a4f; }
`;

function mountStyles() {
  const el = document.createElement('style');
  el.textContent = styles;
  document.head.appendChild(el);
}

mountStyles();
createRoot(document.getElementById('root')!).render(<App />);
