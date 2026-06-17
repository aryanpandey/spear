export const THEMES = ["matrix", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** Validate a stored/inbound theme value, defaulting to "matrix". */
export function coerceTheme(value: unknown): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "matrix";
}
