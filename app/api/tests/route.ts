import { regressionSuites } from "@/lib/architecture";

export async function GET() {
  return Response.json({ regressionSuites });
}
