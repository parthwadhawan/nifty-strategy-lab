// Server-only helpers for calling Claude via the Anthropic Messages API.
const API = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com") + "/v1";

let cachedModels: string[] | null = null;

export function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function headers() {
  return {
    "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
}

async function listModels(): Promise<string[]> {
  if (cachedModels) return cachedModels;
  try {
    const r = await fetch(`${API}/models?limit=100`, { headers: headers() });
    const j = await r.json();
    cachedModels = (j.data ?? []).map((m: any) => m.id as string); // newest first
  } catch {
    cachedModels = [];
  }
  return cachedModels!;
}

/** Pick a model: explicit env var wins, otherwise the newest model of the preferred family. */
export async function pickModel(kind: "fast" | "deep"): Promise<string> {
  const env = kind === "fast" ? process.env.ANTHROPIC_MODEL : process.env.ANTHROPIC_ANALYSIS_MODEL || process.env.ANTHROPIC_MODEL;
  if (env) return env;
  const ms = await listModels();
  const fam = kind === "fast" ? ["sonnet", "opus"] : ["opus", "sonnet"];
  for (const f of fam) {
    const m = ms.find((id) => id.includes(f));
    if (m) return m;
  }
  return ms[0] ?? "claude-sonnet-4-5";
}

export async function callTool<T>(opts: {
  kind: "fast" | "deep";
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: object;
  maxTokens?: number;
}): Promise<{ data: T; model: string }> {
  const model = await pickModel(opts.kind);
  const r = await fetch(`${API}/messages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.schema }],
      tool_choice: { type: "tool", name: opts.toolName },
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? `Anthropic API error ${r.status}`);
  const block = (j.content ?? []).find((b: any) => b.type === "tool_use");
  if (!block) throw new Error("The model did not return structured output");
  return { data: block.input as T, model };
}
