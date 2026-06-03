import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { designConcepts, generatedImages, niches } from "@/lib/db/schema";
import { desc, inArray } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;
  const concepts = await db
    .select()
    .from(designConcepts)
    .orderBy(desc(designConcepts.createdAt))
    .limit(100)
    .all();

  if (concepts.length === 0) {
    return NextResponse.json({ designs: [] });
  }

  // Batch-fetch images and niches for all concepts in two queries instead of
  // two per concept (was 200 round-trips for a 100-design page).
  const conceptIds = concepts.map((c) => c.id);
  const nicheIds = Array.from(new Set(concepts.map((c) => c.nicheId)));

  const [allImages, allNiches] = await Promise.all([
    db.select().from(generatedImages).where(inArray(generatedImages.designConceptId, conceptIds)).all(),
    db.select({ id: niches.id, name: niches.name }).from(niches).where(inArray(niches.id, nicheIds)).all(),
  ]);

  const imagesByConcept = new Map<string, typeof allImages>();
  for (const img of allImages) {
    const arr = imagesByConcept.get(img.designConceptId) ?? [];
    arr.push(img);
    imagesByConcept.set(img.designConceptId, arr);
  }
  const nicheById = new Map(allNiches.map((n) => [n.id, n]));

  const enriched = concepts.map((concept) => {
    const niche = nicheById.get(concept.nicheId);
    return {
      ...concept,
      images: imagesByConcept.get(concept.id) ?? [],
      niche: niche ? { name: niche.name } : null,
    };
  });

  return NextResponse.json({ designs: enriched });
}
