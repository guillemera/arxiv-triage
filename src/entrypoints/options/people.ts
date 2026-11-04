/**
 * Followed and blocked authors on the settings page: add, rename, aliases, unfollow, and linking to
 * an INSPIRE profile (BAI and ORCID), which tells namesakes apart.
 */

import { keysMatch, nameKeys } from '../../authors/normalize';
import { BAI_PATTERN, newPerson, ORCID_PATTERN, parseAliases, type People, type Person } from '../../authors/people';
import { InspireClient, type InspireAuthor } from '../../sources/inspire';
import { getPeople, updatePeople } from '../../storage/sync';

type ListName = keyof People;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: { className?: string; text?: string } = {}, ...children: Node[]) {
  const e = document.createElement(tag);
  if (props.className) e.className = props.className;
  if (props.text !== undefined) e.textContent = props.text;
  e.append(...children);
  return e;
}

function button(text: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', { className, text });
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function sameName(a: string, b: string): boolean {
  return keysMatch(nameKeys(a), nameKeys(b));
}

/** People whose editor is open survive re-renders (storage changes re-render the lists). */
const open = new Set<string>();
const inspire = new InspireClient();

function summary(p: Person): HTMLElement {
  const parts = el('span', { className: 'person-summary' });
  parts.append(el('span', { className: 'name', text: p.name }));
  if (p.aliases.length) parts.append(el('span', { className: 'muted', text: ` also ${p.aliases.join(', ')}` }));
  if (p.inspireBai || p.orcid) {
    const linked = el('span', { className: 'linked', text: `INSPIRE: ${p.inspireBai ?? p.orcid}` });
    linked.title = [p.affiliation, p.orcid && `ORCID ${p.orcid}`].filter(Boolean).join(' · ');
    parts.append(linked);
  }
  return parts;
}

function candidateList(target: HTMLElement, candidates: InspireAuthor[], use: (a: InspireAuthor) => void): void {
  target.replaceChildren();
  if (!candidates.length) {
    target.append(el('li', { className: 'muted', text: 'No INSPIRE profile found under that name.' }));
    return;
  }
  for (const a of candidates) {
    const label = [a.name, a.affiliation, a.bai].filter(Boolean).join(' · ');
    const link = el('a', { text: 'profile' });
    link.href = `https://inspirehep.net/authors/${a.recid}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    target.append(el('li', {}, el('span', { text: label }), document.createTextNode(' '), link, document.createTextNode(' '), button('Use', () => use(a))));
  }
}

function editor(list: ListName, p: Person, close: () => void): HTMLElement {
  const form = el('div', { className: 'person-editor' });
  const field = (label: string, value: string, placeholder = '') => {
    const input = el('input');
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    form.append(el('label', { className: 'stacked' }, document.createTextNode(label), input));
    return input;
  };
  const name = field('Name', p.name);
  const aliases = field('Other spellings (comma-separated)', p.aliases.join(', '), 'e.g. J. Doe, Jane A. Doe');
  const bai = field('INSPIRE identifier (BAI)', p.inspireBai ?? '', 'e.g. J.Doe.1');
  const orcid = field('ORCID', p.orcid ?? '', '0000-0000-0000-0000');
  let recid = p.inspireRecid;
  let affiliation = p.affiliation;

  const candidates = el('ul', { className: 'inspire-candidates' });
  const status = el('p', { className: 'muted' });
  status.setAttribute('role', 'status');
  const find = button('Find on INSPIRE', async () => {
    status.textContent = 'Searching INSPIRE…';
    try {
      candidateList(candidates, await inspire.searchAuthors(name.value.trim()), (a) => {
        bai.value = a.bai ?? '';
        orcid.value = a.orcid ?? '';
        recid = a.recid;
        affiliation = a.affiliation ?? undefined;
        status.textContent = `Linked to ${a.name}${a.affiliation ? ` (${a.affiliation})` : ''}. Save to keep it.`;
        candidates.replaceChildren();
      });
      status.textContent = '';
    } catch (err) {
      status.textContent = `INSPIRE search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
  find.classList.add('find-inspire');

  const save = button(
    'Save',
    async () => {
      const b = bai.value.trim();
      const o = orcid.value.trim().toUpperCase();
      if (!name.value.trim()) return void (status.textContent = 'A name is needed.');
      if (b && !BAI_PATTERN.test(b)) return void (status.textContent = 'That does not look like an INSPIRE identifier (e.g. J.Doe.1).');
      if (o && !ORCID_PATTERN.test(o)) return void (status.textContent = 'That does not look like an ORCID (0000-0000-0000-0000).');
      const updated: Person = {
        ...p,
        name: name.value.trim(),
        aliases: parseAliases(aliases.value),
        inspireBai: b || undefined,
        orcid: o || undefined,
        inspireRecid: b || o ? recid : undefined,
        affiliation: b || o ? affiliation : undefined,
      };
      open.delete(p.id);
      await updatePeople(list, (xs) => xs.map((x) => (x.id === p.id ? updated : x)));
    },
    'primary',
  );
  form.append(el('div', { className: 'row' }, find), candidates, status, el('div', { className: 'row' }, save, button('Cancel', close)));
  return form;
}

function renderList(list: ListName, people: Person[]): void {
  const ul = $(list);
  $(`${list}-count`).textContent = String(people.length);
  ul.replaceChildren();
  if (!people.length) {
    ul.append(el('li', { className: 'empty', text: list === 'followed' ? 'Nobody followed yet.' : 'Nobody blocked.' }));
    return;
  }
  for (const p of [...people].sort((a, b) => a.name.localeCompare(b.name))) {
    const li = el('li', { className: 'person' });
    li.dataset.id = p.id;
    const rerender = async () => renderList(list, (await getPeople())[list]);
    const line = el(
      'div',
      { className: 'person-line' },
      summary(p),
      button(open.has(p.id) ? 'Close' : 'Edit', () => {
        if (open.has(p.id)) open.delete(p.id);
        else open.add(p.id);
        void rerender();
      }),
      button(list === 'followed' ? 'Unfollow' : 'Unblock', () => {
        open.delete(p.id);
        void updatePeople(list, (xs) => xs.filter((x) => x.id !== p.id));
      }),
    );
    li.append(line);
    if (open.has(p.id)) {
      li.append(
        editor(list, p, () => {
          open.delete(p.id);
          void rerender();
        }),
      );
    }
    ul.append(li);
  }
}

export async function renderPeople(): Promise<void> {
  const people = await getPeople();
  renderList('followed', people.followed);
  renderList('blocked', people.blocked);
}

/** Adds an author to a list (unless a matching name is there) and takes them off the other one. */
async function add(list: ListName, name: string): Promise<Person> {
  const other: ListName = list === 'followed' ? 'blocked' : 'followed';
  await updatePeople(other, (xs) => xs.filter((p) => ![p.name, ...p.aliases].some((n) => sameName(n, name))));
  let person: Person | undefined;
  await updatePeople(list, (xs) => {
    person = xs.find((p) => [p.name, ...p.aliases].some((n) => sameName(n, name)));
    if (person) return xs;
    person = newPerson(name);
    return [...xs, person];
  });
  return person!;
}

/**
 * Opens the INSPIRE link editor for an author named on a listing (`#link=<name>`): the person they
 * follow or block under that name, or a newly followed one.
 */
export async function openLink(name: string): Promise<void> {
  const people = await getPeople();
  const find = (list: ListName) => people[list].find((p) => [p.name, ...p.aliases].some((n) => sameName(n, name)));
  const list: ListName = find('followed') ? 'followed' : find('blocked') ? 'blocked' : 'followed';
  const person = find(list) ?? (await add('followed', name));
  open.add(person.id);
  await renderPeople();
  const li = document.querySelector<HTMLElement>(`li.person[data-id="${person.id}"]`);
  li?.scrollIntoView({ block: 'center' });
  li?.querySelector<HTMLButtonElement>('.find-inspire')?.click();
}

export function mountPeople(): void {
  const input = $<HTMLInputElement>('add-name');
  const status = $('add-status');
  for (const b of document.querySelectorAll<HTMLButtonElement>('#add-person button[data-list]')) {
    b.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return void (status.textContent = 'Type a name first.');
      const list = b.dataset.list as ListName;
      const person = await add(list, name);
      input.value = '';
      status.textContent = `${list === 'followed' ? 'Following' : 'Blocked'} ${person.name}.`;
    });
  }
}
