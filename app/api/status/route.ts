import { aiEnabled, pickModel } from "@/lib/llm";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!aiEnabled()) return Response.json({ ai: false });
  try {
    const [fast, deep] = await Promise.all([pickModel("fast"), pickModel("deep")]);
    return Response.json({ ai: true, fast, deep });
  } catch {
    return Response.json({ ai: true });
  }
}
