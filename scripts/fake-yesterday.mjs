// 端到端验证跨天滚动：往 <会话id> 会话的持久化状态里插入一条
// 「todayKey = 昨天、doneToday 有记录」的 state_write，
// 之后跑 flue run 应自动滚动到今天，并把昨天的记录并入 history。
// 用法：node scripts/fake-yesterday.mjs [会话id] [YYYY-MM-DD]  （默认 id=demo-001，日期=昨天）
import { DatabaseSync } from 'node:sqlite';

const convId = process.argv[2] ?? 'demo-001';
const db = new DatabaseSync('data/flue.db');

const path = 'agents/Shiguang/' + convId;
const row = db.prepare(`select data from flue_conversation_stream_batches where path = ? and data like '%state_write%' and data like '%todayKey%' order by seq desc limit 1`).get(path);

if (!row) {
  console.error('未找到 state_write 记录（会话 ' + convId + '）');
  process.exit(1);
}
const sample = JSON.parse(row.data).find((r) => r.type === 'state_write');
const stream = db.prepare(`select * from flue_conversation_streams where path = ?`).get(path);

const d = new Date(Date.now() - 86400000);
const yesterday = process.argv[3] ?? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fake = {
  ...sample,
  id: 'record_rollover_fake_' + Date.now(),
  timestamp: new Date().toISOString(),
  submissionId: 'sub_fake_rollover',
  attemptId: 'attempt_fake_rollover',
  name: 'care',
  value: {
    todayKey: yesterday, // 昨天
    doneToday: ['face-care'],
    weekKey: '2026-08-24',
    doneWeek: [],
    history: {},
    skinLog: [],
    notes: [],
  },
};

const nextSeq = stream.next_offset;
const nextPs = stream.next_producer_sequence;
db.prepare(
  `insert into flue_conversation_stream_batches (path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id)
   values (?, ?, ?, ?, ?, ?, 'sub_fake_rollover', 'attempt_fake_rollover')`,
).run(path, nextSeq, stream.producer_id, stream.producer_epoch, nextPs, JSON.stringify([fake]));

db.prepare(`update flue_conversation_streams set next_offset = ?, next_producer_sequence = ? where path = ?`).run(
  nextSeq + 1,
  nextPs + 1,
  path,
);

console.log('已插入伪造的昨天状态（' + yesterday + '）：', JSON.stringify(fake.value, null, 2));
db.close();
