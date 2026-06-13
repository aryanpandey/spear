import type { Effort } from "../types.js";
import { minutesUntil } from "../util/time.js";

export interface TimeOpts {
  effortMinutes: { small: number; medium: number; large: number };
  timeLeftMin: number;
  now?: Date;
}

/** Resolve time-left from an explicit `hours` override, else the workday end. */
export function buildTimeOpts(
  effortMinutes: { small: number; medium: number; large: number },
  workdayEnd: { hour: number; minute: number },
  hours?: number,
  now: Date = new Date(),
): TimeOpts {
  const timeLeftMin =
    hours != null && !Number.isNaN(hours)
      ? Math.max(0, Math.round(hours * 60))
      : minutesUntil(workdayEnd.hour, workdayEnd.minute, now);
  return { effortMinutes, timeLeftMin, now };
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

export interface TimeFitItem {
  estMin: number;
  cumMin: number;
  fits: boolean;
}

export interface TimeFit {
  perItem: TimeFitItem[];
  plannedMin: number;
  fitsCount: number;
  spillCount: number;
  /** index of the first item that doesn't fit the budget, or -1 if all fit. */
  cutIndex: number;
}

/**
 * Walk items (in plan order) accumulating estimated minutes; everything past the
 * `timeLeftMin` budget "spills to tomorrow". Pure.
 */
export function timeBudget(
  efforts: (Effort | null)[],
  effortMinutes: Record<"small" | "medium" | "large", number>,
  timeLeftMin: number,
): TimeFit {
  const perItem: TimeFitItem[] = [];
  let cum = 0;
  let cutIndex = -1;
  efforts.forEach((e, i) => {
    const estMin = effortMinutes[e ?? "medium"];
    cum += estMin;
    const fits = cum <= timeLeftMin;
    if (!fits && cutIndex === -1) cutIndex = i;
    perItem.push({ estMin, cumMin: cum, fits });
  });
  const fitsCount = perItem.filter((p) => p.fits).length;
  return { perItem, plannedMin: cum, fitsCount, spillCount: perItem.length - fitsCount, cutIndex };
}
