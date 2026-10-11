/** Shared helpers for converting between Open Factory Plan and other planners. */

/** A converted value, with notes on anything the target format can't hold. */
export interface Conversion<T> {
  value: T;
  notes: string[];
}

/** A URL-safe slug of `label`, unique within `used` (which it updates). */
export function uniqueSlug(label: string, used: Set<string>, fallback: string): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback;
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
  used.add(slug);
  return slug;
}
