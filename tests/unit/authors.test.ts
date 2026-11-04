import { describe, expect, it } from 'vitest';
import { fold, initialsCompatible, keysMatch, nameKeys, shortName } from '../../src/authors/normalize';
import { newPerson, PersonMatcher } from '../../src/authors/people';

describe('nameKeys', () => {
  it.each([
    ['Jane A. Doe', { surname: 'doe', initials: 'ja' }],
    ['Doe, J A', { surname: 'doe', initials: 'ja' }],
    ['Ya.Ivanov', { surname: 'ivanov', initials: 'y' }],
    ['Mei-Ling Hsu', { surname: 'hsu', initials: 'ml' }],
    ['Hanna Müller', { surname: 'muller', initials: 'h' }],
    ['Pieter de Vries', { surname: 'de vries', initials: 'p' }],
    ['Ferrer Ibáñez, Lucía', { surname: 'ferrer ibanez', initials: 'l' }],
    ['Juan Pablo Ortega Jr.', { surname: 'ortega', initials: 'jp' }],
  ])('%s → first key %o', (name, key) => {
    expect(nameKeys(name)[0]).toEqual(key);
  });

  it('yields both splits of a double surname', () => {
    expect(nameKeys('Lucía Ferrer Ibáñez')).toEqual(
      expect.arrayContaining([
        { surname: 'ibanez', initials: 'lf' },
        { surname: 'ferrer ibanez', initials: 'l' },
      ]),
    );
    expect(nameKeys('Ferrer Ibáñez, Lucía')).toEqual(
      expect.arrayContaining([
        { surname: 'ferrer ibanez', initials: 'l' },
        { surname: 'ibanez', initials: 'lf' },
      ]),
    );
  });

  it('folds diacritics and special letters', () => {
    expect(fold('Łukasz Ørsted Müller-Straße')).toBe('lukasz orsted muller-strasse');
  });
});

describe('matching', () => {
  it('requires compatible initials', () => {
    expect(initialsCompatible('w', 'wa')).toBe(true);
    expect(initialsCompatible('wa', 'wb')).toBe(false);
    expect(initialsCompatible('', 'w')).toBe(false);
  });

  it('matches INSPIRE names against arXiv display names and queries', () => {
    // arXiv may list "Lucía Ferrer Ibáñez" with the query "Ibáñez, L F".
    expect(keysMatch(nameKeys('Ferrer Ibáñez, Lucía'), nameKeys('Ibáñez, L F'))).toBe(true);
    expect(keysMatch(nameKeys('Ferrer Ibáñez, Lucía'), nameKeys('Lucía Ferrer Ibáñez'))).toBe(true);
    expect(keysMatch(nameKeys('Jane Doe'), nameKeys('Doe, J'))).toBe(true);
    expect(keysMatch(nameKeys('Jane Doe'), nameKeys('Doe, P'))).toBe(false);
  });

  it('PersonMatcher uses names, aliases and arXiv queries', () => {
    const doe = newPerson('Jane Doe');
    const ivanov = { ...newPerson('Yakov Ivanov'), aliases: ['Ya. Ivanov'] };
    const m = new PersonMatcher([doe, ivanov]);
    expect(m.match({ name: 'J. Doe', query: null })).toBe(doe);
    expect(m.match({ name: 'Ya.Ivanov', query: 'Ya.Ivanov' })).toBe(ivanov);
    expect(m.match({ name: 'Tom Smith', query: 'Smith, T' })).toBeNull();
  });
});

describe('shortName', () => {
  it.each([
    ['Jane Doe', 'J. Doe'],
    ['Ya.Ivanov', 'Y. Ivanov'],
    ['Pieter de Vries', 'P. de Vries'],
    ['Ferrer Ibáñez, Lucía', 'L. Ferrer Ibáñez'],
  ])('%s → %s', (name, short) => {
    expect(shortName(name)).toBe(short);
  });
});
