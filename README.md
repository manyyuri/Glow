# 拾光 · 家庭美容院（Glow）

> 你家楼下 24 小时不打烊、还懂护理、记得你皮肤状态的家庭美容院。
> 基于 [withastro/flue](https://flueframework.com/)（v2.0.3, Node target）的陪伴式护理 agent。
> 英文展示名 **Glow**，代码 slug **`shiguang`**。

## 它能做什么

1. **记**：自动追踪每日 10 项 / 每周 4 项护理的完成情况，跨天跨周滚动，计算连续天数（streak），不丢数据。
2. **教**：每个护理项目背后挂一份专业做法（skill，按需加载）——问「怎么做 / 为什么」给具体、正确、可执行的指导。
3. **伴**：温暖、具体、不评判地陪伴——主动报进度、提醒没做完的项目、每周复盘、记录皮肤状态变化。

## 快速开始

```bash
npm install
cp .env.example .env          # 填入三个端点的密钥（见下）
```

### Web 页面（主要入口，v1.1）

```bash
npm run dev
# 打开 http://localhost:5173
```

左侧「今日护理清单」一键打卡（agent 是唯一状态源，页面不做状态双写）；右侧与教练对话，流式渲染。会话与打卡状态在刷新 / 服务重启后都不丢（`localStorage` 会话 id + `data/flue.db` 持久化）。

### CLI（调试 / 脚本）

```bash
# 同一 --id 即连续陪伴，重启不丢
npx flue run src/agents/shiguang.ts --id 我的会话 -m "你好，今天有哪些护理要做？"
npx flue run src/agents/shiguang.ts --id 我的会话 -m "我刚洗完脸了"
```

### 其它命令

```bash
npm run typecheck             # tsc --noEmit
npm test                      # vitest 单测（纯函数：滚动/streak/复盘/解析）
npm run build && npm start    # 生产构建 + 启动（node --env-file=.env dist/server.mjs）
```

## 模型 / Provider

本机没有官方 provider 直连，用 pi 的 `createProvider` 注册三个 OpenAI/Anthropic 兼容端点（`src/providers.ts`，密钥放 `.env`）：

| provider | 协议 | baseUrl | 默认模型 |
| --- | --- | --- | --- |
| `glm` | openai-completions | `https://open.bigmodel.cn/api/coding/paas/v4` | glm-5.3-flash |
| `opencode-luna` | openai-responses | `https://opencode.ai/zen/go/v1` | **deepseek-v4-flash（默认）** |
| `deepseek` | anthropic-messages | `https://api.deepseek.com/anthropic` | deepseek-v4-flash |

- 默认模型：`opencode-luna/deepseek-v4-flash`（便宜、1M 上下文）。
- 切换模型：`RITUAL_MODEL=opencode-luna/deepseek-v4-flash-vision-exp npx flue run ...`（vision 模型可做照片皮肤分析）。
- `.env` 已被 gitignore；flue 打包会拒绝含密钥的项目。

## 目录结构

```text
项目根/
├─ flue.config.ts              # target: node；providers: []（全部走自定义）
├─ vite.config.ts              # flue() + react + serveWebPage 中间件
├─ vitest.config.ts            # 纯函数单测配置（不加载 flue 插件）
├─ .env                        # 模型密钥（gitignore）
├─ workspace/
│  ├─ profile.md               # 用户档案（可编辑，首次缺省由 agent 生成模板）
│  └─ journal.md               # 护理日记（agent 写入，gitignore）
├─ data/flue.db                # 会话 + usePersistentState 持久化（gitignore）
├─ scripts/fake-yesterday.mjs  # 开发工具：伪造"昨天"状态，验证跨天滚动
└─ src/
   ├─ agents/shiguang.ts       # 'use agent' 主 agent（函数 Shiguang）
   ├─ app.ts                   # Hono 路由：/api/agents/shiguang + / 网页
   ├─ db.ts                    # sqlite('./data/flue.db')，重启不丢
   ├─ providers.ts             # 注册 3 个自定义 provider（幂等）
   ├─ rituals.ts               # 护理项目目录（单一数据源）
   ├─ ritual-logic.ts          # 纯函数：日期/周滚动、状态汇总、streak
   ├─ skills/<name>/SKILL.md   # 6 个护理方法 skill
   └─ web/                     # React 聊天页（index.html + main.tsx）
```

## 架构要点

- **状态模型**（`usePersistentState('care')`）：`todayKey / doneToday / weekKey / doneWeek / history / skinLog / notes`。跨天把 `doneToday` 并入 `history[昨天]` 再清零，跨周重置 `doneWeek`——滚动在 `useAgentStart` 里完成。
- **状态注入**：每次消息投递前，`useAgentStart` 读 `profile.md` + 组装今日状态，用 `append({kind:'signal'})` 塞进对话（不触发新的 delivery，无死循环），模型每轮都拿到最新状态。
- **5 个工具**：`complete_ritual`（打卡）/ `today_status` / `log_skin_state` / `weekly_review` / `save_note`。都带 valibot output schema——`@flue/react` 的 `dynamic-tool` part 会带结构化 output，前端据此同步左侧清单。
- **skill**：6 个（morning-ritual / evening-ritual / hair-care / gua-sha / skin-analysis / weekly-cleaning），静态导入 + `useSkill` 挂载，模型按需 `activate_skill`。刮痧/艾灸强调安全红线。
- **沙箱**：`useSandbox(local({ cwd: workspace }))`，只把 `workspace/` 暴露给模型。

## 验收清单（13 条，均已实测通过）

- [x] CLI 中文回复 + `--json` outcome=completed
- [x] 同 `--id` 打卡 → `today_status` 反映；「今天还剩什么」能报未完成
- [x] 伪造 `todayKey` 为昨天 → 自动滚动，`history` 存昨天记录
- [x] 皮肤分析 → `log_skin_state` + 建议
- [x] `weekly_review` 最近 7 天统计 + streak
- [x] 6 个 skill 均可激活（「精油刮痧怎么做」给出手法细节）
- [x] `workspace/journal.md` 随 `save_note` 追加、人类可读
- [x] `RITUAL_MODEL` 切换（vision / glm / deepseek）不报 provider 错误
- [x] `vite dev` 打开无控制台报错，发消息收到流式中文回复
- [x] 左栏打卡 → agent 记录；「今日进度」显示已勾选
- [x] 刷新页面会话与打卡状态仍在
- [x] 杀掉并重启 `vite dev` 历史对话与状态不丢
- [x] 「新会话」开干净对话，旧会话可从 localStorage 找回

## 已知边界

- **生产 Web 页面**（可选范围）：`npm run build && npm start` 会启动 agent API 服务，但静态聊天页是 dev-first（`vite dev` 是规格里的主要入口）。`src/web/` 的 React 应用若要在生产使用，需另配客户端构建产物。
- 皮肤/身体异常建议就医，agent 不做医疗判断。
