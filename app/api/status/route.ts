import { NextResponse } from "next/server";
import { getArchitectureSnapshot, getOperationalScore } from "@/lib/architecture";

export async function GET() {
  const snapshot = getArchitectureSnapshot();
  const operationalScore = getOperationalScore();

  return NextResponse.json({
    operationalScore,
    serviceAreas: snapshot.serviceAreas,
    aryaStreams: snapshot.aryaStreams,
  });
}
