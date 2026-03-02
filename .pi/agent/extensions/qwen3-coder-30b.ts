import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("local-llm", {
    // Replace this URL with your local runner's OpenAI-compatible endpoint.
    // Ollama: http://127.0.0.1:11434/v1
    // LM Studio: http://127.0.0.1:1234/v1
    // vLLM: http://127.0.0.1:8000/v1
    baseUrl: "http://127.0.0.1:11434/v1",

    // Local providers usually don't need a real key, but some require a dummy string
    apiKey: "sk-dummy-key",

    // We use the OpenAI completions API format since most local servers emulate it
    api: "openai-completions",

    models: [
      {
        // This MUST match the exact model name/tag in your local runner
        // e.g. "qwen3-coder:30b" or whatever tag you used to pull/load it
        id: "qwen3-coder:30b",
        name: "Qwen3 Coder 30B",

        // Coder model is text-only
        input: ["text"],

        // qwen3-coder:30b in Ollama is the thinking variant
        reasoning: true,

        // Local models are free!
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },

        // Qwen3-Coder 30B supports 262K native context
        contextWindow: 262144,
        maxTokens: 32768,

        // Qwen and local runners sometimes require specific OpenAI API quirks:
        compat: {
          // If you are using older Ollama/LM Studio versions, they might expect max_tokens
          maxTokensField: "max_tokens",
          // Parse Qwen-style reasoning traces correctly
          thinkingFormat: "qwen",
        },
      },
    ],
  });
}
