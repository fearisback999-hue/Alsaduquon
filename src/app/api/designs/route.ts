import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { designConcepts, generatedImages, niches } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const concepts = await db
    .select()
    .from(designConcepts)
    .orderBy(desc(designConcepts.createdAt))
    .limit(100)
    .all();

  const enriched = await Promise.all(
    concepts.map(async (concept) => {
      const images = await db
        .select()
        .from(generatedImages)
        .where(eq(generatedImages.designConceptId, concept.id))
        .all();
      const niche = await db
        .select()
        .from(niches)
        .where(eq(niches.id, concept.nicheId))
        .get();
      return { ...concept, images, niche: niche ? { name: niche.name } : null };
    }),
  );

  return NextResponse.json({ designs: enriched });
}
