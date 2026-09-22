/** Browser destinations only. No API keys, HTTP inference or private endpoints. */
export const WEB_PROVIDERS = ["chatgpt-web", "deepseek-web", "claude-web", "gemini-web"] as const;
export type WebProvider = typeof WEB_PROVIDERS[number];
export const TARGET_PROVIDERS = ["chatgpt-chat", "deepseek-chat", "claude-chat", "gemini-chat"] as const;
export type TargetProvider = typeof TARGET_PROVIDERS[number];

export const WEB_CONFIG = {
  "chatgpt-web": {
    name: "ChatGPT", profile: "chatgpt", url: "https://chatgpt.com/",
    input: 'div#prompt-textarea[contenteditable="true"]:visible, div[contenteditable="true"][data-placeholder]:visible, textarea:visible',
  },
  "deepseek-web": {
    name: "DeepSeek", profile: "deepseek", url: "https://chat.deepseek.com/",
    input: 'textarea#chat-input:visible, textarea[placeholder]:visible',
  },
  "claude-web": {
    name: "Claude", profile: "claude", url: "https://claude.ai/new",
    input: 'div[contenteditable="true"].ProseMirror:visible, div[contenteditable="true"][data-placeholder]:visible',
  },
  "gemini-web": {
    name: "Gemini", profile: "gemini", url: "https://gemini.google.com/app",
    input: 'rich-textarea [contenteditable="true"][role="textbox"]:visible',
  },
} satisfies Record<WebProvider, { name: string; profile: string; url: string; input: string }>;

export function isWebProvider(value: unknown): value is WebProvider {
  return typeof value === "string" && (WEB_PROVIDERS as readonly string[]).includes(value);
}
export function webProvider(value: string = "chatgpt-web"): WebProvider {
  if (!isWebProvider(value)) throw new Error(`Invalid web provider: ${value}. Use ${WEB_PROVIDERS.join(", ")}.`);
  return value;
}
export function targetForWeb(provider: WebProvider): TargetProvider {
  return provider.replace(/-web$/, "-chat") as TargetProvider;
}
export function webForTarget(target: string): WebProvider {
  return webProvider(target.replace(/-chat$/, "-web"));
}
export function assertWebTarget(target: string | undefined, provider: WebProvider): void {
  if (target && target !== targetForWeb(provider)) throw new Error(`Selected request targets ${target}; delivery is ${provider}. Prepare a request with --target-provider ${targetForWeb(provider)} before sending.`);
}
