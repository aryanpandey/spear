export function assertEnum<T extends string>(label: string, value: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`invalid ${label} "${value}" (expected: ${allowed.join(", ")})`);
  }
  return value as T;
}

export function parseIds(raw?: string): number[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n)) throw new Error(`invalid id "${s}"`);
      return n;
    });
}
