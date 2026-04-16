import { distance } from 'fastest-levenshtein';

// Hebrew day names to day-of-week offset
const HEBREW_DAYS: Record<string, number> = {
  'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3,
  'חמישי': 4, 'שישי': 5, 'שבת': 6,
  'יום ראשון': 0, 'יום שני': 1, 'יום שלישי': 2,
  'יום רביעי': 3, 'יום חמישי': 4, 'יום שישי': 5,
};

const RELATIVE_DATES: Record<string, number> = {
  'היום': 0,
  'מחר': 1,
  'מחרתיים': 2,
};

export interface ParsedMessage {
  name?: string;
  date?: Date;
  time?: string;
}

/**
 * Parse a Hebrew free-text message to extract student name, date, and time
 */
export function parseMessage(text: string): ParsedMessage {
  const result: ParsedMessage = {};

  // Extract time (HH:MM format)
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      result.time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }

  // Also try "בשעה X" pattern without colon
  if (!result.time) {
    const hebrewTimeMatch = text.match(/בשעה\s+(\d{1,2})(?::(\d{2}))?/);
    if (hebrewTimeMatch) {
      const hours = parseInt(hebrewTimeMatch[1]);
      const minutes = hebrewTimeMatch[2] ? parseInt(hebrewTimeMatch[2]) : 0;
      if (hours >= 0 && hours <= 23) {
        result.time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      }
    }
  }

  // Extract date
  result.date = parseDate(text);

  // Extract name - remove date/time parts and common words
  result.name = extractName(text);

  return result;
}

const ISRAEL_TZ = 'Asia/Jerusalem';

// "Today" as seen in Israel, regardless of the server's local timezone.
function todayInIsrael(): { year: number; month: number; day: number; dow: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ISRAEL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);

  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const year = parseInt(get('year'));
  const month = parseInt(get('month')) - 1;
  const day = parseInt(get('day'));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get('weekday')] ?? 0;
  return { year, month, day, dow };
}

function parseDate(text: string): Date | undefined {
  const today = todayInIsrael();

  // Check relative dates (היום, מחר, מחרתיים).
  // Sort by length desc so "מחרתיים" matches before "מחר" (which is a substring).
  const relativeEntries = Object.entries(RELATIVE_DATES).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [word, offset] of relativeEntries) {
    if (text.includes(word)) {
      return new Date(today.year, today.month, today.day + offset);
    }
  }

  // Check Hebrew day names (יום ראשון, etc.)
  for (const [dayName, targetDay] of Object.entries(HEBREW_DAYS)) {
    if (text.includes(dayName)) {
      let daysToAdd = targetDay - today.dow;
      if (daysToAdd <= 0) daysToAdd += 7;
      return new Date(today.year, today.month, today.day + daysToAdd);
    }
  }

  // Check DD/MM or DD.MM format
  const dateMatch = text.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]) - 1;
    const year = dateMatch[3]
      ? parseInt(dateMatch[3]) < 100
        ? 2000 + parseInt(dateMatch[3])
        : parseInt(dateMatch[3])
      : today.year;

    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      return new Date(year, month, day);
    }
  }

  return undefined;
}

function extractName(text: string): string | undefined {
  let cleaned = text;

  // Remove time patterns
  cleaned = cleaned.replace(/(\d{1,2}):(\d{2})/g, '');
  cleaned = cleaned.replace(/בשעה\s+\d{1,2}(?::\d{2})?/g, '');

  // Remove date patterns
  cleaned = cleaned.replace(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/g, '');

  // Remove relative dates and day names
  const dateWords = [...Object.keys(RELATIVE_DATES), ...Object.keys(HEBREW_DAYS)];
  for (const word of dateWords) {
    cleaned = cleaned.replace(new RegExp(word, 'g'), '');
  }

  // Remove common filler words (Hebrew doesn't support \b, use spaces/boundaries)
  const fillerWords = ['שלום', 'היי', 'אני', 'רוצה', 'צריך', 'צריכה', 'לקחת', 'את', 'של', 'בבקשה', 'אפשר', 'להוציא', 'יציאה', 'עבור', 'בשעה'];
  for (const word of fillerWords) {
    cleaned = cleaned.replace(new RegExp(`(?:^|\\s)${word}(?:\\s|$)`, 'g'), ' ');
  }

  // Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned || undefined;
}

/**
 * Match a name against a list of student names using Levenshtein distance
 */
export function matchStudentName(
  input: string,
  students: Array<{ id: number; firstName: string; lastName: string }>
): Array<{ id: number; firstName: string; lastName: string; score: number }> {
  if (!input) return [];

  const inputLower = input.trim();

  return students
    .map(student => {
      const fullName = `${student.firstName} ${student.lastName}`;
      const firstNameDist = distance(inputLower, student.firstName);
      const lastNameDist = distance(inputLower, student.lastName);
      const fullNameDist = distance(inputLower, fullName);

      // Take the best match
      const bestDist = Math.min(firstNameDist, lastNameDist, fullNameDist);
      const maxLen = Math.max(inputLower.length, fullName.length);
      const score = 1 - bestDist / maxLen;

      return { ...student, score };
    })
    .filter(s => s.score > 0.4)
    .sort((a, b) => b.score - a.score);
}

/**
 * Parse teacher response (approval/rejection)
 */
export function parseTeacherResponse(text: string): 'approve' | 'reject' | null {
  const cleaned = text.trim();

  // Check for numbered response
  if (cleaned === '1' || cleaned.includes('אישור') || cleaned.includes('מאשר') || cleaned.includes('מאשרת') || cleaned.includes('✅')) {
    return 'approve';
  }
  if (cleaned === '2' || cleaned.includes('דחייה') || cleaned.includes('דוחה') || cleaned.includes('❌') || cleaned.includes('לא מאשר')) {
    return 'reject';
  }

  return null;
}

/**
 * Parse "<request-num> <1|2>" when a teacher has multiple pending requests.
 * Returns { index, action } or null if ambiguous.
 */
export function parseTeacherPickedResponse(
  text: string,
  count: number
): { index: number; action: 'approve' | 'reject' } | null {
  const parts = text.trim().split(/[\s,.\-]+/).filter(Boolean);
  if (parts.length < 2) return null;

  const reqNum = parseInt(parts[0]);
  if (isNaN(reqNum) || reqNum < 1 || reqNum > count) return null;

  const action = parseTeacherResponse(parts.slice(1).join(' '));
  if (!action) return null;

  return { index: reqNum - 1, action };
}

/**
 * Parse parent escalation choice
 */
export function parseEscalationChoice(text: string): 'wait' | 'secretary' | 'principal' | null {
  const cleaned = text.trim();

  // Check keywords first (more specific than digits).
  if (cleaned.includes('מזכירות')) return 'secretary';
  if (cleaned.includes('מנהל')) return 'principal';
  if (cleaned.includes('המתן') || cleaned.includes('ממתין')) return 'wait';

  if (cleaned === '1') return 'wait';
  if (cleaned === '2') return 'secretary';
  if (cleaned === '3') return 'principal';
  return null;
}
