/**
 * 拾光 · 家庭美容院 —— 护理项目目录（单一数据源）。
 *
 * 增删护理项目只改这一个文件。字段：
 * - id：ASCII slug（状态持久化、URL、打卡解析用）
 * - name：中文名（用户口语打卡）
 * - period：daily（每日）/ weekly（每周）
 * - slot：daily 项的时段提示（morning 晨间 / evening 晚间 / any 任意）
 * - skill：挂载的方法 skill 名
 * - emoji：页面与状态展示图标
 * - tip：打卡后 agent 可参考的一句真诚鼓励语
 */

export type RitualPeriod = 'daily' | 'weekly';
export type DailySlot = 'morning' | 'evening' | 'any';

export interface Ritual {
  id: string;
  name: string;
  period: RitualPeriod;
  slot?: DailySlot;
  skill: string;
  emoji: string;
  tip: string;
}

export const DAILY_RITUALS: Ritual[] = [
  {
    id: 'breakfast',
    name: '早饭',
    period: 'daily',
    slot: 'morning',
    skill: 'morning-ritual',
    emoji: '🍳',
    tip: '好好吃早饭，一天的能量就稳了。今天的早饭搭配得怎么样？',
  },
  {
    id: 'face-care',
    name: '洗脸护肤',
    period: 'daily',
    slot: 'morning',
    skill: 'morning-ritual',
    emoji: '🧴',
    tip: '清洁 + 护肤做得好，皮肤会记得你的认真。',
  },
  {
    id: 'comb-hair',
    name: '梳头',
    period: 'daily',
    slot: 'morning',
    skill: 'hair-care',
    emoji: '💆',
    tip: '梳头一百下，头皮放松，晚上睡得更香。',
  },
  {
    id: 'hair-wash',
    name: '洗头',
    period: 'daily',
    slot: 'any',
    skill: 'hair-care',
    emoji: '🚿',
    tip: '指腹按摩不抓头皮，发根也感谢你。',
  },
  {
    id: 'shower',
    name: '洗澡',
    period: 'daily',
    slot: 'any',
    skill: 'evening-ritual',
    emoji: '🛁',
    tip: '洗去一天的疲惫，身体轻盈了不少吧。',
  },
  {
    id: 'body-lotion',
    name: '涂身体乳',
    period: 'daily',
    slot: 'any',
    skill: 'evening-ritual',
    emoji: '🧴',
    tip: '洗澡后三分钟内涂身体乳，锁住水分，皮肤会越来越润。',
  },
  {
    id: 'foot-soak',
    name: '泡脚',
    period: 'daily',
    slot: 'evening',
    skill: 'evening-ritual',
    emoji: '🦶',
    tip: '泡完脚手脚都暖了，今晚一定睡得好。',
  },
  {
    id: 'hot-compress',
    name: '热敷',
    period: 'daily',
    slot: 'evening',
    skill: 'evening-ritual',
    emoji: '♨️',
    tip: '热敷之后记得补水，放松身体也善待眼睛。',
  },
  {
    id: 'gua-sha-oil',
    name: '精油刮痧',
    period: 'daily',
    slot: 'evening',
    skill: 'gua-sha',
    emoji: '💧',
    tip: '精油打底再刮，力度轻一点，舒服最重要。',
  },
  {
    id: 'skin-check',
    name: '皮肤状态分析',
    period: 'daily',
    slot: 'any',
    skill: 'skin-analysis',
    emoji: '🔍',
    tip: '每天看一眼自己的皮肤，变化就有迹可循。',
  },
];

export const WEEKLY_RITUALS: Ritual[] = [
  {
    id: 'head-soak',
    name: '泡头',
    period: 'weekly',
    skill: 'hair-care',
    emoji: '🫧',
    tip: '每周一次泡头，头皮深层放松，坚持下来发质会不一样。',
  },
  {
    id: 'bedding',
    name: '洗床单',
    period: 'weekly',
    skill: 'weekly-cleaning',
    emoji: '🛏️',
    tip: '床单干净了，睡觉都更安心，这是给身体最好的照顾。',
  },
  {
    id: 'deep-clean',
    name: '完整打扫',
    period: 'weekly',
    skill: 'weekly-cleaning',
    emoji: '🧹',
    tip: '一周一次的完整打扫，家里清爽，人也清爽。',
  },
  {
    id: 'moxa-gua-sha',
    name: '艾灸刮痧',
    period: 'weekly',
    skill: 'gua-sha',
    emoji: '🌿',
    tip: '艾灸后注意保暖避风，做完记得喝点温水。',
  },
];

export const ALL_RITUALS: Ritual[] = [...DAILY_RITUALS, ...WEEKLY_RITUALS];

export const RITUAL_BY_ID: Record<string, Ritual> = Object.fromEntries(
  ALL_RITUALS.map((r) => [r.id, r]),
);

export const RITUAL_BY_NAME: Record<string, Ritual> = Object.fromEntries(
  ALL_RITUALS.map((r) => [r.name, r]),
);

/**
 * 把中文名 / slug 解析成标准 id。
 * 精确匹配优先（slug 或中文名），其次模糊匹配（名字包含关系）。
 * 解析失败返回 undefined。
 */
export function resolveRitualId(input: string): string | undefined {
  const q = input.trim();
  if (!q) return undefined;
  const exact =
    RITUAL_BY_ID[q] ?? RITUAL_BY_NAME[q] ?? RITUAL_BY_NAME[q.replace(/^完成/, '').trim()];
  if (exact) return exact.id;
  const fuzzy = ALL_RITUALS.find(
    (r) => r.name.includes(q) || q.includes(r.name) || r.id.includes(q) || q.includes(r.id),
  );
  return fuzzy?.id;
}

/** 把 id 列表渲染成「A、B、C」的中文列表。 */
export function namesOf(ids: Iterable<string>): string {
  return [...ids].map((id) => RITUAL_BY_ID[id]?.name ?? id).join('、');
}
