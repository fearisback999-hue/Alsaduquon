/**
 * Seasonal product calendar for Etsy POD.
 * Returns active seasons with prep windows so the pipeline can
 * boost seasonal niches and inject seasonal design themes.
 */

export interface Season {
  name: string;
  /** Keywords/themes to inject into concept prompts */
  themes: string[];
  /** Prep window: design should START by this date */
  prepStart: { month: number; day: number };
  /** Prep window: design should END by this date */
  prepEnd: { month: number; day: number };
  /** Score boost applied to seasonal niches during prep window */
  scoreBoost: number;
}

const SEASONAL_CALENDAR: Season[] = [
  {
    name: "Valentine's Day",
    themes: ["love", "romance", "couples", "hearts", "galentine", "funny valentine"],
    prepStart: { month: 12, day: 15 },
    prepEnd: { month: 2, day: 10 },
    scoreBoost: 1.0,
  },
  {
    name: "Mother's Day",
    themes: ["mom", "mother", "mama", "floral", "nurturing", "family love"],
    prepStart: { month: 3, day: 1 },
    prepEnd: { month: 5, day: 5 },
    scoreBoost: 1.0,
  },
  {
    name: "Father's Day",
    themes: ["dad", "father", "papa", "dad jokes", "fishing", "grilling", "tools"],
    prepStart: { month: 4, day: 15 },
    prepEnd: { month: 6, day: 15 },
    scoreBoost: 0.8,
  },
  {
    name: "Graduation Season",
    themes: ["graduation", "class of", "graduate", "diploma", "college", "achievement"],
    prepStart: { month: 3, day: 15 },
    prepEnd: { month: 6, day: 15 },
    scoreBoost: 0.6,
  },
  {
    name: "Back to School",
    themes: ["school", "teacher", "student", "classroom", "learning", "education"],
    prepStart: { month: 6, day: 1 },
    prepEnd: { month: 8, day: 25 },
    scoreBoost: 0.8,
  },
  {
    name: "Halloween",
    themes: ["spooky", "halloween", "witch", "ghost", "pumpkin", "horror", "skeleton", "gothic"],
    prepStart: { month: 8, day: 1 },
    prepEnd: { month: 10, day: 25 },
    scoreBoost: 1.2,
  },
  {
    name: "Thanksgiving",
    themes: ["thankful", "grateful", "thanksgiving", "autumn", "fall harvest", "turkey"],
    prepStart: { month: 9, day: 15 },
    prepEnd: { month: 11, day: 20 },
    scoreBoost: 0.6,
  },
  {
    name: "Christmas & Holiday",
    themes: ["christmas", "holiday", "winter", "santa", "festive", "merry", "joyful", "snow", "reindeer"],
    prepStart: { month: 9, day: 15 },
    prepEnd: { month: 12, day: 15 },
    scoreBoost: 1.5,
  },
  {
    name: "Summer Vibes",
    themes: ["summer", "beach", "tropical", "vacation", "sunshine", "outdoor adventure"],
    prepStart: { month: 4, day: 1 },
    prepEnd: { month: 7, day: 31 },
    scoreBoost: 0.5,
  },
  {
    name: "New Year",
    themes: ["new year", "resolution", "fresh start", "cheers", "celebrate"],
    prepStart: { month: 11, day: 15 },
    prepEnd: { month: 1, day: 10 },
    scoreBoost: 0.5,
  },
];

/**
 * Check if a date falls within a season's prep window.
 * Handles year-wrapping windows (e.g., Dec 15 → Feb 10).
 */
function isInPrepWindow(date: Date, season: Season): boolean {
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();

  const { prepStart, prepEnd } = season;

  // Year-wrapping window (e.g., Dec → Feb)
  if (prepStart.month > prepEnd.month) {
    if (month > prepStart.month || (month === prepStart.month && day >= prepStart.day)) return true;
    if (month < prepEnd.month || (month === prepEnd.month && day <= prepEnd.day)) return true;
    return false;
  }

  // Normal window within same year
  const afterStart = month > prepStart.month || (month === prepStart.month && day >= prepStart.day);
  const beforeEnd = month < prepEnd.month || (month === prepEnd.month && day <= prepEnd.day);
  return afterStart && beforeEnd;
}

/**
 * Get all currently active seasons based on today's date.
 */
export function getActiveSeasons(date?: Date): Season[] {
  const now = date ?? new Date();
  return SEASONAL_CALENDAR.filter((season) => isInPrepWindow(now, season));
}

/**
 * Check if a niche name matches any active seasonal themes.
 * Returns the matching season with the highest score boost, or null.
 */
export function matchNicheToSeason(nicheName: string, activeSeasons?: Season[]): Season | null {
  const seasons = activeSeasons ?? getActiveSeasons();
  const lower = nicheName.toLowerCase();

  let bestMatch: Season | null = null;

  for (const season of seasons) {
    for (const theme of season.themes) {
      if (lower.includes(theme)) {
        if (!bestMatch || season.scoreBoost > bestMatch.scoreBoost) {
          bestMatch = season;
        }
        break;
      }
    }
  }

  return bestMatch;
}

/**
 * Format active seasons as context for concept generation prompts.
 */
export function formatSeasonalContext(): string {
  const active = getActiveSeasons();
  if (active.length === 0) return "";

  const seasonNames = active.map((s) => s.name).join(", ");
  const allThemes = active.flatMap((s) => s.themes).slice(0, 15).join(", ");

  return `SEASONAL CONTEXT (current active seasons: ${seasonNames}):
Include seasonal/holiday elements where appropriate. Trending seasonal themes: ${allThemes}.
If the niche naturally aligns with a current season, lean into seasonal designs — they sell 2-5x more during peak windows.`;
}
