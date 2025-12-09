import { NextResponse } from "next/server";
import { getArchitectureSnapshot } from "@/lib/architecture";

export async function GET() {
  const snapshot = getArchitectureSnapshot();
  return NextResponse.json({
    timeline2050: snapshot.timeline2050,
  });
}
