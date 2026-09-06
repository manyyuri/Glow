import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFlueAgent } from '@flue/react';
import type { FlueConversationMessage, FlueConversationPart } from '@flue/sdk';
import { DAILY_RITUALS, WEEKLY_RITUALS, type DailySlot, type Ritual } from '../rituals';

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

const SLOT_ORDER: DailySlot[] = ['morning', 'any', 'evening'];

function slotLabel(slot: NonNullable<Ritual['slot']>): string {
  if (slot === 'morning') return '晨间';
  if (slot === 'evening') return '晚间';
  return '随时';
}

function slotGroupLabel(slot: DailySlot): string {
  if (slot === 'morning') return '晨间 · Morning';
  if (slot === 'evening') return '晚间 · Evening';
  return '随时 · Anytime';
}

/** 一盏「灯」：打卡即点亮。 */
function RitualRow({ r, done, disabled, onCheck }: { r: Ritual; done: boolean; disabled: boolean; onCheck: () => void }) {
  return (
    <li className={`ritual-row ${done ? 'done' : ''}`}>
      <button
        className="lamp"
        disabled={disabled}
        onClick={onCheck}
        aria-label={done ? `${r.name}已完成` : `完成${r.name}`}
        aria-pressed={done}
      >
        <span className="lamp-flame">{done ? '✓' : ''}</span>
      </button>
      <span className="ritual-name">{r.name}</span>
      {r.period === 'daily' && r.slot ? <span className="ritual-slot">{slotLabel(r.slot)}</span> : null}
      {!done && <span className="ritual-hint">点亮</span>}
    </li>
  );
}

/** 今日进度光环：完成的护理化作一圈暖光。 */
function Halo({ done, total }: { done: number; total: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const ratio = total === 0 ? 0 : done / total;
  return (
    <div className="halo" role="img" aria-label={`今日已完成 ${done} / ${total} 项护理`}>
      <svg viewBox="0 0 80 80" className="halo-svg">
        <circle cx="40" cy="40" r={r} className="halo-track" />
        <circle
          cx="40"
          cy="40"
          r={r}
          className="halo-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
        />
      </svg>
      <div className="halo-center">
        <span className="halo-count">
          {done}
          <span className="halo-total">/{total}</span>
        </span>
        <span className="halo-label">盏灯已点亮</span>
      </div>
    </div>
  );
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
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  const visible = useMemo(() => chatMessages(messages), [messages]);
  const memory = useMemo(() => salonMemory(messages), [messages]);

  const dailyGroups = useMemo(
    () =>
      SLOT_ORDER.map((slot) => ({
        slot,
        items: DAILY_RITUALS.filter((r) => (r.slot ?? 'any') === slot),
      })).filter((g) => g.items.length > 0),
    [],
  );

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
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-text">
            <h1>拾光</h1>
            <p className="tagline">Glow · 家庭美容院，二十四小时为你留灯</p>
          </div>
        </div>
        <button className="ghost" onClick={newSession}>
          ＋ 新会话
        </button>
      </header>

      <main className="layout">
        {/* 左栏 · 护理单 */}
        <aside className="panel checklist-panel">
          <section className="halo-section">
            <Halo done={mirror.daily.length} total={DAILY_RITUALS.length} />
            <div className="halo-side">
              <p className="halo-greeting">
                {greeting}，<br />
                今天也在好好照顾自己。
              </p>
              <p className="halo-sub">
                本周护理 {mirror.weekly.length}/{WEEKLY_RITUALS.length}
              </p>
            </div>
          </section>

          {memory ? (
            <section className="memory">
              <h2>记得你</h2>
              <p className="memory-body">{memory.replace(/^老板记得你\n?/, '')}</p>
            </section>
          ) : null}

          <section>
            <h2 className="section-title">今日护理</h2>
            {dailyGroups.map((g) => (
              <div key={g.slot} className="slot-group">
                <h3 className="slot-label">{slotGroupLabel(g.slot)}</h3>
                <ul className="ritual-list">
                  {g.items.map((r) => (
                    <RitualRow
                      key={r.id}
                      r={r}
                      done={mirror.daily.includes(r.id)}
                      disabled={busy || mirror.daily.includes(r.id)}
                      onCheck={() => onCheck(r)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section>
            <h2 className="section-title">本周护理</h2>
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
            <h2 className="section-title">快捷</h2>
            <div className="quick-grid">
              <button onClick={() => doSend('帮我分析一下今天的皮肤状态，来做个皮肤日志')}>皮肤分析</button>
              <button onClick={() => doSend('今天进度')}>今日进度</button>
              <button onClick={() => doSend('这周复盘一下')}>本周复盘</button>
              <button
                onClick={() => {
                  setDraft('记一条护理心得：');
                  inputRef.current?.focus();
                }}
              >
                写日记
              </button>
            </div>
          </section>
        </aside>

        {/* 右栏 · 对话区 */}
        <section className="panel chat-panel">
          <div className="chat-head">
            <span className="dot" />
            <span className="chat-head-label">{busy ? '拾光正在回复…' : '陪伴中'}</span>
            <button className="ghost small" onClick={() => refresh()} title="重新同步">
              ↻
            </button>
          </div>

          <div className="messages" ref={scrollRef} aria-live="polite">
            {visible.length === 0 && (
              <div className="empty">
                <span className="empty-flame" aria-hidden="true" />
                <p className="empty-title">今晚，先点亮哪一盏灯？</p>
                <p className="empty-sub">左边挑一项护理点亮它，或者直接跟我说说今天的状态。</p>
                <div className="empty-prompts">
                  <button onClick={() => doSend('我刚洗完脸了')}>「我刚洗完脸了」</button>
                  <button onClick={() => doSend('今天皮肤有点干')}>「今天皮肤有点干」</button>
                  <button onClick={() => doSend('教我怎么泡脚')}>「教我怎么泡脚」</button>
                </div>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  doSend(draft);
                }
              }}
              rows={2}
              placeholder="告诉我你现在的状态，比如：洗完脸了 / 想学泡脚 / 今天皮肤有点干…"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              {busy ? '…' : '送出'}
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
      {!isUser && <span className="bubble-avatar" aria-hidden="true" />}
      <div className="bubble-text">{text}</div>
    </div>
  );
}

// ---------- 样式 ----------

const styles = `
:root {
  --bg: #211a15;
  --panel: #2a211b;
  --panel-2: #322821;
  --line: #43362b;
  --hairline: rgba(232, 213, 183, 0.14);
  --ink: #f2e7d7;
  --muted: #a7957f;
  --glow: #e7b26c;
  --glow-deep: #c98c4b;
  --glow-soft: rgba(231, 178, 108, 0.12);
  --user: #4a3a2a;
  --serif: "Songti SC", "STSong", "Noto Serif SC", "SimSun", serif;
  --sans: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
  --radius: 14px;
  --shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: var(--sans);
  background:
    radial-gradient(1100px 700px at 78% -12%, rgba(231, 178, 108, 0.10), transparent 60%),
    radial-gradient(900px 600px at -10% 110%, rgba(201, 140, 75, 0.07), transparent 55%),
    var(--bg);
  background-attachment: fixed;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
#root { height: 100vh; display: flex; flex-direction: column; }
.app { display: flex; flex-direction: column; height: 100vh; max-width: 1240px; margin: 0 auto; width: 100%; }

/* ---------- 顶栏 ---------- */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px 14px; gap: 12px;
}
.brand { display: flex; align-items: center; gap: 14px; }
.brand-mark {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--glow);
  box-shadow: 0 0 14px 4px rgba(231, 178, 108, 0.55);
  animation: breathe 4.5s ease-in-out infinite;
}
.brand h1 {
  margin: 0; font-family: var(--serif); font-weight: 700;
  font-size: 26px; letter-spacing: 10px; line-height: 1;
}
.tagline { margin: 6px 0 0; font-size: 12px; letter-spacing: 1px; color: var(--muted); }

button { cursor: pointer; border: none; font-family: inherit; color: inherit; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--glow); outline-offset: 2px;
}
.ghost {
  background: transparent; border: 1px solid var(--line); color: var(--ink);
  border-radius: 999px; padding: 8px 16px; font-size: 13px;
  transition: border-color 0.2s, background 0.2s;
}
.ghost:hover { border-color: var(--glow-deep); background: var(--glow-soft); }
.ghost.small { padding: 3px 10px; font-size: 12px; }

/* ---------- 布局 ---------- */
.layout {
  flex: 1; display: grid; grid-template-columns: 350px 1fr; gap: 18px;
  padding: 0 24px 22px; min-height: 0;
}
@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; overflow: auto; }
  .chat-panel { min-height: 70vh; }
}

.panel {
  background: var(--panel); border: 1px solid var(--hairline); border-radius: var(--radius);
  box-shadow: var(--shadow); display: flex; flex-direction: column; min-height: 0;
}

/* ---------- 左栏 · 护理单 ---------- */
.checklist-panel { padding: 20px 20px 24px; gap: 22px; overflow: auto; }

.section-title {
  margin: 0 0 6px; font-family: var(--serif); font-size: 15px; font-weight: 700;
  letter-spacing: 4px; color: var(--ink);
  display: flex; align-items: center; gap: 12px;
}
.section-title::after { content: ""; flex: 1; height: 1px; background: var(--hairline); }

.slot-group { margin-top: 10px; }
.slot-label {
  margin: 0 0 2px; font-size: 10px; font-weight: 400;
  letter-spacing: 2.5px; text-transform: uppercase; color: var(--muted);
}

/* 进度光环 */
.halo-section { display: flex; align-items: center; gap: 18px; padding: 4px 2px 0; }
.halo { position: relative; width: 88px; height: 88px; flex-shrink: 0; }
.halo-svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.halo-track { fill: none; stroke: var(--hairline); stroke-width: 3; }
.halo-fill {
  fill: none; stroke: var(--glow); stroke-width: 3; stroke-linecap: round;
  filter: drop-shadow(0 0 5px rgba(231, 178, 108, 0.6));
  transition: stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1);
}
.halo-center {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px;
}
.halo-count { font-family: var(--serif); font-size: 22px; font-weight: 700; color: var(--glow); line-height: 1; }
.halo-total { font-size: 12px; color: var(--muted); font-weight: 400; }
.halo-label { font-size: 9px; letter-spacing: 1.5px; color: var(--muted); }
.halo-greeting { margin: 0; font-family: var(--serif); font-size: 15px; line-height: 1.75; }
.halo-sub { margin: 6px 0 0; font-size: 11px; letter-spacing: 1px; color: var(--muted); }

/* 记得你 · 便签 */
.memory {
  background: var(--glow-soft);
  border-left: 2px solid var(--glow);
  border-radius: 6px; padding: 12px 14px;
}
.memory h2 { margin: 0 0 6px; font-family: var(--serif); font-size: 13px; letter-spacing: 3px; color: var(--glow); }
.memory-body { margin: 0; white-space: pre-wrap; font-size: 13px; line-height: 1.8; color: var(--ink); }

/* 护理行 · 一盏灯 */
.ritual-list { list-style: none; margin: 0; padding: 0; }
.ritual-row {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 6px; border-bottom: 1px solid var(--hairline);
  transition: background 0.2s;
}
.ritual-list .ritual-row:last-child { border-bottom: none; }
.ritual-row:hover { background: rgba(232, 213, 183, 0.04); border-radius: 8px; }

.lamp {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  background: transparent; border: 1.5px solid var(--muted);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: #211a15;
  transition: background 0.25s, border-color 0.25s, box-shadow 0.35s;
}
.ritual-row:hover .lamp:not(:disabled) { border-color: var(--glow); }
.ritual-row.done .lamp {
  background: var(--glow); border-color: var(--glow);
  box-shadow: 0 0 12px 2px rgba(231, 178, 108, 0.45);
}
.lamp-flame { line-height: 1; }

.ritual-name { flex: 1; font-family: var(--serif); font-size: 15px; letter-spacing: 1px; }
.ritual-row.done .ritual-name { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--hairline); text-decoration-thickness: 1px; }
.ritual-slot { font-size: 11px; letter-spacing: 1px; color: var(--muted); }
.ritual-hint {
  font-size: 10px; letter-spacing: 1px; color: var(--glow); opacity: 0;
  transition: opacity 0.2s;
}
.ritual-row:hover .ritual-hint { opacity: 0.9; }

/* 快捷 */
.quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.quick-grid button {
  background: transparent; border: 1px solid var(--hairline); color: var(--ink);
  border-radius: 8px; padding: 10px 12px; font-size: 12.5px; letter-spacing: 1px;
  text-align: left; transition: border-color 0.2s, background 0.2s;
}
.quick-grid button:hover { border-color: var(--glow-deep); background: var(--glow-soft); }

/* ---------- 右栏 · 对话 ---------- */
.chat-panel { overflow: hidden; }
.chat-head {
  display: flex; align-items: center; gap: 8px; padding: 12px 20px;
  border-bottom: 1px solid var(--hairline); font-size: 12px; letter-spacing: 1px; color: var(--muted);
}
.chat-head-label { flex: 1; }
.dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--glow);
  box-shadow: 0 0 8px 2px rgba(231, 178, 108, 0.5);
}

.messages { flex: 1; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 14px; scroll-behavior: smooth; }

/* 空态 */
.empty { text-align: center; margin: auto; padding: 24px 0; }
.empty-flame {
  display: inline-block; width: 14px; height: 14px; border-radius: 50%;
  background: var(--glow); box-shadow: 0 0 22px 8px rgba(231, 178, 108, 0.4);
  animation: breathe 4.5s ease-in-out infinite;
}
.empty-title { margin: 22px 0 0; font-family: var(--serif); font-size: 24px; letter-spacing: 3px; }
.empty-sub { margin: 12px 0 0; font-size: 13px; color: var(--muted); line-height: 1.8; }
.empty-prompts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 22px; }
.empty-prompts button {
  background: transparent; border: 1px solid var(--hairline); color: var(--muted);
  border-radius: 999px; padding: 7px 14px; font-size: 12.5px;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.empty-prompts button:hover { color: var(--glow); border-color: var(--glow-deep); background: var(--glow-soft); }

/* 气泡 */
.bubble { display: flex; gap: 10px; max-width: 82%; animation: rise 0.35s ease both; }
.bubble.user { align-self: flex-end; flex-direction: row-reverse; }
.bubble-avatar {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0; margin-top: 2px;
  background: radial-gradient(circle at 50% 45%, var(--glow) 0 3.5px, var(--glow-soft) 4px);
  border: 1px solid var(--hairline);
}
.bubble-text {
  padding: 11px 15px; border-radius: 12px; font-size: 14px; line-height: 1.75;
  white-space: pre-wrap; word-break: break-word;
}
.bubble.assistant .bubble-text {
  background: var(--panel-2); border: 1px solid var(--hairline); border-top-left-radius: 4px;
}
.bubble.user .bubble-text {
  background: var(--user); border: 1px solid rgba(231, 178, 108, 0.25); border-top-right-radius: 4px;
}

/* 输入中 */
.bubble.typing {
  align-self: flex-start; align-items: center; padding: 15px 18px;
  border-radius: 12px; border-top-left-radius: 4px;
  background: var(--panel-2); border: 1px solid var(--hairline); gap: 5px;
}
.typing-dot {
  width: 5px; height: 5px; border-radius: 50%; background: var(--glow);
  animation: blink 1.3s infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }

.error-banner {
  margin: 0 20px 10px; padding: 10px 14px;
  background: rgba(180, 90, 70, 0.15); color: #e0a08e;
  border: 1px solid rgba(180, 90, 70, 0.35);
  border-radius: 10px; font-size: 13px;
}

/* 输入区 */
.composer {
  display: flex; gap: 10px; padding: 14px 20px 18px;
  border-top: 1px solid var(--hairline); align-items: flex-end;
}
.composer textarea {
  flex: 1; resize: none; border: 1px solid var(--hairline); border-radius: 10px;
  background: var(--panel-2); padding: 11px 13px;
  font-family: inherit; font-size: 14px; line-height: 1.6; color: var(--ink);
  transition: border-color 0.2s;
}
.composer textarea::placeholder { color: var(--muted); opacity: 0.75; }
.composer textarea:focus { outline: none; border-color: var(--glow-deep); }
.composer button {
  background: var(--glow); color: #241b12; border-radius: 10px;
  padding: 0 22px; font-size: 14px; letter-spacing: 2px; height: 42px; font-weight: 600;
  transition: background 0.2s, box-shadow 0.25s;
}
.composer button:hover:not(:disabled) {
  background: #f0c07e;
  box-shadow: 0 0 16px rgba(231, 178, 108, 0.4);
}

/* 滚动条 */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }

/* ---------- 动效 ---------- */
@keyframes breathe {
  0%, 100% { opacity: 1; box-shadow: 0 0 14px 4px rgba(231, 178, 108, 0.55); }
  50% { opacity: 0.75; box-shadow: 0 0 8px 2px rgba(231, 178, 108, 0.3); }
}
@keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .messages { scroll-behavior: auto; }
}
`;

function mountStyles() {
  const el = document.createElement('style');
  el.textContent = styles;
  document.head.appendChild(el);
}

mountStyles();
createRoot(document.getElementById('root')!).render(<App />);
