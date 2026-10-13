import { describe, expect, test } from 'bun:test';
import { categoriesOf, filterTemplates } from '../../src/features/templates/lib/search';
import { matchSnippets, snippetHtml } from '../../src/features/templates/lib/snippets';

describe('snippet expansion', () => {
  test('one line goes inline, escaped; several lines become paragraphs, a blank one a break', () => {
    expect(snippetHtml('Voici <b>notre</b> devis & co')).toBe(
      'Voici &lt;b&gt;notre&lt;/b&gt; devis &amp; co',
    );
    expect(snippetHtml('Cordialement,\n\nL’équipe {{ params.firstName }}')).toBe(
      '<p>Cordialement,</p><p><br></p><p>L’équipe {{ params.firstName }}</p>',
    );
  });

  test('the typed text reaches the shortcuts it starts, then the names; nothing typed reaches all', () => {
    const snippets = [
      { name: 'Signature', shortcut: '/signature' },
      { name: 'Devis', shortcut: '/devis' },
      { name: 'Sigle', shortcut: '/abc' },
    ];
    expect(matchSnippets(snippets, '').map((s) => s.shortcut)).toEqual([
      '/signature',
      '/devis',
      '/abc',
    ]);
    expect(matchSnippets(snippets, 'sig').map((s) => s.shortcut)).toEqual(['/signature', '/abc']);
    expect(matchSnippets(snippets, '/dev').map((s) => s.shortcut)).toEqual(['/devis']);
    expect(matchSnippets(snippets, 'zzz')).toEqual([]);
  });
});

describe('the library search', () => {
  const templates = [
    { name: 'Relance', subject: 'On en reparle ?', category: 'Suivi' },
    { name: 'Bienvenue', subject: 'Bienvenue à bord', category: 'Accueil' },
    { name: 'Événement', subject: 'Invitation', category: undefined },
  ];
  test('name, subject or category hold the text, accents and case aside; a category narrows', () => {
    expect(filterTemplates(templates, 'EVENE').map((t) => t.name)).toEqual(['Événement']);
    expect(filterTemplates(templates, 'bord').map((t) => t.name)).toEqual(['Bienvenue']);
    expect(filterTemplates(templates, 'suivi').map((t) => t.name)).toEqual(['Relance']);
    expect(filterTemplates(templates, '', 'Accueil').map((t) => t.name)).toEqual(['Bienvenue']);
    expect(filterTemplates(templates, 'relance', 'Accueil')).toEqual([]);
  });
  test('the categories in use, sorted, the empty one left out', () => {
    expect(categoriesOf(templates)).toEqual(['Accueil', 'Suivi']);
  });
});
