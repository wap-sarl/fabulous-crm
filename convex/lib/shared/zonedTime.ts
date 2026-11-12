// A day as an organisation's clock has it: Intl is the only calendar the runtime knows, and it answers for one instant at a time.

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** What a clock of the zone shows at that instant. */
function wallClockOf(instant: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The instant at which the zone's clock shows midnight of that date; a date past the month's end rolls over, as `Date.UTC` has it. The offset is read where the guess lands and corrected once more, for a change of offset in between. */
function midnightOf(timeZone: string, year: number, month: number, day: number): number {
  const wanted = Date.UTC(year, month - 1, day);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const shown = wallClockOf(guess, timeZone);
    guess +=
      wanted -
      Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
  }
  return guess;
}

/** The day an instant falls in for the zone: its key, the hour the clock shows, and its bounds as instants (`end` excluded). What the organisation's clock calls today; a browser elsewhere may call it otherwise, and its own « aujourd'hui » follows the browser. */
export function zonedDayOf(
  instant: number,
  timeZone: string,
): { key: string; hour: number; start: number; end: number } {
  const { year, month, day, hour } = wallClockOf(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    key: `${year}-${pad(month)}-${pad(day)}`,
    hour,
    start: midnightOf(timeZone, year, month, day),
    end: midnightOf(timeZone, year, month, day + 1),
  };
}
