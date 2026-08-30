/**
 * 拾光 · 家庭美容院 —— 纯函数：日期/周滚动、状态汇总、streak 计算。
 * 无副作用、无 IO，便于单测。
 */
import { DAILY_RITUALS, WEEKLY_RITUALS, RITUAL_BY_ID, namesOf } from './rituals';

export interface SkinEntry {
  date: string;
  state: string;
  factors?: string;
  advice?: string;
}

export interface Note {
  date: string;
  text: string;
}

/** 持久化状态模型（usePersistentState 的 'care' key）。 */
export interface CareState {
  /** 当前日期 YYYY-MM-DD（跨天滚动依据） */
  todayKey: string;
  /** 今天已完成的 daily 项目 slug */
  doneToday: string[];
  /** 当前周起始日（周一） */
  weekKey: string;
  /** 本周已完成的 weekly 项目 slug */
  doneWeek: string[];
  /** 历史流水：某天完成过哪些 */
  history: Record<string, string[]>;
  /** 皮肤日志 */
  skinLog: SkinEntry[];
  /** 心情/心得短记 */
  notes: Note[];
}

// ---------- 日期 ----------

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function parseDateKey(key: string): Date {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

/** 本周周一（Y-m-d）。周日在 JS 里是 0。 */
export function mondayKey(d: Date): string {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return dateKey(monday);
}

export function addDaysKey(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayCn(key: string): string {
  return WEEKDAY_CN[parseDateKey(key).getDay()] ?? '';
}

// ---------- 状态 ----------

export function emptyState(now: Date = new Date()): CareState {
  return {
    todayKey: dateKey(now),
    doneToday: [],
    weekKey: mondayKey(now),
    doneWeek: [],
    history: {},
    skinLog: [],
    notes: [],
  };
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

/**
 * 跨天/跨周滚动：
 * - todayKey 变化：把 doneToday 并入 history[旧todayKey]（存上一整天），
 *   todayKey 置为今天、doneToday 清空。
 * - weekKey 变化：weekKey 置为本周一、doneWeek 清空。
 * 返回新状态；若无变化返回原对象。
 */
export function rolloverState(state: CareState, now: Date): CareState {
  const today = dateKey(now);
  const monday = mondayKey(now);
  let next: CareState = state;
  if (state.todayKey !== today) {
    const history = { ...state.history };
    if (state.doneToday.length > 0) {
      history[state.todayKey] = dedupe([...(history[state.todayKey] ?? []), ...state.doneToday]);
    }
    next = { ...next, todayKey: today, doneToday: [], history };
  }
  if (state.weekKey !== monday) {
    next = { ...next, weekKey: monday, doneWeek: [] };
  }
  return next;
}

// ---------- streak ----------

/** 每日项连续天数：今天做了从今天起算，没做从昨天起算，向前数连续出现的天数。 */
export function computeDailyStreak(
  history: Record<string, string[]>,
  doneToday: string[],
  id: string,
  todayKey: string,
): number {
  const todayDone = doneToday.includes(id);
  let day = todayKey;
  if (!todayDone) day = addDaysKey(day, -1);
  let streak = 0;
  for (;;) {
    const done = day === todayKey ? todayDone : (history[day] ?? []).includes(id);
    if (!done) break;
    streak += 1;
    day = addDaysKey(day, -1);
  }
  return streak;
}

/** 某周（以周一为起点）内是否完成过该项。 */
export function completedInWeek(
  history: Record<string, string[]>,
  id: string,
  weekStartKey: string,
): boolean {
  for (let i = 0; i < 7; i += 1) {
    if ((history[addDaysKey(weekStartKey, i)] ?? []).includes(id)) return true;
  }
  return false;
}

/** 每周项：最近 4 个周起始日中完成了几周（含本周）。 */
export function computeWeeklyStreak(
  history: Record<string, string[]>,
  id: string,
  todayKey: string,
): number {
  const thisMonday = mondayKey(parseDateKey(todayKey));
  let count = 0;
  for (let i = 0; i < 4; i += 1) {
    if (completedInWeek(history, id, addDaysKey(thisMonday, -7 * i))) count += 1;
  }
  return count;
}

// ---------- 状态文本 ----------

export interface TodayStatus {
  date: string;
  weekday: string;
  dailyDone: string[];
  dailyTodo: string[];
  weeklyDone: string[];
  weeklyTodo: string[];
  lastSkin: SkinEntry | undefined;
}

export function buildTodayStatus(state: CareState): TodayStatus {
  const done = new Set(state.doneToday);
  const doneW = new Set(state.doneWeek);
  return {
    date: state.todayKey,
    weekday: weekdayCn(state.todayKey),
    dailyDone: DAILY_RITUALS.filter((r) => done.has(r.id)).map((r) => r.id),
    dailyTodo: DAILY_RITUALS.filter((r) => !done.has(r.id)).map((r) => r.id),
    weeklyDone: WEEKLY_RITUALS.filter((r) => doneW.has(r.id)).map((r) => r.id),
    weeklyTodo: WEEKLY_RITUALS.filter((r) => !doneW.has(r.id)).map((r) => r.id),
    lastSkin: state.skinLog[state.skinLog.length - 1],
  };
}

/** 当前连续坚持最长的每日项（阶段记忆的锚点）。 */
export function topDailyStreak(
  state: CareState,
): { id: string; name: string; streak: number } | undefined {
  let best: { id: string; name: string; streak: number } | undefined;
  for (const r of DAILY_RITUALS) {
    const s = computeDailyStreak(state.history, state.doneToday, r.id, state.todayKey);
    if (s > 0 && (!best || s > best.streak)) best = { id: r.id, name: r.name, streak: s };
  }
  return best;
}

/**
 * 组装给 agent 看的今日状态文本。
 * 原则：不是「10/10 的账本」，是「从 1 到 10 的路」——先讲最稳的连续项（阶段记忆），
 * 未完成项用「按节奏慢慢来」轻轻带过，绝不用「还剩 X 项」的催债口吻。
 */
export function formatTodayStatus(state: CareState): string {
  const s = buildTodayStatus(state);
  const lines: string[] = [];
  lines.push(`📅 今天是 ${s.date} 星期${s.weekday}`);
  const top = topDailyStreak(state);
  if (top) {
    lines.push(`🔥 你的「${top.name}」已连续坚持 ${top.streak} 天，节奏稳住了`);
  }
  if (s.dailyDone.length > 0) {
    lines.push(`✅ 今天已完成：${namesOf(s.dailyDone)}`);
  }
  if (s.dailyTodo.length > 0) {
    lines.push(`🌱 今天还没做（按自己的节奏，慢慢来）：${namesOf(s.dailyTodo)}`);
  } else {
    lines.push('🎉 今日 10 项每日护理已全部完成！');
  }
  if (s.weeklyDone.length > 0) {
    lines.push(`✅ 本周周项已完成：${namesOf(s.weeklyDone)}`);
  }
  if (s.weeklyTodo.length > 0) {
    lines.push(`🌱 本周周项还没做（一周时间，不急）：${namesOf(s.weeklyTodo)}`);
  }
  if (s.lastSkin) {
    lines.push(`🔍 最近一次皮肤日志（${s.lastSkin.date}）：${s.lastSkin.state}`);
  }
  return lines.join('\n');
}

// ---------- 阶段记忆（老板记得你） ----------

export interface CareMemory {
  /** 连续坚持最长的每日项 */
  topDaily: { name: string; streak: number } | undefined;
  /** 最近一条心得/日记 */
  lastNote: Note | undefined;
  /** 最近一次皮肤日志 */
  lastSkin: SkinEntry | undefined;
}

/** 从状态里提炼「店老板记得你」的记忆锚点（无副作用）。 */
export function buildCareMemory(state: CareState): CareMemory {
  const top = topDailyStreak(state);
  return {
    topDaily: top ? { name: top.name, streak: top.streak } : undefined,
    lastNote: state.notes[state.notes.length - 1],
    lastSkin: state.skinLog[state.skinLog.length - 1],
  };
}

/** 渲染「老板记得你」文本块（agent 与前端卡片共用）。 */
export function formatCareMemory(m: CareMemory): string {
  const lines: string[] = ['老板记得你'];
  if (m.topDaily) {
    lines.push(`· 最稳的一项：「${m.topDaily.name}」已连续坚持 ${m.topDaily.streak} 天，节奏稳住了`);
  } else {
    lines.push('· 还没有连续坚持的记录——从最舒服的一件小事开始就好');
  }
  if (m.lastSkin) {
    lines.push(`· 最近一次皮肤（${m.lastSkin.date}）：${m.lastSkin.state}`);
  }
  if (m.lastNote) {
    lines.push(`· 她最近说过：「${m.lastNote.text}」`);
  }
  return lines.join('\n');
}

// ---------- 每周复盘 ----------

export interface ReviewItem {
  id: string;
  name: string;
  period: 'daily' | 'weekly';
  completedDays: number;
  streak: number;
}

export interface ReviewResult {
  days: number;
  date: string;
  items: ReviewItem[];
  topStreaks: { name: string; streak: number }[];
  weekly: { id: string; name: string; done: boolean }[];
  summary: string;
}

/** 最近 N 天每项完成天数、每日 streak（top3）、本周周项完成情况。 */
export function buildWeeklyReview(state: CareState, days: number, todayKey: string): ReviewResult {
  const items: ReviewItem[] = [];
  for (const r of DAILY_RITUALS) {
    let completedDays = 0;
    for (let i = 0; i < days; i += 1) {
      const day = addDaysKey(todayKey, -i);
      if (day === todayKey ? state.doneToday.includes(r.id) : (state.history[day] ?? []).includes(r.id)) {
        completedDays += 1;
      }
    }
    items.push({
      id: r.id,
      name: r.name,
      period: 'daily',
      completedDays,
      streak: computeDailyStreak(state.history, state.doneToday, r.id, todayKey),
    });
  }
  const weekly = WEEKLY_RITUALS.map((r) => ({
    id: r.id,
    name: r.name,
    done: state.doneWeek.includes(r.id),
  }));
  const topStreaks = items
    .filter((i) => i.streak > 0)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 3)
    .map((i) => ({ name: i.name, streak: i.streak }));
  const summary = summarizeReview(items, weekly, days);
  return { days, date: todayKey, items, topStreaks, weekly, summary };
}

function summarizeReview(
  items: ReviewItem[],
  weekly: { id: string; name: string; done: boolean }[],
  days: number,
): string {
  const done = items.filter((i) => i.completedDays > 0);
  if (done.length === 0 && weekly.every((w) => w.done)) {
    return `过去 ${days} 天每天都没记录，本周周项倒是做完了。从最简单的「洗脸护肤」捡起来？`;
  }
  if (done.length === 0) {
    return `过去 ${days} 天还没有打卡记录，别灰心——今晚先做一件最舒服的（泡脚或热敷），把第一天捡回来。`;
  }
  const best = [...items].sort((a, b) => b.completedDays - a.completedDays)[0];
  const weakest = [...items].sort((a, b) => a.completedDays - b.completedDays)[0];
  const undoneWeekly = weekly.filter((w) => !w.done);
  const parts: string[] = [`过去 ${days} 天里，「${best.name}」坚持了 ${best.completedDays} 天，是状态最好的一项。`];
  if (weakest && weakest.completedDays === 0) {
    parts.push(`「${weakest.name}」还没开始，本周可以把它当作一个小目标。`);
  }
  if (undoneWeekly.length > 0) {
    parts.push(`本周周项还差：${undoneWeekly.map((w) => w.name).join('、')}。`);
  }
  return parts.join(' ');
}
