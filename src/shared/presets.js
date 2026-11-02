// OpenAI-compatible servers HOLODESK knows how to reach. Shared so the settings
// schema, the status bar and the uplink overlay agree on ids and labels.
export const COMPAT_PRESETS = {
  ollama: { label: 'Ollama', url: 'http://localhost:11434/v1', needsKey: false, help: 'https://ollama.com/download', helpText: 'GET OLLAMA ↗' },
  lmstudio: { label: 'LM Studio', url: 'http://localhost:1234/v1', needsKey: false, help: 'https://lmstudio.ai/', helpText: 'GET LM STUDIO ↗' },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', needsKey: true, help: 'https://console.groq.com/keys', helpText: 'GET A KEY ↗' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', needsKey: true, help: 'https://openrouter.ai/keys', helpText: 'GET A KEY ↗' },
  custom: { label: 'Custom', url: '', needsKey: false, help: '', helpText: '' }
};

// Offered by one-click setup. Sizes are the download; RAM/VRAM needs are a bit more.
export const OLLAMA_MODELS = [
  { id: 'llama3.2', label: 'Llama 3.2 3B · 2 GB · fast, any PC' },
  { id: 'gemma3:4b', label: 'Gemma 3 4B · 3.3 GB · balanced' },
  { id: 'qwen3:8b', label: 'Qwen 3 8B · 5.2 GB · smartest, 8 GB+ GPU' }
];
