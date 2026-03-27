import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const openAICompat = {
  // Fireworks OpenAI compatibility expects max_tokens (not max_completion_tokens).
  maxTokensField: "max_tokens" as const,
  // Keep system prompts in the standard "system" role for broad compatibility.
  supportsDeveloperRole: false,
  // Non-reasoning models should ignore reasoning controls.
  supportsReasoningEffort: false,
};

const fireworksReasoningCompat = {
  ...openAICompat,
  // Fireworks supports reasoning_effort on reasoning-capable models.
  supportsReasoningEffort: true,
  // Fireworks accepts low|medium|high|none. Map pi levels accordingly.
  reasoningEffortMap: {
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "high",
  },
};
export default function (pi: ExtensionAPI) {
  pi.registerProvider("fireworks", {
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKey: "FIREWORKS_API_KEY",
    api: "openai-completions",

    // NOTE: these IDs were verified against Fireworks API in March 2026.
    // Some older IDs (e.g. deepseek-v3, qwen2p5-coder-32b-instruct, qwen2-vl-72b-instruct)
    // now return NOT_FOUND for this endpoint/account.
    models: [
      {
        id: "accounts/fireworks/models/kimi-k2p5",
        name: "Kimi K2.5 (Fireworks)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 16384,
        compat: fireworksReasoningCompat,
      },
      {
        id: "accounts/fireworks/models/deepseek-v3p2",
        name: "DeepSeek V3.2 (Fireworks)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 163840,
        maxTokens: 16384,
        compat: fireworksReasoningCompat,
      },
      {
        id: "accounts/fireworks/models/deepseek-v3p1",
        name: "DeepSeek V3.1 (Fireworks)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 163840,
        maxTokens: 16384,
        compat: fireworksReasoningCompat,
      },
      {
        id: "accounts/fireworks/models/glm-5",
        name: "GLM-5 (Fireworks)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 202752,
        maxTokens: 16384,
        compat: fireworksReasoningCompat,
      },
      {
        id: "accounts/fireworks/models/glm-4p7",
        name: "GLM-4.7 (Fireworks)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 202752,
        maxTokens: 16384,
        compat: fireworksReasoningCompat,
      },
      {
        id: "accounts/fireworks/models/gpt-oss-120b",
        name: "GPT-OSS 120B (Fireworks)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: fireworksReasoningCompat,
      },
      {
        id: "accounts/fireworks/models/mixtral-8x22b-instruct",
        name: "Mixtral 8x22B Instruct (Fireworks)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 65536,
        maxTokens: 8192,
        compat: openAICompat,
      },
    ],
  });
}
