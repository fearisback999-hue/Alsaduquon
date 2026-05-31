import { getOpenAI } from "./client";

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  scores: Record<string, number>;
}

// Trademarked terms — using one in a listing risks IP takedown and account
// suspension across every platform we publish to. The list is intentionally
// broad and includes brand variants, character names, franchise titles, and
// known licensor IPs. False positives are cheaper than account loss.
const ETSY_BANNED_TERMS = [
  // Generic IP red flags
  "trademark", "trademarked", "copyright", "copyrighted", "licensed",

  // Disney universe
  "disney", "mickey mouse", "minnie mouse", "donald duck", "goofy", "pluto",
  "frozen", "elsa", "anna", "olaf", "moana", "encanto", "stitch", "lilo",
  "toy story", "buzz lightyear", "woody", "cars", "lightning mcqueen",
  "finding nemo", "dory", "the little mermaid", "ariel",
  "winnie the pooh", "tigger", "eeyore", "mulan", "aladdin", "jasmine",
  "tinkerbell", "peter pan", "snow white", "cinderella", "rapunzel",

  // Marvel / DC
  "marvel", "avengers", "spider-man", "spiderman", "iron man", "captain america",
  "thor", "hulk", "black widow", "hawkeye", "doctor strange", "deadpool",
  "wolverine", "x-men", "guardians of the galaxy", "loki", "wanda",
  "dc comics", "batman", "superman", "wonder woman", "the flash",
  "aquaman", "joker", "harley quinn", "robin", "bat signal",

  // Star Wars
  "star wars", "darth vader", "yoda", "baby yoda", "grogu", "mandalorian",
  "skywalker", "jedi", "sith", "lightsaber", "millennium falcon",
  "stormtrooper", "boba fett", "han solo", "princess leia", "obi-wan",

  // Harry Potter / Wizarding World
  "harry potter", "hogwarts", "gryffindor", "slytherin", "hufflepuff",
  "ravenclaw", "dumbledore", "voldemort", "hermione", "ron weasley",
  "wizarding world", "muggle", "death eater", "expecto patronum",

  // Other major franchises
  "pokemon", "pikachu", "charizard", "pokeball",
  "nintendo", "super mario", "mario bros", "luigi", "zelda", "link",
  "donkey kong", "kirby", "metroid",
  "minecraft", "creeper", "enderman",
  "fortnite", "epic games",
  "minions", "despicable me", "gru",
  "sesame street", "elmo", "big bird", "cookie monster",
  "snoopy", "peanuts", "charlie brown",
  "looney tunes", "bugs bunny", "daffy duck",
  "scooby doo", "scooby-doo",
  "hello kitty", "sanrio", "my melody", "kuromi",
  "the simpsons", "homer simpson", "bart simpson",
  "south park", "family guy", "rick and morty",
  "sponge bob", "spongebob", "patrick star",
  "transformers", "optimus prime",
  "barbie", "mattel",
  "lego",
  "playboy", "playboy bunny",
  "betty boop",
  "paw patrol",

  // Sports leagues
  "nfl", "nba", "mlb", "nhl", "mls", "fifa", "uefa", "premier league",
  "formula 1", "formula one", "f1 racing", "nascar", "indycar",
  "olympic", "olympics", "super bowl", "world cup", "world series",

  // Big tech / brands
  "apple", "iphone", "ipad", "ipod", "macbook", "airpods",
  "google", "youtube", "android",
  "microsoft", "windows", "xbox", "playstation",
  "samsung", "galaxy s",
  "facebook", "instagram", "tiktok logo", "twitter logo", "snapchat",
  "amazon prime", "netflix", "hulu", "disney+", "spotify",

  // Beverage / food
  "coca-cola", "coca cola", "pepsi", "starbucks frappuccino", "starbucks logo",
  "mcdonald's", "mcdonalds", "burger king", "kfc", "taco bell",
  "red bull", "monster energy",

  // Luxury fashion
  "supreme", "supreme box logo", "off-white", "gucci", "louis vuitton",
  "chanel", "versace", "prada", "balenciaga", "fendi", "dior",
  "hermes", "burberry", "yves saint laurent", "ysl",
  "rolex", "cartier", "tiffany & co",

  // Athletic brands
  "nike", "swoosh", "adidas", "three stripes", "puma", "under armour",
  "lululemon", "the north face", "patagonia logo",

  // Music acts (full names commonly trademarked)
  "taylor swift", "beyonce", "rihanna", "drake the rapper",
  "the beatles", "rolling stones logo", "led zeppelin",
  "grateful dead",
  "bts", "blackpink",

  // Motorcycle / auto
  "harley davidson", "harley-davidson",
  "ferrari logo", "lamborghini logo", "porsche logo",
  "tesla motors",

  // Misc high-risk
  "us army logo", "us navy logo", "marines logo", "air force logo",

  // More franchises / characters (high-DMCA categories)
  "bluey", "peppa pig", "cocomelon", "paw patrol", "pj masks",
  "sonic the hedgehog", "kirby", "animal crossing", "splatoon",
  "naruto", "dragon ball", "goku", "one piece", "demon slayer",
  "attack on titan", "my hero academia", "studio ghibli", "totoro",
  "sailor moon", "hello kitty", "stranger things", "squid game",
  "wednesday addams", "the office", "friends tv", "game of thrones",
  "the mandalorian", "ted lasso", "barbie movie",
  "grinch", "dr seuss", "cat in the hat",
  "garfield", "snoopy", "calvin and hobbes",
  "bob ross", "where's waldo",

  // Memes / web IP with active rights holders
  "pepe the frog", "wojak", "grumpy cat", "nyan cat",
  "doge", "shrek", "baby shark",

  // Streamers / influencers / creators (right of publicity)
  "mrbeast", "mr beast", "pewdiepie", "ninja gamer",
  "kardashian", "kylie jenner", "kim kardashian",

  // Music acts (likeness/marks)
  "ariana grande", "billie eilish", "olivia rodrigo", "harry styles",
  "the weeknd", "kanye west", "kendrick lamar", "travis scott",
  "nirvana", "metallica", "pink floyd", "ac/dc",

  // Sports teams / orgs (city + name combos are trademarked)
  "lakers", "yankees", "cowboys", "patriots", "real madrid",
  "manchester united", "barcelona fc", "golden state warriors",

  // More auto / brands
  "jeep", "ford mustang", "chevy", "corvette", "bmw logo",
  "mercedes logo", "audi logo", "toyota logo",

  // More luxury / streetwear
  "stussy", "bape", "a bathing ape", "yeezy", "jordan brand",
  "air jordan", "new balance", "crocs", "uggs",

  // Misc brands frequently infringed
  "stanley cup tumbler", "yeti cooler", "in-n-out", "trader joe's",
  "lululemon", "sephora", "hot wheels", "barbie doll",
];

// Pattern-based IP red flags — deliberately HIGH-PRECISION. These phrasings
// almost always indicate derivative/infringing intent and rarely appear in
// legitimate original listings. We intentionally do NOT flag common, legal
// niche words like "aesthetic", "style", "themed", or bare "inspired" —
// "boho aesthetic poster" and "nature inspired wall art" are perfectly fine,
// and blocking them would gut the catalog (false positives cost revenue too).
// The exact-term blocklist above is the main workhorse; these catch the
// evasions that slip brand names past it.
const RISKY_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfan\s*art\b/i, label: '"fan art" (unlicensed derivative)' },
  { pattern: /\bfan[\s-]*made\b/i, label: '"fan made" (unlicensed derivative)' },
  { pattern: /\bin the style of\b/i, label: '"in the style of" (copies a specific artist/brand)' },
  { pattern: /\b(?:un)?official\s+\w+\s*(?:merch|merchandise)\b/i, label: 'brand merch claim ("official/unofficial ... merch")' },
  { pattern: /\bofficial merchandise\b/i, label: '"official merchandise" (implies licensed brand goods)' },
  { pattern: /\bparody of\b/i, label: '"parody of" (names a specific IP)' },
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
    const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(lower)) {
      violations.push(`Contains potentially trademarked term: "${term}"`);
    }
  }

  for (const { pattern, label } of RISKY_PATTERNS) {
    if (pattern.test(lower)) {
      violations.push(`Matches IP-risk pattern: ${label}`);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Synchronous IP screen for a niche keyword at discovery time, before any
 * money is spent generating concepts/images for it. A trademarked or
 * derivative niche name poisons the entire downstream pipeline (concepts,
 * image prompts, titles, tags), so we reject it at the source rather than
 * hoping later moderation catches every leaf. Returns the first violation
 * reason for logging, or null when the keyword is clean.
 */
export function screenNicheForIP(keyword: string): string | null {
  const { passed, violations } = checkEtsyPolicy(keyword);
  return passed ? null : violations[0];
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
