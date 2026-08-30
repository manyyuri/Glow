'use agent';

import { useAgentStart, useModel, usePersistentState, useSandbox, useSkill, useTool } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { registerProviders } from '../providers';
import { ALL_RITUALS, RITUAL_BY_ID, namesOf, resolveRitualId } from '../rituals';
import {
  type CareState,
  type Note,
  type SkinEntry,
  emptyState,
  rolloverState,
  formatTodayStatus,
  buildTodayStatus,
  computeDailyStreak,
  computeWeeklyStreak,
  buildWeeklyReview,
} from '../ritual-logic';
import morningSkill from '../skills/morning-ritual/SKILL.md';
import eveningSkill from '../skills/evening-ritual/SKILL.md';
import hairSkill from '../skills/hair-care/SKILL.md';
import guaShaSkill from '../skills/gua-sha/SKILL.md';
import skinSkill from '../skills/skin-analysis/SKILL.md';
import weeklyCleaningSkill from '../skills/weekly-cleaning/SKILL.md';

// ⚠️ flue run 只加载 agent 模块（不加载 app.ts）—— 自定义 provider 注册必须放在这里。
registerProviders();

const WORKSPACE_DIR = path.resolve('workspace');
const JOURNAL_PATH = path.join(WORKSPACE_DIR, 'journal.md');
const PROFILE_NAME = 'profile.md';

const PROFILE_TEMPLATE = `# 我的护理档案（拾光）

> 这是你的专属档案，拾光会据此给你更贴心的建议。随时回来改。

## 基本
- 年龄：
- 肤质（油/干/混/敏感）：
- 发质（油/干/细软/粗硬）：
- 过敏 / 健康注意（如糖尿病、静脉曲张、经期情况等）：

## 作息
- 早起 / 晚睡时间：
- 固定护理时间（如每晚泡脚、周末大扫除）：

## 产品清单
- 洁面：
- 精华 / 面霜：
- 身体乳：
- 精油 / 刮痧工具：
- 其他：

## 特殊关注
- 皮肤问题（想改善的）：
- 身体不适 / 近期小毛病：
- 近期目标：
`;

// 工具 output schema（声明后 @flue/react 的 dynamic-tool part 会带结构化 output，供前端渲染实时清单）。
const RitualOutputSchema = v.object({
  ok: v.boolean(),
  message: v.string(),
  id: v.string(),
  name: v.string(),
  period: v.string(),
  streak: v.number(),
  doneToday: v.array(v.string()),
  doneWeek: v.array(v.string()),
  tip: v.string(),
});

const TodayStatusOutputSchema = v.object({
  date: v.string(),
  weekday: v.string(),
  dailyDone: v.array(v.string()),
  dailyTodo: v.array(v.string()),
  weeklyDone: v.array(v.string()),
  weeklyTodo: v.array(v.string()),
  hasSkinLogToday: v.boolean(),
});

const SkinEntrySchema = v.object({
  date: v.string(),
  state: v.string(),
  factors: v.optional(v.string()),
  advice: v.optional(v.string()),
});

const SkinLogOutputSchema = v.object({
  ok: v.boolean(),
  recent: v.array(SkinEntrySchema),
  trend: v.string(),
});

const ReviewItemSchema = v.object({
  id: v.string(),
  name: v.string(),
  period: v.string(),
  completedDays: v.number(),
  streak: v.number(),
});

const WeeklyReviewOutputSchema = v.object({
  days: v.number(),
  date: v.string(),
  items: v.array(ReviewItemSchema),
  topStreaks: v.array(v.object({ name: v.string(), streak: v.number() })),
  weekly: v.array(v.object({ id: v.string(), name: v.string(), done: v.boolean() })),
  summary: v.string(),
});

/** 把一条心得以人类可读格式追加进 journal.md。 */
async function appendJournalNote(note: Note): Promise<void> {
  const stamp = new Date().toTimeString().slice(0, 5);
  const chunk = `\n## ${note.date}\n\n- ${stamp} ${note.text}\n`;
  try {
    await appendFile(JOURNAL_PATH, chunk, 'utf8');
  } catch {
    await mkdir(WORKSPACE_DIR, { recursive: true });
    await appendFile(JOURNAL_PATH, chunk, 'utf8');
  }
}

/** 皮肤日志最近若干条的简单趋势提示。 */
function skinTrendHint(recent: SkinEntry[]): string {
  const last = recent[recent.length - 1];
  if (!last) return '还没有皮肤日志，第一次记录后开始有趋势。';
  if (recent.length < 2) return `本次记录：${last.state}。再连续记录几天就能看到变化趋势。`;
  const prev = recent[recent.length - 2];
  return `与上一次（${prev.date}：${prev.state}）相比，本次为「${last.state}」。`;
}

export function Shiguang() {
  // 默认 opencode-luna/deepseek-v4-flash；可用 RITUAL_MODEL 覆盖（如切到 vision 模型做照片皮肤分析）。
  useModel(process.env.RITUAL_MODEL ?? 'opencode-luna/deepseek-v4-flash');

  // 挂载 6 个护理方法 skill（按需由 activate_skill 拉取）。
  useSkill(morningSkill);
  useSkill(eveningSkill);
  useSkill(hairSkill);
  useSkill(guaShaSkill);
  useSkill(skinSkill);
  useSkill(weeklyCleaningSkill);

  // 全部追踪数据（§5 持久化状态模型）。
  const [state, setState] = usePersistentState<CareState>('care', emptyState());

  // 只把 workspace/ 暴露给模型：可读 profile.md、读写用户照片/资料、写 journal.md。
  useSandbox(local({ cwd: WORKSPACE_DIR }));

  // 每次消息投递前：跨天/跨周滚动 + 读档案 + 把今日状态注入给模型。
  useAgentStart(async ({ append, harness, log }) => {
    const now = new Date();
    const rolled = rolloverState(state, now);
    if (rolled !== state) {
      setState(rolled);
      log.info('rollover', { from: state.todayKey, to: rolled.todayKey });
    }
    const effective = rolled !== state ? rolled : state;

    let profileText = '';
    try {
      const exists = await harness.sandbox.exists(PROFILE_NAME);
      if (exists) {
        profileText = (await harness.sandbox.readFile(PROFILE_NAME)).trim();
      } else {
        await harness.sandbox.writeFile(PROFILE_NAME, PROFILE_TEMPLATE);
        profileText = PROFILE_TEMPLATE;
        log.info('profile template created');
      }
    } catch (err) {
      log.warn('profile read failed', { err: String(err) });
    }

    const status = formatTodayStatus(effective);
    const body = profileText ? `${status}\n\n【我的护理档案】\n${profileText}` : status;
    append({ kind: 'signal', type: 'intake', body });
  });

  // ---- 工具 1：打卡 ----
  useTool({
    name: 'complete_ritual',
    description:
      '记录一次护理项目完成（打卡）。传入护理项目的中文名或 slug，如「洗脸护肤」或「face-care」；用户在说"做完了/洗完了/泡完了"等口语时调用。可选 note 附一句心得。返回更新后的进度与该项目的连续坚持天数。',
    input: v.object({
      ritual: v.string(),
      note: v.optional(v.string()),
    }),
    output: RitualOutputSchema,
    run: ({ data }) => {
      const id = resolveRitualId(data.ritual);
      if (!id) {
        return {
          output: {
            ok: false,
            message: `没认出「${data.ritual}」是哪个项目，请从这些里选：${namesOf(ALL_RITUALS.map((r) => r.id))}`,
            options: ALL_RITUALS.map((r) => r.id),
          },
        };
      }
      const ritual = RITUAL_BY_ID[id];
      const isDaily = ritual.period === 'daily';
      let result!: v.InferOutput<typeof RitualOutputSchema>;
      setState((prev) => {
        const today = prev.todayKey;
        const doneToday = new Set(prev.doneToday);
        const doneWeek = new Set(prev.doneWeek);
        const history = { ...prev.history };
        const daySet = new Set(history[today] ?? []);
        if (isDaily) doneToday.add(id);
        else doneWeek.add(id);
        daySet.add(id);
        history[today] = [...daySet];
        const next: CareState = { ...prev, doneToday: [...doneToday], doneWeek: [...doneWeek], history };
        const streak = isDaily
          ? computeDailyStreak(next.history, next.doneToday, id, next.todayKey)
          : computeWeeklyStreak(next.history, id, next.todayKey);
        result = {
          ok: true,
          message: `已记录「${ritual.name}」完成`,
          id,
          name: ritual.name,
          period: ritual.period,
          streak,
          doneToday: [...doneToday],
          doneWeek: [...doneWeek],
          tip: ritual.tip,
        };
        return next;
      });
      if (data.note && data.note.trim()) {
        void appendJournalNote({ date: state.todayKey, text: data.note.trim() }).catch(() => undefined);
      }
      return { output: result };
    },
  });

  // ---- 工具 2：今日/本周进度 ----
  useTool({
    name: 'today_status',
    description:
      '查看今天与本周的护理进度：今天 10 项每日护理哪些做完、哪些没做；本周 4 项周护理进度；今天是否有皮肤日志。',
    output: TodayStatusOutputSchema,
    run: () => {
      const s = buildTodayStatus(state);
      return {
        output: {
          date: state.todayKey,
          weekday: s.weekday,
          dailyDone: s.dailyDone,
          dailyTodo: s.dailyTodo,
          weeklyDone: s.weeklyDone,
          weeklyTodo: s.weeklyTodo,
          hasSkinLogToday: state.skinLog.some((e) => e.date === state.todayKey),
        },
      };
    },
  });

  // ---- 工具 3：记录皮肤状态 ----
  useTool({
    name: 'log_skin_state',
    description:
      '记录一次皮肤状态观察（皮肤日志）。state 为用户观察描述（出油/干燥/泛红/痘痘/毛孔/光泽等），factors 为可能因素（睡眠/饮食/天气/经期/换产品），advice 为本次建议。用于皮肤分析后存档，跨天对比趋势。',
    input: v.object({
      state: v.string(),
      factors: v.optional(v.string()),
      advice: v.optional(v.string()),
    }),
    output: SkinLogOutputSchema,
    run: ({ data }) => {
      let recent: SkinEntry[] = [];
      setState((prev) => {
        const entry: SkinEntry = {
          date: prev.todayKey,
          state: data.state,
          ...(data.factors ? { factors: data.factors } : {}),
          ...(data.advice ? { advice: data.advice } : {}),
        };
        const skinLog = [...prev.skinLog, entry].slice(-60);
        recent = skinLog;
        return { ...prev, skinLog };
      });
      const last3 = recent.slice(-3);
      return { output: { ok: true, recent: last3, trend: skinTrendHint(last3) } };
    },
  });

  // ---- 工具 4：每周复盘 ----
  useTool({
    name: 'weekly_review',
    description:
      '统计最近 N 天（默认 7）每项完成天数、每日连续坚持（streak）前三、本周周项完成情况，返回结构化统计。',
    input: v.object({ days: v.optional(v.number()) }),
    output: WeeklyReviewOutputSchema,
    run: ({ data }) => {
      const days = Math.min(Math.max(Math.trunc(data.days ?? 7), 1), 30);
      return { output: buildWeeklyReview(state, days, state.todayKey) };
    },
  });

  // ---- 工具 5：存日记/心得 ----
  useTool({
    name: 'save_note',
    description:
      '把用户随手说的护理心得/心情短记存入日记（写入 workspace/journal.md，人类可读）。用户闲聊式心得、突然想到的小经验时调用。',
    input: v.object({ text: v.string() }),
    run: async ({ data }) => {
      const note: Note = { date: state.todayKey, text: data.text.trim() };
      setState((prev) => ({ ...prev, notes: [...prev.notes, note] }));
      await appendJournalNote(note);
      return { output: { ok: true, message: '已存入护理日记', date: note.date } };
    },
  });

  return `你是「拾光」—— 一家开在用户家楼下、24 小时不打烊、懂护理也记得用户皮肤状态的家庭美容院。你的老板就是用户本人。

# 身份与人设
- 自称「我」，称呼用户「你」。中文回复。
- 语气：温暖、具体、像熟悉你的美容院老板，可以偶尔俏皮一下；不油腻、不评判、不堆空话、不喊口号。
- 你是用户精致生活里的陪伴者，不是医生。皮肤/身体异常要建议看医生，绝不编造医疗结论。

# 每轮对话前
- 系统会在每条新消息前注入一份「今日状态」+「我的护理档案」。先读它，开场先摆出来：今天星期几、已完成/未完成哪些、本周周项进度、最近皮肤日志一句话。别复述整段，挑重点、说人话。
- 主动性强一点：新一轮对话先报「今天还剩 X、Y、Z 没做」，再回应用户的话。

# 行为约定
1. 用户报告完成某护理（「洗完脸了」「泡完脚了」「洗脸护肤做完了」等口语）→ 调 complete_ritual 打卡；随后给一句贴合该项目、真诚不敷衍的鼓励（可参考返回里的 tip 再润色），并提示下一件未完成的事。
2. 用户问「怎么做 / 为什么 / 要注意什么」（如"精油刮痧怎么做""怎么泡脚"）→ 激活对应 skill（morning-ritual / evening-ritual / hair-care / gua-sha / skin-analysis / weekly-cleaning），按里面给的具体方法、参数、禁忌回答；回答要具体可执行，不空谈。
3. 用户描述皮肤状态（或发照片）→ 激活 skin-analysis，引导用户按观察维度逐项描述，调 log_skin_state 记录，结合最近皮肤日志给趋势判断（今天和前几天比是变好还是变差）和 1–3 条可执行建议；异常持续提醒就医。
4. 用户要复盘（「这周怎么样」「复盘一下」）→ 调 weekly_review，用返回的统计给出小结与下周建议，语气温和不施压。
5. 用户闲聊式心得/突然想到的小经验 → 调 save_note 存档（也写入 journal.md）。
6. 用户问「今天还有什么没做 / 进度」→ 调 today_status，用真实数据回答，不要凭记忆编造。
7. 不要主动编造打卡记录；用户没做的事不要替用户说"做了"。

# 个性化
- 所有建议贴合「我的护理档案」（肤质、发质、过敏、作息、产品清单、目标）。档案里没填的别猜，可以自然地问一句。
- 别一次倒太多信息；一次给 1–3 条最要紧的。

# 输出风格
- 短句、具体、有画面感；适当用 emoji，但别刷屏。
- 鼓励要真诚、贴合刚做完的那件事，不空洞；不苛责、不制造焦虑。`;
}
