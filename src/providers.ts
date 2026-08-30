/**
 * 拾光 · 家庭美容院 —— 自定义 provider 注册。
 *
 * 本机没有官方 provider 直连，用 pi 的 createProvider 注册三个
 * OpenAI/Anthropic 兼容端点（密钥放 .env，用 envApiKeyAuth 读取）。
 *
 * ⚠️ 关键点：flue run 只加载 agent 模块，不加载 app.ts ——
 * registerProviders() 必须由 agent 模块（src/agents/shiguang.ts）
 * 顶层调用，才能同时覆盖 CLI 与 Web 两种形态。
 */
import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { Model } from '@earendil-works/pi-ai';
import { setProvider } from '@flue/runtime';

const GLM_BASE = 'https://open.bigmodel.cn/api/coding/paas/v4';
const LUNA_BASE = 'https://opencode.ai/zen/go/v1';
const DEEPSEEK_BASE = 'https://api.deepseek.com/anthropic';

// 名义成本（$ / 1M tokens），仅用于用量统计展示。
const NOMINAL_COST = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 };
const DEEPSEEK_COST = { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 };

function m<T extends Model<any>>(overrides: Omit<T, 'api' | 'provider' | 'baseUrl'> & { api: T['api']; provider: string; baseUrl: string }): T {
  return overrides as unknown as T;
}

export function registerProviders(): void {
  // GLM —— openai-completions
  setProvider(
    createProvider({
      id: 'glm',
      name: '智谱 GLM',
      baseUrl: GLM_BASE,
      auth: { apiKey: envApiKeyAuth('GLM API key', ['GLM_API_KEY']) },
      models: [
        m<Model<'openai-completions'>>({
          id: 'glm-5', name: 'GLM-5', api: 'openai-completions', provider: 'glm', baseUrl: GLM_BASE,
          reasoning: false, input: ['text'], cost: NOMINAL_COST, contextWindow: 128_000, maxTokens: 8_192,
        }),
        m<Model<'openai-completions'>>({
          id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', api: 'openai-completions', provider: 'glm', baseUrl: GLM_BASE,
          reasoning: false, input: ['text'], cost: NOMINAL_COST, contextWindow: 128_000, maxTokens: 8_192,
        }),
      ],
      api: openAICompletionsApi(),
    }),
  );

  // OpenCode Luna —— openai-responses
  setProvider(
    createProvider({
      id: 'opencode-luna',
      name: 'OpenCode Luna',
      baseUrl: LUNA_BASE,
      auth: { apiKey: envApiKeyAuth('OpenCode Luna API key', ['OPENCODE_LUNA_API_KEY']) },
      models: [
        m<Model<'openai-responses'>>({
          id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', api: 'openai-responses', provider: 'opencode-luna', baseUrl: LUNA_BASE,
          reasoning: true, input: ['text'], cost: NOMINAL_COST, contextWindow: 256_000, maxTokens: 32_768,
        }),
        m<Model<'openai-responses'>>({
          id: 'glm-5.2', name: 'GLM 5.2', api: 'openai-responses', provider: 'opencode-luna', baseUrl: LUNA_BASE,
          reasoning: true, input: ['text'], cost: NOMINAL_COST, contextWindow: 128_000, maxTokens: 16_384,
        }),
        m<Model<'openai-responses'>>({
          id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', api: 'openai-responses', provider: 'opencode-luna', baseUrl: LUNA_BASE,
          reasoning: true, input: ['text'], cost: NOMINAL_COST, contextWindow: 1_048_576, maxTokens: 16_384,
        }),
        m<Model<'openai-responses'>>({
          id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision', api: 'openai-responses', provider: 'opencode-luna', baseUrl: LUNA_BASE,
          reasoning: true, input: ['text', 'image'], cost: NOMINAL_COST, contextWindow: 1_048_576, maxTokens: 16_384,
        }),
      ],
      api: openAIResponsesApi(),
    }),
  );

  // DeepSeek —— anthropic-messages
  setProvider(
    createProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: DEEPSEEK_BASE,
      auth: { apiKey: envApiKeyAuth('DeepSeek API key', ['DEEPSEEK_API_KEY']) },
      models: [
        m<Model<'anthropic-messages'>>({
          id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', api: 'anthropic-messages', provider: 'deepseek', baseUrl: DEEPSEEK_BASE,
          reasoning: false, input: ['text', 'image'], cost: DEEPSEEK_COST, contextWindow: 1_000_000, maxTokens: 384_000,
        }),
        m<Model<'anthropic-messages'>>({
          id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Exp', api: 'anthropic-messages', provider: 'deepseek', baseUrl: DEEPSEEK_BASE,
          reasoning: false, input: ['text', 'image'], cost: DEEPSEEK_COST, contextWindow: 1_000_000, maxTokens: 384_000,
        }),
        m<Model<'anthropic-messages'>>({
          id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', api: 'anthropic-messages', provider: 'deepseek', baseUrl: DEEPSEEK_BASE,
          reasoning: true, input: ['text'], cost: DEEPSEEK_COST, contextWindow: 1_000_000, maxTokens: 384_000,
        }),
      ],
      api: anthropicMessagesApi(),
    }),
  );
}
