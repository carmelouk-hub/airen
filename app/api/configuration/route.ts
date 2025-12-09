import { configurationProfile } from "@/lib/architecture";

export async function GET() {
  return Response.json({ configuration: configurationProfile });
}
