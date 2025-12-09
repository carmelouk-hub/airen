import { NextResponse } from "next/server";
import { getArchitectureSnapshot } from "@/lib/architecture";

export async function GET() {
  const snapshot = getArchitectureSnapshot();
  return NextResponse.json({
    regressionSuites: snapshot.regressionSuites,
  });
}
