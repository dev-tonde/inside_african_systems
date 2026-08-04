export type CalendarDatePart = {dateTime?: string; date?: string; timeZone?: string};

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

export type NormalizedCalendarDatePart = {
  kind: "date" | "dateTime";
  instant: string;
};

const invalidTime = (): never => {
  throw new Error("Calendar event was invalid");
};

const utcDate = (local: LocalDateTime): Date => {
  const date = new Date(0);
  date.setUTCFullYear(local.year, local.month - 1, local.day);
  date.setUTCHours(local.hour, local.minute, local.second, local.millisecond);
  return date;
};

const sameLocalDateTime = (date: Date, local: LocalDateTime): boolean =>
  date.getUTCFullYear() === local.year
  && date.getUTCMonth() === local.month - 1
  && date.getUTCDate() === local.day
  && date.getUTCHours() === local.hour
  && date.getUTCMinutes() === local.minute
  && date.getUTCSeconds() === local.second
  && date.getUTCMilliseconds() === local.millisecond;

const parseDate = (value: string): LocalDateTime => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return invalidTime();
  const local = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  };
  const date = utcDate(local);
  if (!sameLocalDateTime(date, local)) return invalidTime();
  return local;
};

const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/u;

const parseDateTime = (value: string): {local: LocalDateTime; offsetMinutes: number | null} => {
  const match = dateTimePattern.exec(value);
  if (!match) return invalidTime();
  const local = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: match[7] === undefined ? 0 : Number(match[7].padEnd(3, "0")),
  };
  const localAsUtc = utcDate(local);
  if (
    local.hour > 23
    || local.minute > 59
    || local.second > 59
    || !sameLocalDateTime(localAsUtc, local)
  ) return invalidTime();

  const offset = match[8];
  if (offset === undefined) return {local, offsetMinutes: null};
  if (offset === "Z") return {local, offsetMinutes: 0};
  const offsetMatch = /^([+-])(\d{2}):(\d{2})$/u.exec(offset);
  if (!offsetMatch) return invalidTime();
  const hours = Number(offsetMatch[2]);
  const minutes = Number(offsetMatch[3]);
  if (hours > 23 || minutes > 59) return invalidTime();
  const magnitude = hours * 60 + minutes;
  return {local, offsetMinutes: offsetMatch[1] === "+" ? magnitude : -magnitude};
};

const formatForZone = (timeZone: string, includeOffset = false): Intl.DateTimeFormat => {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      ...(includeOffset ? {timeZoneName: "longOffset" as const} : {}),
    });
  } catch {
    return invalidTime();
  }
};

const formattedParts = (formatter: Intl.DateTimeFormat, instant: number): LocalDateTime => {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant))
      .filter((part) => ["year", "month", "day", "hour", "minute", "second"].includes(part.type))
      .map((part) => [part.type, Number(part.value)]),
  ) as Partial<LocalDateTime>;
  if (
    parts.year === undefined || parts.month === undefined || parts.day === undefined
    || parts.hour === undefined || parts.minute === undefined || parts.second === undefined
  ) return invalidTime();
  return {...parts, millisecond: new Date(instant).getUTCMilliseconds()} as LocalDateTime;
};

const offsetAt = (formatter: Intl.DateTimeFormat, instant: number): number => {
  const name = formatter.formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")?.value;
  if (name === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(name ?? "");
  if (!match) return invalidTime();
  const magnitude = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? magnitude : -magnitude;
};

const matchesLocal = (candidate: LocalDateTime, local: LocalDateTime): boolean =>
  candidate.year === local.year
  && candidate.month === local.month
  && candidate.day === local.day
  && candidate.hour === local.hour
  && candidate.minute === local.minute
  && candidate.second === local.second
  && candidate.millisecond === local.millisecond;

const resolveOffsetlessDateTime = (local: LocalDateTime, timeZone: string): string => {
  const display = formatForZone(timeZone);
  const offsetDisplay = formatForZone(timeZone, true);
  const localAsUtc = utcDate(local).getTime();
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) offsets.add(offsetAt(offsetDisplay, localAsUtc + hours * 60 * 60 * 1000));
  const candidates = new Set<number>();
  for (const offsetMinutes of offsets) {
    const instant = localAsUtc - offsetMinutes * 60 * 1000;
    if (matchesLocal(formattedParts(display, instant), local)) candidates.add(instant);
  }
  if (candidates.size !== 1) return invalidTime();
  return new Date([...candidates][0]!).toISOString();
};

const allDayInstant = (local: LocalDateTime): string => {
  const instant = utcDate(local).getTime() - 2 * 60 * 60 * 1000;
  return new Date(instant).toISOString();
};

export const normalizeCalendarDatePart = (part: CalendarDatePart): NormalizedCalendarDatePart => {
  const hasDateTime = part.dateTime !== undefined;
  const hasDate = part.date !== undefined;
  if (hasDateTime === hasDate) return invalidTime();
  if (part.timeZone !== undefined && typeof part.timeZone !== "string") return invalidTime();
  if (part.timeZone !== undefined) formatForZone(part.timeZone);
  if (hasDate) {
    if (typeof part.date !== "string") return invalidTime();
    return {kind: "date", instant: allDayInstant(parseDate(part.date))};
  }
  if (typeof part.dateTime !== "string") return invalidTime();
  const {local, offsetMinutes} = parseDateTime(part.dateTime);
  if (offsetMinutes !== null) {
    const instant = utcDate(local).getTime() - offsetMinutes * 60 * 1000;
    if (!sameLocalDateTime(new Date(instant + offsetMinutes * 60 * 1000), local)) return invalidTime();
    return {kind: "dateTime", instant: new Date(instant).toISOString()};
  }
  if (!part.timeZone || typeof part.timeZone !== "string") return invalidTime();
  return {kind: "dateTime", instant: resolveOffsetlessDateTime(local, part.timeZone)};
};

export const normalizeCalendarInterval = (start: CalendarDatePart, end: CalendarDatePart) => {
  const normalizedStart = normalizeCalendarDatePart(start);
  const normalizedEnd = normalizeCalendarDatePart(end);
  if (normalizedStart.kind !== normalizedEnd.kind || normalizedStart.instant >= normalizedEnd.instant) return invalidTime();
  return {startsAt: normalizedStart.instant, endsAt: normalizedEnd.instant};
};
