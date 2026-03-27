import { getOpenAI } from "./client";

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  scores: Record<string, number>;
}

// Etsy-specific keywords that violate their policies
const ETSY_BANNED_TERMS = [
  "trademark", "disney", "nike", "marvel", "nfl", "nba", "mlb",
  "harry potter", "star wars", "pokemon", "nintendo", "coca-cola",
  "supreme", "gucci", "louis vuitton", "chanel", "versace",
];

export async function moderateContent(text: string): Promise<ModerationResult> {
  const openai = getOpenAI();

  const response = await openai.moderations.create({
    input: text,
    model: "omni-moderation-latest",
  });

  const result = response.results[0];
  const flaggedCategories = Object.entries(result.categories)
    .filter(([, flagged]) => flagged)
    .map(([category]) => category);

  return {
    flagged: result.flagged,
    categories: flaggedCategories,
    scores: result.category_scores as unknown as Record<string, number>,
  };
}

export function checkEtsyPolicy(text: string): { passed: boolean; violations: string[] } {
  const lower = text.toLowerCase();
  const violations: string[] = [];

  for (const term of ETSY_BANNED_TERMS) {
    if (lower.includes(term)) {
      violations.push(`Contains potentially trademarked term: "${term}"`);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

export async function fullModeration(text: string): Promise<{
  passed: boolean;
  openaiResult: ModerationResult;
  etsyResult: { passed: boolean; violations: string[] };
}> {
  const [openaiResult, etsyResult] = await Promise.all([
    moderateContent(text),
    Promise.resolve(checkEtsyPolicy(text)),
  ]);

  return {
    passed: !openaiResult.flagged && etsyResult.passed,
    openaiResult,
    etsyResult,
  };
}
