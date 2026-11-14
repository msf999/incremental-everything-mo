// lib/rotation.ts
// FORK-ONLY (2026-11-14, owner request).
//
// The Rotation property of an Incremental Rem, read as plain language.
//
// Two families of rule:
//
//  - INTERVALS, counted from the day of the review, as Rotation always worked:
//    "5", "5 days", "2 weeks", "6 months", "1 week 2 days", "daily", "weekly", "0" (always due).
//
//  - CALENDAR rules, which name the days an item comes back on:
//    "sunday", "mon, wed, fri", "weekdays", "weekends", "every 2 weeks on monday",
//    "every other friday", "1st", "every 1st of the month", "1st and 15th",
//    "last day of the month", "first saturday of the month", "last friday",
//    "last weekday of the month", "every 3 months on the 1st", "3 march".
//    The next date is the first such day AFTER the day of the review.
//
// A calendar rule that skips ("every 2 weeks …", "every 3 months …") keeps its rhythm: the
// weeks or months it lands on are counted from the item's current due date, so a late review
// does not shift the series (due Mon 2 Nov, reviewed Wed 4 Nov, "every 2 weeks on monday"
// -> Mon 16 Nov). When the due date is not a day the rule could have produced — the rule was
// just written — there is no rhythm to keep and the series starts at the next matching day.
//
// Pure: no SDK, no storage, dates passed in. `rotation.test.ts` runs under plain Node.

import parseDuration from 'parse-duration';

const MS_PER_DAY = 86_400_000;
/** An interval longer than this (100 years) is a typo, not a schedule. */
const MAX_INTERVAL_DAYS = 36_500;
/**
 * How far ahead a calendar rule is searched for its next day: 41 years. The rarest day a
 * rule can name is a 29 February on a given weekday ("fifth monday of february"), which
 * comes round within 40 years; everything else is found in days or months.
 */
const MAX_SCAN_DAYS = 15_000;
/**
 * The longest skip a calendar rule may have ("every N weeks on …", "every N months on …"):
 * ten years. Longer is a typo, and it keeps one whole period well inside the search above.
 */
const MAX_SKIP_WEEKS = 520;
const MAX_SKIP_MONTHS = 120;

/** `penultimate`: the one before the last ("second last friday", "second to last weekday"). */
export type DayOrdinal = 1 | 2 | 3 | 4 | 5 | 'last' | 'penultimate';

export type MonthDaySpec =
  /** A day of the month. A day the month does not have (the 31st in April) means its last day. */
  | { on: 'date'; day: number | 'last' }
  /**
   * The nth (or last) weekday of the month. `asClass`: the weekdays are one group — "first
   * weekday" is the first day that is any of Mon–Fri, not the first Monday, first Tuesday, ….
   */
  | { on: 'weekday'; ordinal: DayOrdinal; weekdays: number[]; asClass: boolean };

export type RotationRule =
  /** Nothing written, or "default": the scheduler decides. */
  | { kind: 'none' }
  /** Written, and not understood. The scheduler decides, and the UI says so. */
  | { kind: 'invalid'; text: string }
  /** N days after the review. 0 = due again today, i.e. always due. May be fractional (1.5 weeks). */
  | { kind: 'interval'; days: number; label: string }
  /** N calendar months after the review ("2 months", "yearly" = 12). */
  | { kind: 'months'; months: number }
  /** The listed weekdays (0 = Sunday), every N weeks. */
  | { kind: 'weekly'; everyWeeks: number; weekdays: number[] }
  /** The listed days of the month, every N months. */
  | { kind: 'monthly'; everyMonths: number; days: MonthDaySpec[] }
  /** Days of named months, every year: fixed dates and/or the nth weekday of a month. */
  | { kind: 'yearly'; dates: { month: number; spec: MonthDaySpec }[] };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * A lookup table with NO prototype. The lexer asks `word in TABLE` for whatever was typed,
 * and on a plain object that is also true for `constructor`, `__proto__`, `valueOf`, … —
 * which read as a weekday, threw, or never returned (review, 2026-11-15).
 */
const table = <T>(entries: Record<string, T> = {}): Record<string, T> =>
  Object.assign(Object.create(null) as Record<string, T>, entries);

const WEEKDAYS: Record<string, number> = table();
[
  ['sunday', 'sun', 'sundays', 'suns'],
  ['monday', 'mon', 'mondays', 'mons'],
  ['tuesday', 'tue', 'tues', 'tuesdays'],
  ['wednesday', 'wed', 'weds', 'wednesdays'],
  ['thursday', 'thu', 'thur', 'thurs', 'thursdays'],
  ['friday', 'fri', 'fridays'],
  ['saturday', 'sat', 'saturdays', 'sats'],
].forEach((names, d) => names.forEach((n) => (WEEKDAYS[n] = d)));

const MONTHS: Record<string, number> = table();
[
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
].forEach((names, m) => names.forEach((n) => (MONTHS[n] = m)));

const ORDINAL_WORDS: Record<string, DayOrdinal> = table<DayOrdinal>({
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  last: 'last',
  final: 'last',
  penultimate: 'penultimate',
});

const NUMBER_WORDS: Record<string, number> = table({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
});

type Unit = 'day' | 'week' | 'month';
/** unit word -> [unit, how many of it] */
const UNITS: Record<string, [Unit, number]> = table<[Unit, number]>({
  d: ['day', 1],
  day: ['day', 1],
  days: ['day', 1],
  w: ['week', 1],
  wk: ['week', 1],
  wks: ['week', 1],
  week: ['week', 1],
  weeks: ['week', 1],
  fortnight: ['week', 2],
  fortnights: ['week', 2],
  mo: ['month', 1],
  mos: ['month', 1],
  mth: ['month', 1],
  mths: ['month', 1],
  month: ['month', 1],
  months: ['month', 1],
  quarter: ['month', 3],
  quarters: ['month', 3],
  y: ['month', 12],
  yr: ['month', 12],
  yrs: ['month', 12],
  year: ['month', 12],
  years: ['month', 12],
});

const ADVERBS: Record<string, [Unit, number]> = table<[Unit, number]>({
  daily: ['day', 1],
  everyday: ['day', 1],
  weekly: ['week', 1],
  biweekly: ['week', 2],
  fortnightly: ['week', 2],
  monthly: ['month', 1],
  bimonthly: ['month', 2],
  quarterly: ['month', 3],
  yearly: ['month', 12],
  annually: ['month', 12],
  annual: ['month', 12],
});

/** The words parse-duration understands, so that nothing else reaches it. */
const DURATION_UNIT =
  'ns|nanoseconds?|μs|µs|us|microseconds?|ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|mth|mths|months?|y|yrs?|years?';
/** A number as a duration may write it: "5", "1.5", ".5". */
const DURATION_NUM = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
/** A decimal comma — only directly before a duration unit, where it can be nothing else. */
const DECIMAL_COMMA = new RegExp(`(\\d),(\\d{1,2})(?=\\s*(?:${DURATION_UNIT})\\b)`, 'g');
/** "1,000", "12,500": digit groups. */
const THOUSANDS = /(^|[^\d.,])(\d{1,3}(?:,\d{3})+)(?![\d,.])/g;

/** Words that carry no meaning of their own here. */
const FILLERS = new Set(['on', 'at', 'in', 'a', 'an', 'per', 'once', 'next', 'this', 'coming', 'and', 'or', 'only']);
const RANGE_WORDS = new Set(['to', 'through', 'thru', 'until', 'till']);

const WEEKDAY_CLASS = [1, 2, 3, 4, 5];
const WEEKEND_CLASS = [6, 0];

type Tok =
  | { t: 'every' }
  | { t: 'other' }
  | { t: 'the' }
  | { t: 'of' }
  | { t: 'range' }
  | { t: 'num'; n: number }
  | { t: 'unit'; unit: Unit; mult: number }
  | { t: 'dayword' }
  | { t: 'adv'; unit: Unit; n: number }
  | { t: 'wd'; d: number }
  | { t: 'class'; days: number[] }
  | { t: 'ord'; n: DayOrdinal | number }
  | { t: 'lastday' }
  | { t: 'month'; m: number }
  | { t: 'unknown' };

function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    // A comma between digits can be three things, and only two of them are certain: digit
    // groups ("1,000 days") and a decimal comma in front of a unit ("1,5 weeks"). Anything
    // else — "1,15", "10,5" — is left a separator, and the text is then not understood
    // rather than guessed at (review, 2026-11-15: "1,15" was read as 1.15 days and
    // "1,000 days" as one day).
    .replace(THOUSANDS, (_m, before: string, digits: string) => before + digits.replace(/,/g, ''))
    .replace(DECIMAL_COMMA, '$1.$2')
    .replace(/[,;]+/g, ' ')
    .replace(/\.(?!\d)/g, ' ') // a full stop that is not a decimal point
    .replace(/\s*[&+/]\s*/g, ' ')
    .replace(/\bbi-?weekly\b/g, 'biweekly')
    .replace(/\bbi-?monthly\b/g, 'bimonthly')
    .replace(/\bevery\s?day\b/g, 'daily')
    .replace(/\b(?:end[\s-]of[\s-](?:the[\s-]|each[\s-]|every[\s-])?month|month[\s-]end|eom)\b/g, 'lastday')
    .replace(/\b(?:work(?:ing)?|business|week)[\s-]?days?\b/g, 'weekdays')
    .replace(/\bweek[\s-]?ends?(?:\s+days?)?\b/g, 'weekends')
    .replace(/(\d)\s+(st|nd|rd|th)\b/g, '$1$2')
    .replace(/([a-z])\s*-\s*([a-z])/g, '$1 to $2') // "mon-fri"
    // "second last friday", "second-to-last", "2nd last", "next to last": the one before the last
    .replace(/\b(?:second|2nd|next)\s+(?:to\s+)?(?:the\s+)?last\b/g, 'penultimate')
    .replace(/\s+/g, ' ')
    .trim();
}

function lex(normalised: string): Tok[] {
  const out: Tok[] = [];
  for (const word of normalised.split(' ')) {
    if (!word) continue;
    if (word === 'every' || word === 'each' || word === 'all') out.push({ t: 'every' });
    else if (word === 'other' || word === 'alternate' || word === 'alternating') out.push({ t: 'other' });
    else if (word === 'the') out.push({ t: 'the' });
    else if (word === 'of') out.push({ t: 'of' });
    else if (FILLERS.has(word)) continue;
    else if (RANGE_WORDS.has(word)) out.push({ t: 'range' });
    else if (word === 'day' || word === 'days') out.push({ t: 'dayword' });
    else if (word === 'lastday') out.push({ t: 'lastday' });
    else if (word === 'weekdays' || word === 'weekday') out.push({ t: 'class', days: WEEKDAY_CLASS });
    else if (word === 'weekends' || word === 'weekend') out.push({ t: 'class', days: WEEKEND_CLASS });
    else if (word in WEEKDAYS) out.push({ t: 'wd', d: WEEKDAYS[word] });
    else if (word in MONTHS) out.push({ t: 'month', m: MONTHS[word] });
    else if (word in ORDINAL_WORDS) out.push({ t: 'ord', n: ORDINAL_WORDS[word] });
    else if (word in NUMBER_WORDS) out.push({ t: 'num', n: NUMBER_WORDS[word] });
    else if (word in ADVERBS) out.push({ t: 'adv', unit: ADVERBS[word][0], n: ADVERBS[word][1] });
    else if (word in UNITS) out.push({ t: 'unit', unit: UNITS[word][0], mult: UNITS[word][1] });
    else {
      const ordinal = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(word);
      const numberWithUnit = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(word);
      if (ordinal) out.push({ t: 'ord', n: Number(ordinal[1]) });
      else if (/^\d+(?:\.\d+)?$/.test(word)) out.push({ t: 'num', n: Number(word) });
      else if (numberWithUnit && numberWithUnit[2] in UNITS) {
        const [unit, mult] = UNITS[numberWithUnit[2]];
        out.push({ t: 'num', n: Number(numberWithUnit[1]) }, { t: 'unit', unit, mult });
      } else out.push({ t: 'unknown' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** One or more number+unit pairs written together: "5d", "1.5w", "1w2d", "1d12h", ".5w". */
const DURATION_NUMBER_WITH_UNIT = new RegExp(`^(?:${DURATION_NUM}(?:${DURATION_UNIT}))+$`);
const DURATION_UNIT_ALONE = new RegExp(`^(?:${DURATION_UNIT})$`);
const DURATION_NUMBER = new RegExp(`^${DURATION_NUM}$`);
/** "a week", "two weeks": a number written as a word, directly before a duration unit. */
const DURATION_WORD_NUMBER = new RegExp(
  `\\b(a|an|${Object.keys(NUMBER_WORDS).join('|')})\\s+(?=(?:${DURATION_UNIT})\\b)`,
  'g'
);

/**
 * The text as the duration reader is asked it: no leading "every", no "and", and numbers
 * written as words turned into digits where a unit follows ("a week and two days" ->
 * "1 week 2 days").
 */
function durationText(normalised: string): string {
  return normalised
    .replace(/^(?:every|each)\s+/, '')
    .replace(/\band\b/g, ' ')
    .replace(DURATION_WORD_NUMBER, (_m, word: string) => `${word === 'a' || word === 'an' ? 1 : NUMBER_WORDS[word]} `)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A plain duration — "5", "2 weeks 3 days", "1.5 weeks" — as days, or null.
 *
 * parse-duration itself is far too forgiving to be asked directly: it reads "2 weeks on
 * mnday" as 14 days and "hello 5" as 5, i.e. it would turn a typo into a schedule without a
 * word. So the text must consist of numbers and duration units and nothing else, and a
 * number without a unit is accepted only when it is the whole text (a bare number = days).
 */
function strictDurationDays(normalised: string): number | null {
  const words = normalised.split(' ').filter(Boolean);
  if (words.length === 0) return null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (DURATION_NUMBER_WITH_UNIT.test(w)) continue;
    if (DURATION_NUMBER.test(w)) {
      if (words.length === 1) continue;
      if (i + 1 < words.length && DURATION_UNIT_ALONE.test(words[i + 1])) {
        i++;
        continue;
      }
    }
    return null;
  }
  const days = parseDuration(normalised, 'd');
  if (days == null || !Number.isFinite(days)) return null;
  return days;
}

function intervalRule(days: number, label: string, text: string): RotationRule {
  // A rotation is stored as a day, so anything finer than a day would be a lie about when the
  // item returns. Exactly 0 is allowed: "due today", i.e. always due (owner decision, 2026-08-14).
  if (days < 0 || (days > 0 && days < 1) || days > MAX_INTERVAL_DAYS) return { kind: 'invalid', text };
  return { kind: 'interval', days, label };
}

function plural(n: number, word: string): string {
  return n === 1 ? `every ${word}` : `every ${n} ${word}s`;
}

/**
 * Reads a Rotation text. Never throws; what it cannot read comes back as `invalid`.
 */
export function parseRotation(raw: string | undefined | null): RotationRule {
  const text = (raw ?? '').trim();
  if (!text || /^(default|none|no|off|-)$/i.test(text)) return { kind: 'none' };
  const invalid: RotationRule = { kind: 'invalid', text };
  const normalised = normalise(text);
  if (!normalised) return invalid;

  // "day" on its own, like "week", "month" and "year" on theirs. (The lexer keeps the word
  // for "last day", "day 15" and "every 2nd day", so it is answered here.)
  if (normalised === 'day') return intervalRule(1, plural(1, 'day'), text);

  const calendar = parseCalendar(lex(normalised), text);
  if (calendar) return calendar;

  // Not calendar language: a plain duration, with or without a leading "every".
  const duration = durationText(normalised);
  const days = strictDurationDays(duration);
  if (days === null) return invalid;
  const label =
    days === 0
      ? 'always due'
      : DURATION_NUMBER.test(duration)
      ? plural(days, 'day')
      : `every ${duration}`;
  return intervalRule(days, label, text);
}

/** The calendar grammar. Null when the tokens are not (all) calendar language. */
function parseCalendar(toks: Tok[], text: string): RotationRule | null {
  if (toks.length === 0 || toks.some((t) => t.t === 'unknown')) return null;

  let every = false;
  let everyOther = false;
  let sawMonthWord = false;
  let interval: { n: number; unit: Unit } | null = null;
  let conflict = false;
  const weekdays: number[] = [];
  let weekdayClass = false;
  let namedWeekday = false;
  const wdOrdinals: DayOrdinal[] = [];
  const monthDays: (number | 'last')[] = [];
  const yearDates: { month: number; day: number | 'last' }[] = [];
  const monthsFilter: number[] = [];

  const setEvery = (n: number, unit: Unit) => {
    if (interval && (interval.n !== n || interval.unit !== unit)) conflict = true;
    interval = { n, unit };
  };
  const addWeekday = (d: number) => {
    if (!weekdays.includes(d)) weekdays.push(d);
  };
  const asMonthDay = (n: DayOrdinal | number): number | 'last' | null =>
    n === 'last' ? 'last' : typeof n === 'number' && n >= 1 && n <= 31 ? n : null;

  let i = 0;
  while (i < toks.length) {
    const tok = toks[i];
    const next = toks[i + 1];
    const prev = toks[i - 1];
    switch (tok.t) {
      case 'every':
        every = true;
        i++;
        break;
      case 'the':
        // "the 15", "on the 15": a day of the month, unlike a bare "15" (15 days).
        if (next?.t === 'num' && toks[i + 2]?.t !== 'unit' && toks[i + 2]?.t !== 'dayword' && toks[i + 2]?.t !== 'month') {
          const day = asMonthDay(next.n);
          if (day === null || !Number.isInteger(next.n)) return null;
          monthDays.push(day);
          i += 2;
        } else i++;
        break;
      case 'of': {
        // "… of the month", "… of each month": says the ordinal counts within the month.
        let j = i + 1;
        while (toks[j]?.t === 'the' || toks[j]?.t === 'every') j++;
        const target = toks[j];
        if (target?.t === 'unit' && target.unit === 'month' && target.mult === 1 && toks[j - 1]?.t !== 'num') {
          sawMonthWord = true;
          i = j + 1;
        } else if (target?.t === 'month') {
          i++; // "3rd of march": the month token is read on its own turn
        } else if (
          (target?.t === 'num' || target?.t === 'other') &&
          toks[j + 1]?.t === 'unit' &&
          (toks[j + 1] as { unit: Unit }).unit === 'month'
        ) {
          // "… of every 2 months", "… of every other month"
          const unit = toks[j + 1] as { t: 'unit'; unit: Unit; mult: number };
          setEvery((target.t === 'num' ? target.n : 2) * unit.mult, unit.unit);
          i = j + 2;
        } else return null;
        break;
      }
      case 'other':
        // "every other week", "every other friday"
        if (next?.t === 'unit') {
          setEvery(2 * next.mult, next.unit);
          i += 2;
        } else if (next?.t === 'dayword') {
          setEvery(2, 'day');
          i += 2;
        } else if (next?.t === 'wd' || next?.t === 'class') {
          everyOther = true;
          i++;
        } else return null;
        break;
      case 'num':
        if (next?.t === 'unit') {
          setEvery(tok.n * next.mult, next.unit);
          i += 2;
        } else if (next?.t === 'dayword') {
          setEvery(tok.n, 'day');
          i += 2;
        } else if (next?.t === 'month') {
          // "3 march"
          const day = asMonthDay(tok.n);
          if (day === null || !Number.isInteger(tok.n)) return null;
          yearDates.push({ month: next.m, day });
          i += 2;
        } else return null; // a number on its own is not calendar language
        break;
      case 'unit':
        // A unit with no number: "every week", "a month", "once a year".
        setEvery(tok.mult, tok.unit);
        if (tok.unit === 'month' && tok.mult === 1) sawMonthWord = true;
        i++;
        break;
      case 'adv':
        setEvery(tok.n, tok.unit);
        if (tok.unit === 'month') sawMonthWord = true;
        i++;
        break;
      case 'dayword':
        if (next?.t === 'num' && Number.isInteger(next.n) && asMonthDay(next.n) !== null) {
          monthDays.push(next.n); // "day 15"
          i += 2;
        } else if (prev?.t === 'every') {
          setEvery(1, 'day'); // "each day"
          i++;
        } else return null;
        break;
      case 'lastday':
        monthDays.push('last');
        i++;
        break;
      case 'ord': {
        // A run of ordinals: "first and third monday", "1st and 15th".
        const run: (DayOrdinal | number)[] = [tok.n];
        let j = i + 1;
        while (toks[j]?.t === 'ord') {
          run.push((toks[j] as { t: 'ord'; n: DayOrdinal | number }).n);
          j++;
        }
        const after = toks[j];
        if (after?.t === 'dayword') {
          // "last day", "first day": of the month. "every 2nd day": an interval.
          if (run.length !== 1) return null;
          const n = run[0];
          const ofFollows = toks[j + 1]?.t === 'of'; // "every 15th day of the month"
          if (n === 'last' || n === 1 || !every || ofFollows) {
            const day = asMonthDay(n);
            if (day === null) return null;
            monthDays.push(day);
          } else if (typeof n === 'number') setEvery(n, 'day');
          else return null;
          i = j + 1;
        } else if (after?.t === 'unit') {
          // "every second week", "every 3rd month"
          if (run.length !== 1 || typeof run[0] !== 'number') return null;
          setEvery(run[0] * after.mult, after.unit);
          i = j + 1;
        } else if (after?.t === 'wd' || after?.t === 'class') {
          for (const n of run) {
            if (typeof n === 'number' && (n < 1 || n > 5)) return null; // "15th monday"
            wdOrdinals.push(n as DayOrdinal);
          }
          i = j;
        } else if (after?.t === 'month') {
          // "3rd march"
          for (const n of run) {
            const day = asMonthDay(n);
            if (day === null) return null;
            yearDates.push({ month: after.m, day });
          }
          i = j + 1;
        } else if (after?.t === 'of' && toks[j + 1]?.t === 'month') {
          // "3rd of march"
          for (const n of run) {
            const day = asMonthDay(n);
            if (day === null) return null;
            yearDates.push({ month: (toks[j + 1] as { t: 'month'; m: number }).m, day });
          }
          i = j + 2;
        } else {
          for (const n of run) {
            const day = asMonthDay(n);
            if (day === null) return null;
            monthDays.push(day);
          }
          i = j;
        }
        break;
      }
      case 'wd':
        namedWeekday = true;
        if (next?.t === 'range' && toks[i + 2]?.t === 'wd') {
          // "mon to fri", wrapping round the week if need be ("fri to mon")
          const end = (toks[i + 2] as { t: 'wd'; d: number }).d;
          for (let d = tok.d, steps = 0; steps < 7; d = (d + 1) % 7, steps++) {
            addWeekday(d);
            if (d === end) break;
          }
          i += 3;
        } else {
          addWeekday(tok.d);
          i++;
        }
        break;
      case 'class':
        weekdayClass = true;
        tok.days.forEach(addWeekday);
        i++;
        break;
      case 'month': {
        // "march 3", "march 3rd"; or a month on its own ("first monday of january", "every june").
        const after = toks[i + 1];
        const afterAfter = toks[i + 2];
        // (A day written BEFORE its month — "3 march" — is paired by the number's own case and
        // never reaches this one, so a number after a month here belongs to this month.)
        const takesDay =
          (after?.t === 'num' && afterAfter?.t !== 'unit' && afterAfter?.t !== 'dayword') ||
          (after?.t === 'ord' && afterAfter?.t !== 'wd' && afterAfter?.t !== 'class' && afterAfter?.t !== 'unit' && afterAfter?.t !== 'dayword' && afterAfter?.t !== 'of');
        if (takesDay) {
          const n = (after as { n: DayOrdinal | number }).n;
          const day = asMonthDay(n);
          if (day === null || (typeof n === 'number' && !Number.isInteger(n))) return null;
          yearDates.push({ month: tok.m, day });
          i += 2;
        } else {
          if (!monthsFilter.includes(tok.m)) monthsFilter.push(tok.m);
          i++;
        }
        break;
      }
      default:
        return null; // a stray "to", …
    }
  }

  const invalid: RotationRule = { kind: 'invalid', text };
  if (conflict) {
    // Two different lengths. With calendar words around them the text contradicts itself;
    // on their own they are a compound duration ("2 weeks 3 days") for the duration reader.
    const calendarWords =
      weekdays.length > 0 || wdOrdinals.length > 0 || monthDays.length > 0 || yearDates.length > 0 || monthsFilter.length > 0;
    return calendarWords ? invalid : null;
  }
  // Narrowing loses track of `interval` across the closures above; read it once.
  const iv = interval as { n: number; unit: Unit } | null;
  const wholeInterval = (unit: Unit): number | null =>
    iv && iv.unit === unit && Number.isInteger(iv.n) && iv.n >= 1 && iv.n <= (unit === 'week' ? MAX_SKIP_WEEKS : MAX_SKIP_MONTHS)
      ? iv.n
      : null;

  // --- weekdays -------------------------------------------------------------
  if (weekdays.length > 0) {
    if (monthDays.length > 0 || yearDates.length > 0) return invalid;
    // A class and a named day together ("weekdays and saturday") is just a list of days.
    const asClass = weekdayClass && !namedWeekday;
    if (wdOrdinals.length > 0) {
      const only = wdOrdinals.length === 1 ? wdOrdinals[0] : null;
      // "every second tuesday": every other Tuesday. Only with "every", only for 2nd–5th, and
      // only when nothing says "of the month".
      if (every && !sawMonthWord && monthsFilter.length === 0 && !iv && typeof only === 'number' && only >= 2) {
        return { kind: 'weekly', everyWeeks: only, weekdays: sortWeekdays(weekdays) };
      }
      const specs: MonthDaySpec[] = wdOrdinals.map((ordinal) => ({
        on: 'weekday',
        ordinal,
        weekdays: sortWeekdays(weekdays),
        asClass,
      }));
      if (monthsFilter.length > 0) {
        if (iv && !(iv.unit === 'month' && (iv.n === 1 || iv.n === 12))) return invalid;
        return {
          kind: 'yearly',
          dates: monthsFilter.flatMap((month) => specs.map((spec) => ({ month, spec }))),
        };
      }
      let everyMonths = 1;
      if (iv) {
        const n = wholeInterval('month');
        if (n === null) return invalid;
        everyMonths = n;
      }
      return { kind: 'monthly', everyMonths, days: specs };
    }
    if (monthsFilter.length > 0) return invalid;
    let everyWeeks = everyOther ? 2 : 1;
    if (iv) {
      const n = wholeInterval('week');
      if (n === null || everyOther) return invalid;
      everyWeeks = n;
    }
    return { kind: 'weekly', everyWeeks, weekdays: sortWeekdays(weekdays) };
  }
  if (wdOrdinals.length > 0 || everyOther) return invalid;

  // --- days of the month ------------------------------------------------------
  if (monthDays.length > 0) {
    if (yearDates.length > 0) return invalid;
    const specs: MonthDaySpec[] = uniqueDays(monthDays).map((day) => ({ on: 'date', day }));
    if (monthsFilter.length > 0) {
      if (iv && !(iv.unit === 'month' && (iv.n === 1 || iv.n === 12))) return invalid;
      return {
        kind: 'yearly',
        dates: monthsFilter.flatMap((month) => specs.map((spec) => ({ month, spec }))),
      };
    }
    let everyMonths = 1;
    if (iv) {
      const n = wholeInterval('month');
      if (n === null) return invalid;
      everyMonths = n;
    }
    return { kind: 'monthly', everyMonths, days: specs };
  }

  // --- dates of the year ------------------------------------------------------
  if (yearDates.length > 0 || monthsFilter.length > 0) {
    if (iv && !(iv.unit === 'month' && iv.n === 12)) return invalid;
    const dates: { month: number; spec: MonthDaySpec }[] = [
      ...yearDates.map(({ month, day }) => ({ month, spec: { on: 'date', day } as MonthDaySpec })),
      // A month with no day: its first day.
      ...monthsFilter.map((month) => ({ month, spec: { on: 'date', day: 1 } as MonthDaySpec })),
    ];
    return { kind: 'yearly', dates };
  }

  // --- an interval and nothing else ---------------------------------------------
  if (iv) {
    if (!Number.isInteger(iv.n)) return null; // "1.5 weeks": the duration reader takes it
    if (iv.unit === 'month') {
      if (iv.n === 0) return intervalRule(0, 'always due', text); // as "0", "0 days", "0 weeks"
      if (iv.n < 1 || iv.n > MAX_INTERVAL_DAYS / 30) return invalid;
      return { kind: 'months', months: iv.n };
    }
    const days = iv.unit === 'week' ? iv.n * 7 : iv.n;
    const label = days === 0 ? 'always due' : iv.unit === 'week' ? plural(iv.n, 'week') : plural(iv.n, 'day');
    return intervalRule(days, label, text);
  }
  return null;
}

/** Monday first — the order they are shown in, and the fork's weeks start on Monday. */
function sortWeekdays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

function uniqueDays(days: (number | 'last')[]): (number | 'last')[] {
  const numbers = [...new Set(days.filter((d): d is number => d !== 'last'))].sort((a, b) => a - b);
  return days.includes('last') ? [...numbers, 'last'] : numbers;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

type Ymd = { y: number; m: number; d: number };

const toYmd = (ms: number): Ymd => {
  const date = new Date(ms);
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
};
/** A whole-day number for a calendar date, free of time zones and daylight saving. */
const dayNumber = (x: Ymd): number => Math.round(Date.UTC(x.y, x.m, x.d) / MS_PER_DAY);
const fromDayNumber = (n: number): Ymd => {
  const date = new Date(n * MS_PER_DAY);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() };
};
/** 0 = Sunday. 1 January 1970 was a Thursday. */
const weekdayOf = (n: number): number => (((n + 4) % 7) + 7) % 7;
/** Which Monday-to-Sunday week a day is in. */
const weekIndex = (n: number): number => Math.floor((n + 3) / 7);
const monthIndex = (x: Ymd): number => x.y * 12 + x.m;
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function matchesMonthDay(spec: MonthDaySpec, x: Ymd): boolean {
  const last = daysInMonth(x.y, x.m);
  if (spec.on === 'date') {
    if (spec.day === 'last') return x.d === last;
    return x.d === spec.day || (spec.day > last && x.d === last);
  }
  const n = dayNumber(x);
  if (!spec.weekdays.includes(weekdayOf(n))) return false;
  if (!spec.asClass) {
    // The nth Monday: its day of the month says which one it is.
    if (spec.ordinal === 'last') return x.d + 7 > last;
    if (spec.ordinal === 'penultimate') return x.d + 7 <= last && x.d + 14 > last;
    return Math.ceil(x.d / 7) === spec.ordinal;
  }
  // The nth day of the group: count the group's days in this month.
  const inGroup = (d: number) => spec.weekdays.includes(weekdayOf(n - x.d + d));
  if (spec.ordinal === 'last' || spec.ordinal === 'penultimate') {
    // The last has none of the group after it in the month; the one before it has one.
    let after = 0;
    for (let d = x.d + 1; d <= last; d++) if (inGroup(d)) after++;
    return after === (spec.ordinal === 'last' ? 0 : 1);
  }
  let count = 0;
  for (let d = 1; d <= x.d; d++) if (inGroup(d)) count++;
  return count === spec.ordinal;
}

/** Is this a day the rule names — leaving aside which weeks or months it skips? */
function matchesDay(rule: RotationRule, x: Ymd): boolean {
  switch (rule.kind) {
    case 'weekly':
      return rule.weekdays.includes(weekdayOf(dayNumber(x)));
    case 'monthly':
      return rule.days.some((spec) => matchesMonthDay(spec, x));
    case 'yearly':
      return rule.dates.some(({ month, spec }) => month === x.m && matchesMonthDay(spec, x));
    default:
      return false;
  }
}

export interface NextRotation {
  /** ms: the day the item returns, at the time of day of `now`. */
  date: number;
  /** Whole days from the day of `now` (fractional only for a fractional interval). */
  days: number;
}

/**
 * When an item reviewed at `now` comes back under `rule`.
 *
 * `due` is the item's current due date; a rule that skips weeks or months counts them from
 * it (see the header). Null for `none` and `invalid` — the scheduler decides then.
 */
export function nextRotationDate(rule: RotationRule, now: number, due?: number | null): NextRotation | null {
  switch (rule.kind) {
    case 'none':
    case 'invalid':
      return null;
    case 'interval': {
      // As Rotation always worked: N days after the review. A whole number of days is counted
      // on the calendar, at the same time of day — `now + N × 24 h` lands a day off across a
      // daylight-saving change (review, 2026-11-15; in Sydney, Rotation 1 reviewed at 00:30
      // on the 25-hour day came back due the same day).
      if (Number.isInteger(rule.days)) {
        const landing = new Date(now);
        landing.setDate(landing.getDate() + rule.days);
        return { date: landing.getTime(), days: rule.days };
      }
      // A fractional length ("1.5 weeks") stays a plain span. Rounded for the history entry.
      return { date: now + rule.days * MS_PER_DAY, days: Math.round(rule.days * 10) / 10 };
    }
    case 'months': {
      const today = toYmd(now);
      const target = today.y * 12 + today.m + rule.months;
      const y = Math.floor(target / 12);
      const m = target % 12;
      const landing: Ymd = { y, m, d: Math.min(today.d, daysInMonth(y, m)) };
      return atTimeOfDay(landing, now);
    }
    default: {
      const todayN = dayNumber(toYmd(now));
      const every = rule.kind === 'weekly' ? rule.everyWeeks : rule.kind === 'monthly' ? rule.everyMonths : 1;
      const unitIndex = (x: Ymd) => (rule.kind === 'weekly' ? weekIndex(dayNumber(x)) : monthIndex(x));
      // The rhythm to keep: the due date's week or month — if the due date is a day of the rule.
      let anchor: number | null = null;
      if (every > 1 && due != null && Number.isFinite(due)) {
        const dueYmd = toYmd(due);
        if (matchesDay(rule, dueYmd)) anchor = unitIndex(dueYmd);
      }
      const scan = (rhythm: number | null): NextRotation | null => {
        for (let n = todayN + 1; n <= todayN + MAX_SCAN_DAYS; n++) {
          const x = fromDayNumber(n);
          if (!matchesDay(rule, x)) continue;
          if (rhythm !== null && (((unitIndex(x) - rhythm) % every) + every) % every !== 0) continue;
          return atTimeOfDay(x, now);
        }
        return null;
      };
      // A rhythm whose months never hold the day ("every 2 years on the fifth monday of
      // february", from an odd year) must not leave the item without a date: the series
      // then starts at the next matching day, as it does when there is no rhythm to keep.
      return (anchor !== null ? scan(anchor) : null) ?? scan(null);
    }
  }
}

/** `day`, at the wall-clock time of `now`, with the whole days between them. */
function atTimeOfDay(day: Ymd, now: number): NextRotation {
  const clock = new Date(now);
  const date = new Date(day.y, day.m, day.d, clock.getHours(), clock.getMinutes(), clock.getSeconds()).getTime();
  return { date, days: dayNumber(day) - dayNumber(toYmd(now)) };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinalText(n: number | 'last' | 'penultimate'): string {
  if (n === 'last') return 'last';
  if (n === 'penultimate') return '2nd-last';
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

function weekdaySetText(days: number[]): string {
  const key = [...days].sort((a, b) => a - b).join('');
  if (key === '12345') return 'weekdays';
  if (key === '06') return 'weekends';
  return days.map((d) => WEEKDAY_NAMES[d]).join(', ');
}

function monthDayText(spec: MonthDaySpec): string {
  if (spec.on === 'date') return spec.day === 'last' ? 'last day' : ordinalText(spec.day);
  const key = [...spec.weekdays].sort((a, b) => a - b).join('');
  const group = spec.asClass ? (key === '12345' ? 'weekday' : key === '06' ? 'weekend day' : weekdaySetText(spec.weekdays)) : weekdaySetText(spec.weekdays);
  return `${ordinalText(spec.ordinal)} ${group}`;
}

/**
 * The rule in a few words, as the plugin understood it: "every Sun", "weekdays",
 * "every 2 weeks on Mon", "1st of the month", "1st Sat of the month", "every 5 days".
 * Empty for `none` and `invalid`.
 */
export function describeRotation(rule: RotationRule): string {
  switch (rule.kind) {
    case 'none':
    case 'invalid':
      return '';
    case 'interval':
      return rule.label;
    case 'months':
      return rule.months % 12 === 0 ? plural(rule.months / 12, 'year') : plural(rule.months, 'month');
    case 'weekly': {
      const set = weekdaySetText(rule.weekdays);
      if (rule.weekdays.length === 7) return rule.everyWeeks === 1 ? 'every day' : `daily, every ${rule.everyWeeks} weeks`;
      if (rule.everyWeeks > 1) return `every ${rule.everyWeeks} weeks on ${set}`;
      return set === 'weekdays' || set === 'weekends' ? set : `every ${set}`;
    }
    case 'monthly': {
      const days = rule.days.map(monthDayText).join(', ');
      if (rule.everyMonths === 1) return `${days} of the month`;
      return rule.everyMonths % 12 === 0
        ? `${days}, ${plural(rule.everyMonths / 12, 'year')}`
        : `${days}, every ${rule.everyMonths} months`;
    }
    case 'yearly':
      return (
        'every ' +
        rule.dates
          .map(({ month, spec }) =>
            spec.on === 'date'
              ? `${spec.day === 'last' ? 'last day of' : spec.day} ${MONTH_NAMES[month]}`
              : `${monthDayText(spec)} of ${MONTH_NAMES[month]}`
          )
          .join(', ')
      );
  }
}

/** What to tell someone whose Rotation text was not understood. */
export const ROTATION_HELP =
  'Rotation was not understood. Examples: 5 days · 2 weeks · sunday · mon, wed, fri · weekdays · weekends · ' +
  'every 2 weeks on monday · 1st · 1st and 15th · last day of the month · first saturday of the month · 3 march. ' +
  'Leave it empty (or "default") for the normal schedule.';
