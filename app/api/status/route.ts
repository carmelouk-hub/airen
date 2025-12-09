import { getArchitectureSnapshot, getOperationalScore } from "@/lib/architecture";

export async function GET() {
  const snapshot = getArchitectureSnapshot();
  const score = getOperationalScore();

  return Response.json({ snapshot, score });
}
