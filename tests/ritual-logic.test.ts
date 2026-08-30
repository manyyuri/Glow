import { describe, expect, it } from 'vitest';
import {
  addDaysKey,
  buildTodayStatus,
  buildWeeklyReview,
  computeDailyStreak,
  computeWeeklyStreak,
  dateKey,
  emptyState,
  formatTodayStatus,
  mondayKey,
  rolloverState,
  type CareState,
} from '../src/ritual-logic';
import { resolveRitualId } from '../src/rituals';

const D = '2026-08-30'; // 周日

function state(over: Partial<CareState> = {}): CareState {
  return { ...emptyState(new Date(2026, 7, 30)), ...over };
}

describe('日期工具', () => {
  it('dateKey 输出本地 YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 7, 30))).toBe('2026-08-30');
  });
  it('mondayKey 对周日回到本周一', () => {
    expect(mondayKey(new Date(2026, 7, 30))).toBe('2026-08-24');
  });
  it('mondayKey 对周一取自身', () => {
    expect(mondayKey(new Date(2026, 7, 24))).toBe('2026-08-24');
  });
  it('addDaysKey 跨月正确', () => {
    expect(addDaysKey('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysKey('2026-09-01', -1)).toBe('2026-08-31');
  });
});

describe('resolveRitualId', () => {
  it('中文名精确匹配', () => {
    expect(resolveRitualId('洗脸护肤')).toBe('face-care');
    expect(resolveRitualId('洗床单')).toBe('bedding');
  });
  it('slug 精确匹配', () => {
    expect(resolveRitualId('face-care')).toBe('face-care');
    expect(resolveRitualId('moxa-gua-sha')).toBe('moxa-gua-sha');
  });
  it('「完成」前缀容错', () => {
    expect(resolveRitualId('完成泡脚')).toBe('foot-soak');
  });
  it('未识别返回 undefined', () => {
    expect(resolveRitualId('不存在的项目xyz')).toBeUndefined();
  });
});

describe('跨天/跨周滚动', () => {
  it('同一天不滚动', () => {
    const s = state();
    expect(rolloverState(s, new Date(2026, 7, 30))).toBe(s);
  });
  it('跨天：把 doneToday 并入昨天 history 并清空 today', () => {
    const s = state({ todayKey: '2026-08-29', doneToday: ['face-care', 'breakfast'], history: {} });
    const next = rolloverState(s, new Date(2026, 7, 30));
    expect(next.todayKey).toBe('2026-08-30');
    expect(next.doneToday).toEqual([]);
    expect(next.history['2026-08-29']).toEqual(['face-care', 'breakfast']);
  });
  it('跨周：清空 doneWeek 并更新 weekKey', () => {
    const s = state({ weekKey: '2026-08-17', doneWeek: ['bedding'], todayKey: '2026-08-23', doneToday: ['foot-soak'] });
    const next = rolloverState(s, new Date(2026, 7, 30));
    expect(next.weekKey).toBe('2026-08-24');
    expect(next.doneWeek).toEqual([]);
    // 跨天跨周同时发生：昨天记录也要并入
    expect(next.history['2026-08-23']).toContain('foot-soak');
  });
});

describe('streak 计算', () => {
  it('今天做了从今天起算连续天数', () => {
    const s = state({
      doneToday: ['face-care'],
      history: { '2026-08-29': ['face-care'], '2026-08-28': ['face-care'] },
    });
    expect(computeDailyStreak(s.history, s.doneToday, 'face-care', D)).toBe(3); // 30,29,28
  });
  it('今天没做但从昨天起算', () => {
    const s = state({
      doneToday: [],
      history: { '2026-08-29': ['face-care'], '2026-08-28': ['face-care'] },
    });
    expect(computeDailyStreak(s.history, s.doneToday, 'face-care', D)).toBe(2); // 29,28
  });
  it('中断则 streak 归零', () => {
    const s = state({
      doneToday: ['face-care'],
      history: { '2026-08-28': ['face-care'] }, // 29 断了
    });
    expect(computeDailyStreak(s.history, s.doneToday, 'face-care', D)).toBe(1);
  });
  it('每周项：最近 4 个周起始日完成几周', () => {
    const s = state({
      history: {
        '2026-08-24': ['bedding'], // 本周
        '2026-08-10': ['bedding'], // 两周前
      },
    });
    expect(computeWeeklyStreak(s.history, 'bedding', D)).toBe(2);
  });
});

describe('今日状态汇总', () => {
  it('已做/未做分组正确', () => {
    const s = state({ doneToday: ['face-care', 'breakfast'], doneWeek: ['bedding'] });
    const st = buildTodayStatus(s);
    expect(st.dailyDone).toContain('face-care');
    expect(st.dailyTodo).not.toContain('face-care');
    expect(st.weeklyDone).toContain('bedding');
    expect(st.weeklyTodo).toContain('deep-clean');
  });
  it('formatTodayStatus 包含日期与未完成数量', () => {
    const s = state({ doneToday: ['face-care'] });
    const text = formatTodayStatus(s);
    expect(text).toContain('2026-08-30');
    expect(text).toContain('剩 9 项');
    expect(text).toContain('洗脸护肤');
  });
});

describe('每周复盘', () => {
  it('统计最近 N 天完成天数与 top streak', () => {
    const s = state({
      doneToday: ['face-care'],
      history: { '2026-08-29': ['face-care'], '2026-08-28': ['face-care'] },
    });
    const r = buildWeeklyReview(s, 7, D);
    const face = r.items.find((i) => i.id === 'face-care')!;
    expect(face.completedDays).toBe(3);
    expect(r.topStreaks[0]).toMatchObject({ name: '洗脸护肤', streak: 3 });
    expect(r.weekly.every((w) => !w.done)).toBe(true);
    expect(r.summary.length).toBeGreaterThan(0);
  });
  it('无记录时给温和小结', () => {
    const s = state();
    const r = buildWeeklyReview(s, 7, D);
    expect(r.summary).toContain('打卡');
  });
});
