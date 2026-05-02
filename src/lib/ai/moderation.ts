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
