/**
 * FORK-ONLY (2026-11-14). Tests for the Rotation reader. Run with `npm test`
 * (Node >= 20), or this file alone: `npx ts-node --transpile-only src/lib/rotation.test.ts`.
 *
 * Dates are local, as the plugin's are; nothing here depends on the time zone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeRotation, nextRotationDate, parseRotation, RotationRule } from './rotation';

/** Local time. Months are 1-based here, for readability. */
const at = (y: number, m: number, d: number, h = 21, min = 30) => new Date(y, m - 1, d, h, min, 0).getTime();
const ymd = (ms: number) => {
  const x = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
/** The landing day for `text`, reviewed at `now`, with the item due at `due`. */
const lands = (text: string, now: number, due?: number) => {
  const next = nextRotationDate(parseRotation(text), now, due);
  return next ? ymd(next.date) : null;
};
const says = (text: string) => describeRotation(parseRotation(text));
const kind = (text: string | undefined | null) => parseRotation(text).kind;

// 2026: 2 Nov is a Monday, 14 Nov a Saturday.
const SAT_14_NOV = at(2026, 11, 14);

describe('parseRotation — nothing, and intervals', () => {
  it('reads an empty or default value as no rotation', () => {
    for (const t of [undefined, null, '', '   ', 'Default', 'default', 'DEFAULT', 'none']) {
      assert.equal(kind(t), 'none', String(t));
    }
  });

  it('reads a bare number as days', () => {
    assert.deepEqual(parseRotation('5'), { kind: 'interval', days: 5, label: 'every 5 days' });
    assert.equal(says('1'), 'every day');
    assert.deepEqual(parseRotation('0'), { kind: 'interval', days: 0, label: 'always due' });
  });

  it('reads plain durations', () => {
    const days = (t: string) => (parseRotation(t) as Extract<RotationRule, { kind: 'interval' }>).days;
    assert.equal(days('5 days'), 5);
    assert.equal(days('5d'), 5);
    assert.equal(days('2 weeks'), 14);
    assert.equal(days('2w'), 14);
    assert.equal(days('every 3 days'), 3);
    assert.equal(days('1.5 weeks'), 10.5);
    assert.equal(days('1,5 weeks'), 10.5);
    assert.equal(days('2 weeks 3 days'), 17);
    assert.equal(days('1 week, 2 days'), 9);
    assert.equal(days('daily'), 1);
    assert.equal(days('every day'), 1);
    assert.equal(days('everyday'), 1);
    assert.equal(days('weekly'), 7);
    assert.equal(days('every week'), 7);
    assert.equal(days('once a week'), 7);
    assert.equal(days('fortnightly'), 14);
    assert.equal(days('biweekly'), 14);
    assert.equal(days('every other week'), 14);
    assert.equal(days('every other day'), 2);
    assert.equal(days('every 2nd day'), 2);
    assert.equal(says('2 weeks'), 'every 2 weeks');
    assert.equal(says('weekly'), 'every week');
    assert.equal(says('2 weeks 3 days'), 'every 2 weeks 3 days');
  });

  it('reads months and years as calendar months', () => {
    assert.deepEqual(parseRotation('6 months'), { kind: 'months', months: 6 });
    assert.deepEqual(parseRotation('monthly'), { kind: 'months', months: 1 });
    assert.deepEqual(parseRotation('every month'), { kind: 'months', months: 1 });
    assert.deepEqual(parseRotation('quarterly'), { kind: 'months', months: 3 });
    assert.deepEqual(parseRotation('1 year'), { kind: 'months', months: 12 });
    assert.deepEqual(parseRotation('1y'), { kind: 'months', months: 12 });
    assert.deepEqual(parseRotation('yearly'), { kind: 'months', months: 12 });
    assert.equal(says('6 months'), 'every 6 months');
    assert.equal(says('yearly'), 'every year');
    assert.equal(says('2 years'), 'every 2 years');
  });

  it('refuses what it cannot read, instead of guessing', () => {
    for (const t of [
      '30m', // finer than a day
      '2 hours',
      '0.5',
      '-3 days',
      'hello',
      '2 weeks on mnday', // a typo must not become "2 weeks"
      'every 2 weeks on the 1st', // weeks and a day of the month
      '15th monday',
      'monday 3 march',
      'tomorrow',
      '3 march 2027', // a one-off date is not a rotation
      '40000 days',
    ]) {
      assert.equal(kind(t), 'invalid', t);
      assert.equal(nextRotationDate(parseRotation(t), SAT_14_NOV), null, t);
    }
  });
});

describe('parseRotation — days of the week', () => {
  it('reads one weekday, however it is written', () => {
    for (const t of ['sunday', 'Sunday', 'sun', 'Sundays', 'every sunday', 'on sunday', 'next sunday', 'each Sun.']) {
      assert.deepEqual(parseRotation(t), { kind: 'weekly', everyWeeks: 1, weekdays: [0] }, t);
    }
    assert.equal(says('sunday'), 'every Sun');
  });

  it('reads several weekdays', () => {
    for (const t of ['mon, wed, fri', 'monday and wednesday and friday', 'mon/wed/fri', 'fri wed mon', 'Mon & Wed & Fri']) {
      assert.deepEqual(parseRotation(t), { kind: 'weekly', everyWeeks: 1, weekdays: [1, 3, 5] }, t);
    }
    assert.equal(says('mon, wed, fri'), 'every Mon, Wed, Fri');
  });

  it('reads weekdays and weekends', () => {
    for (const t of ['weekdays', 'weekday', 'every weekday', 'mon-fri', 'monday to friday', 'working days', 'business days', 'work days']) {
      assert.equal(says(t), 'weekdays', t);
    }
    for (const t of ['weekends', 'weekend', 'every weekend', 'sat & sun', 'saturday and sunday']) {
      assert.equal(says(t), 'weekends', t);
    }
    assert.equal(says('mon to sun'), 'every day');
  });

  it('reads a weekday every N weeks', () => {
    for (const t of [
      'every 2 weeks on monday',
      'every 2 weeks, on monday',
      'monday every 2 weeks',
      'fortnightly on monday',
      'every fortnight on monday',
      'biweekly monday',
      'every other monday',
      'every other week on monday',
      'every second monday',
      'every 2nd week on mon',
    ]) {
      assert.deepEqual(parseRotation(t), { kind: 'weekly', everyWeeks: 2, weekdays: [1] }, t);
    }
    assert.equal(says('every 2 weeks on monday'), 'every 2 weeks on Mon');
    assert.deepEqual(parseRotation('every third friday'), { kind: 'weekly', everyWeeks: 3, weekdays: [5] });
    assert.deepEqual(parseRotation('every 3 weeks on tue and thu'), { kind: 'weekly', everyWeeks: 3, weekdays: [2, 4] });
  });
});

describe('parseRotation — days of the month', () => {
  it('reads a day of the month', () => {
    for (const t of [
      '1st',
      'the 1st',
      'every 1st',
      'every 1st of the month',
      '1st of each month',
      'first of the month',
      'monthly on the 1st',
      'every month on the 1st',
      'first day of the month',
      'day 1',
      'the 1',
    ]) {
      assert.deepEqual(parseRotation(t), { kind: 'monthly', everyMonths: 1, days: [{ on: 'date', day: 1 }] }, t);
    }
    assert.equal(says('1st'), '1st of the month');
    assert.equal(says('the 15'), '15th of the month');
    assert.equal(says('every 15th day of the month'), '15th of the month');
    assert.equal(says('1st and 15th'), '1st, 15th of the month');
    assert.equal(says('22nd'), '22nd of the month');
  });

  it('keeps a bare number as days, not a date', () => {
    assert.equal(says('15'), 'every 15 days');
  });

  it('reads the last day of the month', () => {
    for (const t of ['last day of the month', 'last day', 'end of month', 'end of the month', 'eom', 'month end', 'the last day of each month']) {
      assert.equal(says(t), 'last day of the month', t);
    }
  });

  it('reads the nth weekday of the month', () => {
    for (const t of ['first saturday of the month', '1st sat', 'first saturday', 'every first saturday', 'every month on the first saturday', 'the first Saturday of each month']) {
      assert.equal(says(t), '1st Sat of the month', t);
    }
    assert.equal(says('second tuesday'), '2nd Tue of the month');
    assert.equal(says('every second tuesday of the month'), '2nd Tue of the month');
    assert.equal(says('last friday'), 'last Fri of the month');
    assert.equal(says('last friday of the month'), 'last Fri of the month');
    assert.equal(says('first and third monday'), '1st Mon, 3rd Mon of the month');
    assert.equal(says('last weekday of the month'), 'last weekday of the month');
    assert.equal(says('last working day of the month'), 'last weekday of the month');
    assert.equal(says('first weekday of the month'), '1st weekday of the month');
    assert.equal(says('first Friday of the month'), '1st Fri of the month');
    assert.equal(says('first and last friday of the month'), '1st Fri, last Fri of the month');
  });

  it('reads every N months', () => {
    assert.equal(says('every 3 months on the 1st'), '1st, every 3 months');
    assert.equal(says('quarterly on the 1st'), '1st, every 3 months');
    assert.equal(says('every 2 months on the first monday'), '1st Mon, every 2 months');
    assert.equal(says('first friday of every 2 months'), '1st Fri, every 2 months');
    assert.equal(says('the 1st of every 3 months'), '1st, every 3 months');
    assert.equal(says('last day of every other month'), 'last day, every 2 months');
  });

  it('reads a date of the year', () => {
    for (const t of ['3 march', 'march 3', 'March 3rd', '3rd of march', 'every 3rd of march', 'mar 3']) {
      assert.equal(says(t), 'every 3 Mar', t);
    }
    assert.equal(says('jan 1 and jul 1'), 'every 1 Jan, 1 Jul');
    assert.equal(says('first monday of january'), 'every 1st Mon of Jan');
    assert.equal(says('every january'), 'every 1 Jan');
  });
});

describe('nextRotationDate — intervals', () => {
  it('counts an interval from the review, to the second', () => {
    const next = nextRotationDate(parseRotation('5'), SAT_14_NOV)!;
    assert.equal(next.date, SAT_14_NOV + 5 * 86_400_000);
    assert.equal(next.days, 5);
  });

  it('keeps 0 due today', () => {
    assert.deepEqual(nextRotationDate(parseRotation('0'), SAT_14_NOV), { date: SAT_14_NOV, days: 0 });
  });

  it('adds calendar months, staying inside the month', () => {
    assert.equal(lands('1 month', SAT_14_NOV), '2026-12-14');
    assert.equal(lands('6 months', at(2026, 8, 31)), '2027-02-28');
    assert.equal(lands('yearly', SAT_14_NOV), '2027-11-14');
    assert.equal(nextRotationDate(parseRotation('1 month'), SAT_14_NOV)!.days, 30);
  });

  it('gives no date for no rotation', () => {
    assert.equal(nextRotationDate(parseRotation(''), SAT_14_NOV), null);
    assert.equal(nextRotationDate(parseRotation('default'), SAT_14_NOV), null);
  });
});

describe('nextRotationDate — days of the week', () => {
  it('lands on the next such day, never today', () => {
    assert.equal(lands('sunday', SAT_14_NOV), '2026-11-15');
    assert.equal(lands('sunday', at(2026, 11, 15)), '2026-11-22');
    assert.equal(lands('saturday', SAT_14_NOV), '2026-11-21');
    assert.equal(nextRotationDate(parseRotation('sunday'), SAT_14_NOV)!.days, 1);
  });

  it('keeps the time of day of the review', () => {
    const next = new Date(nextRotationDate(parseRotation('sunday'), SAT_14_NOV)!.date);
    assert.equal(next.getHours(), 21);
    assert.equal(next.getMinutes(), 30);
  });

  it('skips the weekend for weekdays, and the week for weekends', () => {
    assert.equal(lands('weekdays', at(2026, 11, 13)), '2026-11-16'); // Fri -> Mon
    assert.equal(lands('weekdays', SAT_14_NOV), '2026-11-16');
    assert.equal(lands('weekdays', at(2026, 11, 16)), '2026-11-17');
    assert.equal(lands('weekends', SAT_14_NOV), '2026-11-15');
    assert.equal(lands('weekends', at(2026, 11, 15)), '2026-11-21');
    assert.equal(lands('mon, wed, fri', SAT_14_NOV), '2026-11-16');
    assert.equal(lands('mon, wed, fri', at(2026, 11, 16)), '2026-11-18');
  });

  it('keeps the rhythm of "every 2 weeks" when a review is late', () => {
    const rule = 'every 2 weeks on monday';
    const dueMon2Nov = at(2026, 11, 2, 0, 0);
    // The owner's example: due Mon 2 Nov, reviewed Wed 4 Nov -> Mon 16 Nov.
    assert.equal(lands(rule, at(2026, 11, 4), dueMon2Nov), '2026-11-16');
    // On time.
    assert.equal(lands(rule, at(2026, 11, 2), dueMon2Nov), '2026-11-16');
    // A week late, on the off Monday: still the 16th, not the 23rd.
    assert.equal(lands(rule, at(2026, 11, 9), dueMon2Nov), '2026-11-16');
    // More than one round late: the series goes on — 2, 16, 30.
    assert.equal(lands(rule, at(2026, 11, 17), dueMon2Nov), '2026-11-30');
  });

  it('starts a fresh series when the due date is not a day of the rule', () => {
    const rule = 'every 2 weeks on monday';
    assert.equal(lands(rule, SAT_14_NOV, at(2026, 11, 5, 0, 0)), '2026-11-16'); // due on a Thursday
    assert.equal(lands(rule, SAT_14_NOV), '2026-11-16'); // no due date known
  });

  it('counts weeks from Monday for a rule with several days', () => {
    // Due Thu 5 Nov under "every 2 weeks on mon and thu": that week is on, the next is off.
    const rule = 'every 2 weeks on mon and thu';
    const dueThu5Nov = at(2026, 11, 5, 0, 0);
    assert.equal(lands(rule, at(2026, 11, 5), dueThu5Nov), '2026-11-16');
    assert.equal(lands(rule, at(2026, 11, 16), dueThu5Nov), '2026-11-19');
  });
});

describe('nextRotationDate — days of the month', () => {
  it('lands on the next such date', () => {
    assert.equal(lands('1st', SAT_14_NOV), '2026-12-01');
    assert.equal(lands('1st', at(2026, 12, 1)), '2027-01-01');
    assert.equal(lands('1st and 15th', SAT_14_NOV), '2026-11-15');
    assert.equal(lands('1st and 15th', at(2026, 11, 15)), '2026-12-01');
  });

  it('uses the last day of a month that is too short', () => {
    assert.equal(lands('31st', SAT_14_NOV), '2026-11-30');
    assert.equal(lands('31st', at(2026, 11, 30)), '2026-12-31');
    assert.equal(lands('30th', at(2027, 2, 1)), '2027-02-28');
    assert.equal(lands('last day of the month', SAT_14_NOV), '2026-11-30');
    assert.equal(lands('last day of the month', at(2027, 2, 1)), '2027-02-28');
    assert.equal(lands('last day of the month', at(2028, 2, 1)), '2028-02-29');
  });

  it('finds the nth weekday of the month', () => {
    assert.equal(lands('first saturday of the month', SAT_14_NOV), '2026-12-05');
    assert.equal(lands('first saturday of the month', at(2026, 12, 5)), '2027-01-02');
    assert.equal(lands('last friday', SAT_14_NOV), '2026-11-27');
    assert.equal(lands('second tuesday', SAT_14_NOV), '2026-12-08');
    assert.equal(lands('first and third monday', SAT_14_NOV), '2026-11-16');
    assert.equal(lands('first and third monday', at(2026, 11, 16)), '2026-12-07');
  });

  it('finds the first and last working day of the month', () => {
    assert.equal(lands('last weekday of the month', SAT_14_NOV), '2026-11-30'); // a Monday
    assert.equal(lands('last weekday of the month', at(2027, 1, 1)), '2027-01-29'); // 31 Jan is a Sunday
    assert.equal(lands('first weekday of the month', at(2026, 7, 20)), '2026-08-03'); // 1 Aug is a Saturday
  });

  it('keeps the rhythm of "every 3 months"', () => {
    const rule = 'every 3 months on the 1st';
    assert.equal(lands(rule, SAT_14_NOV, at(2026, 10, 1, 0, 0)), '2027-01-01'); // Oct, Jan, Apr …
    assert.equal(lands(rule, SAT_14_NOV, at(2026, 10, 20, 0, 0)), '2026-12-01'); // no rhythm yet
  });

  it('lands on a date of the year', () => {
    assert.equal(lands('3 march', SAT_14_NOV), '2027-03-03');
    assert.equal(lands('3 march', at(2027, 3, 3)), '2028-03-03');
    assert.equal(lands('feb 30', SAT_14_NOV), '2027-02-28');
    assert.equal(lands('first monday of january', SAT_14_NOV), '2027-01-04');
    assert.equal(lands('jan 1 and jul 1', SAT_14_NOV), '2027-01-01');
  });
});

// Found by the adversarial review of 2026-11-15; each was run against the code before the fix.
describe('review of 2026-11-15', () => {
  it('does not take the name of an Object property for a word it knows', () => {
    // `'constructor' in {}` is true: these read as a weekday, threw, or never returned.
    for (const t of ['constructor', '__proto__', 'valueOf', 'hasOwnProperty', '5constructor', 'constructor to monday', 'constructor-monday', 'toString friday']) {
      assert.equal(kind(t), 'invalid', t);
    }
  });

  it('reads a comma between digits only where it can mean one thing', () => {
    const days = (t: string) => (parseRotation(t) as Extract<RotationRule, { kind: 'interval' }>).days;
    assert.equal(days('1,000 days'), 1000); // digit groups, as before 2026-11-14
    assert.equal(days('1,000'), 1000);
    assert.equal(days('12,500 days'), 12500);
    assert.equal(days('1,5 weeks'), 10.5); // a decimal comma, directly before a unit
    for (const t of ['1,15', '10,5', '1, 15', '1,5', '3,10 march']) assert.equal(kind(t), 'invalid', t);
    assert.equal(says('1st,15th'), '1st, 15th of the month');
  });

  it('reads compound durations however they are joined', () => {
    const days = (t: string) => (parseRotation(t) as Extract<RotationRule, { kind: 'interval' }>).days;
    assert.equal(days('1 week and 2 days'), 9);
    assert.equal(days('2 weeks and 3 days'), 17);
    assert.equal(days('a week and a day'), 8);
    assert.equal(days('two weeks and three days'), 17);
    assert.equal(days('1w2d'), 9);
    assert.equal(days('1d12h'), 1.5);
    assert.equal(days('.5w'), 3.5);
    assert.equal(says('1 week and 2 days'), 'every 1 week 2 days');
    // … and still refuses what is not a duration
    for (const t of ['a', 'an', 'and', '1w2x', 'two', '2 weeks and 3']) assert.equal(kind(t), 'invalid', t);
  });

  it('reads 0 of anything as always due, and a unit on its own as one of it', () => {
    for (const t of ['0', '0 days', '0 weeks', '0 months', '0 years']) {
      assert.deepEqual(parseRotation(t), { kind: 'interval', days: 0, label: 'always due' }, t);
    }
    assert.equal(says('day'), 'every day');
    assert.equal(says('week'), 'every week');
    assert.equal(says('month'), 'every month');
    assert.equal(says('year'), 'every year');
    assert.equal(kind('days'), 'invalid');
  });

  it('reads "second last" as the one before the last', () => {
    for (const t of ['second last friday', 'second-last friday', 'second to last friday of the month', '2nd last friday', 'next to last friday', 'penultimate friday']) {
      assert.equal(says(t), '2nd-last Fri of the month', t);
    }
    // November 2026: Fridays on 6, 13, 20, 27; it ends on Monday the 30th.
    assert.equal(lands('second last friday', SAT_14_NOV), '2026-11-20');
    assert.equal(lands('second last friday', at(2026, 11, 20)), '2026-12-18'); // December: 4, 11, 18, 25
    assert.equal(lands('second last weekday of the month', SAT_14_NOV), '2026-11-27');
    assert.equal(lands('last and second last friday', SAT_14_NOV), '2026-11-20');
    // "second" and "last" as two days still works when they are written as two
    assert.equal(says('second and last friday'), '2nd Fri, last Fri of the month');
    // … and it is a weekday of the month, nothing else
    for (const t of ['second last day of the month', 'second last march', 'every second last week']) {
      assert.equal(kind(t), 'invalid', t);
    }
  });

  it('gives every rule it accepts a date', () => {
    // Was: no date within 12 years -> the scheduler decided, without a word.
    assert.equal(lands('fifth monday of february', SAT_14_NOV), '2044-02-29');
    // A skip is at most ten years, so one period always fits the search.
    assert.equal(kind('every 520 weeks on monday'), 'weekly');
    assert.equal(kind('every 521 weeks on monday'), 'invalid');
    assert.equal(kind('every 120 months on the 1st'), 'monthly');
    assert.equal(kind('every 121 months on the 1st'), 'invalid');
    // Due and reviewed on Monday 2 Nov: the next one is a whole period on.
    assert.equal(lands('every 520 weeks on monday', at(2026, 11, 2), at(2026, 11, 2, 0, 0)), '2036-10-20');
    assert.equal(lands('every 120 months on the 1st', at(2026, 11, 1), at(2026, 11, 1, 0, 0)), '2036-11-01');
  });

  it('counts whole days on the calendar, across a daylight-saving change', () => {
    // Sydney, 2026: clocks go back on Sunday 5 April (a 25-hour day) and forward on Sunday
    // 4 October (23 hours). `now + N × 24 h` landed on the same day, or two days on.
    const before = process.env.TZ;
    process.env.TZ = 'Australia/Sydney';
    try {
      const landing = (text: string, now: number) => {
        const next = nextRotationDate(parseRotation(text), now, now)!;
        const x = new Date(next.date);
        return `${ymd(next.date)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')} (${next.days})`;
      };
      assert.equal(landing('1', at(2026, 4, 5, 0, 30)), '2026-04-06 00:30 (1)');
      assert.equal(landing('1', at(2026, 10, 3, 23, 30)), '2026-10-04 23:30 (1)');
      assert.equal(landing('7', at(2026, 9, 27, 23, 30)), '2026-10-04 23:30 (7)');
      assert.equal(landing('2 weeks', at(2026, 3, 29, 0, 30)), '2026-04-12 00:30 (14)');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});
