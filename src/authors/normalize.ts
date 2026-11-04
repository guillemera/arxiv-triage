/**
 * Author-name normalisation: "surname plus initials" with diacritics and case folded.
 *
 * Names arrive in several shapes: arXiv display names ("Jane A. Doe"), arXiv's own search
 * queries ("Doe, J A", "Ya.Ivanov") and INSPIRE names ("Ferrer Ibáñez, Lucía"). Compound
 * surnames are ambiguous (arXiv may file "Lucía Ferrer Ibáñez" as "Ibáñez, L F"), so a name yields
 * every plausible surname split and two names match when any of their keys are compatible.
 */

export interface NameKey {
  /** Folded surname, words separated by single spaces, e.g. "ferrer ibanez". */
  surname: string;
  /** Folded initials of the given names, e.g. "ja". */
  initials: string;
}

const PARTICLES = new Set([
  'van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'du', 'des', 'dos', 'das', 'do',
  'la', 'le', 'ten', 'ter', 'bin', 'ibn', 'al', 'el', 'zu', 'st', 'mac', "'t",
]);
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/** Lower case, diacritics stripped, ligatures and special letters mapped to ASCII. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[øØ]/g, 'o')
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐ]/g, 'd')
    .replace(/æ/gi, 'ae')
    .replace(/œ/gi, 'oe')
    .toLowerCase();
}

function tokens(s: string): string[] {
  return fold(s)
    .replace(/[.‐-―]/g, (c) => (c === '.' ? ' ' : '-'))
    .replace(/[^a-z0-9' -]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t && !SUFFIXES.has(t));
}

function surnameOf(parts: string[]): string {
  return parts
    .join(' ')
    .replace(/-/g, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function initialsOf(given: string[]): string {
  return given
    .flatMap((g) => g.split('-'))
    .filter(Boolean)
    .map((g) => g[0])
    .join('');
}

function push(out: NameKey[], surnameParts: string[], given: string[]): void {
  const surname = surnameOf(surnameParts);
  if (!surname) return;
  const key = { surname, initials: initialsOf(given) };
  if (!out.some((k) => k.surname === key.surname && k.initials === key.initials)) out.push(key);
}

/** All plausible keys for a name, most likely first. */
export function nameKeys(name: string): NameKey[] {
  const out: NameKey[] = [];
  const comma = name.indexOf(',');
  if (comma >= 0) {
    const sur = tokens(name.slice(0, comma));
    const given = tokens(name.slice(comma + 1));
    if (!sur.length) return out;
    push(out, sur, given);
    // "Ferrer Ibáñez, Lucía" may be filed elsewhere as "Ibáñez, L F".
    for (let i = 1; i < sur.length; i++) {
      if (!PARTICLES.has(sur[i - 1]!)) push(out, sur.slice(i), [...given, ...sur.slice(0, i)]);
    }
    return out;
  }
  const t = tokens(name);
  if (!t.length) return out;
  // Surname is the last token plus any particles before it ("Jan de Boer" → "de boer").
  let start = t.length - 1;
  while (start > 1 && PARTICLES.has(t[start - 1]!)) start--;
  push(out, t.slice(start), t.slice(0, start));
  // Double surnames: "Lucía Ferrer Ibáñez" may also be "Ferrer Ibáñez, L".
  if (start >= 2) push(out, t.slice(start - 1), t.slice(0, start - 1));
  if (start > 0 && start < t.length - 1) push(out, t.slice(t.length - 1), t.slice(0, t.length - 1));
  return out;
}

/** Initials agree when the first letters match and one string extends the other. */
export function initialsCompatible(a: string, b: string): boolean {
  if (!a || !b) return a === b;
  return a[0] === b[0] && (a.startsWith(b) || b.startsWith(a));
}

export function keysMatch(a: readonly NameKey[], b: readonly NameKey[]): boolean {
  return a.some((x) => b.some((y) => x.surname === y.surname && initialsCompatible(x.initials, y.initials)));
}

/** Short display form, e.g. "J. Doe". */
export function shortName(name: string): string {
  const key = nameKeys(name)[0];
  if (!key) return name.trim();
  const comma = name.indexOf(',');
  const words = key.surname.split(' ').length;
  const surname =
    comma >= 0
      ? name.slice(0, comma).trim()
      : name.trim().split(/[\s.]+/).filter(Boolean).slice(-words).join(' ');
  const initials = [...key.initials.toUpperCase()].map((c) => c + '.').join(' ');
  return initials ? `${initials} ${surname}` : surname;
}
