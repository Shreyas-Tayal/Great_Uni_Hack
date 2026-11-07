// ONE place to connect everything. These are public URLs/IDs, not secrets.
// (API keys for Claude + ElevenLabs live only inside n8n.)
// Leave a value empty to use built-in demo data for that part.
export const CONFIG = {
  ENGINE_URL: (import.meta.env.VITE_ENGINE_URL as string) || "",     // e.g. https://xyz.trycloudflare.com
  N8N_URL: (import.meta.env.VITE_N8N_URL as string) || "",           // e.g. https://you.app.n8n.cloud
  ELEVEN_AGENT_ID: (import.meta.env.VITE_ELEVEN_AGENT_ID as string) || "", // ElevenLabs practice-call agent
};
