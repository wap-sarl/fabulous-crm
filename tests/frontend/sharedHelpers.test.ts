import { describe, expect, test } from 'bun:test';
import {
  countDigitsBefore,
  digitIndexToFormattedIndex,
  formatGrouped,
} from '../../src/design-system/components/inputs/grouped-digits';
import { errorCode, errorLabel } from '../../src/lib/errors';
import { dateFormat } from '../../src/lib/format';
import { keyFromLabel } from '../../src/lib/keys';
import { slugOf } from '../../convex/_lib/text';

const LABELS = {
  unknown_stage: 'Stade inconnu.',
  unknown_stage_tag: 'Étiquette introuvable sur ce stade.',
  deal_not_found: 'Transaction introuvable.',
};

describe('the helpers the screens share', () => {
  test('an error gives the sentence of the code it carries, the longest code first, else the fallback', () => {
    expect(errorLabel(new Error('Uncaught Error: deal_not_found at …'), LABELS, 'Échec.')).toBe(
      'Transaction introuvable.',
    );
    // A code that is part of another one does not hide it.
    expect(errorCode(new Error('unknown_stage_tag'), LABELS)).toBe('unknown_stage_tag');
    expect(errorCode(new Error('unknown_stage'), LABELS)).toBe('unknown_stage');
    expect(errorLabel(new Error('something else'), LABELS, 'Échec.')).toBe('Échec.');
    expect(errorLabel('deal_not_found', LABELS, 'Échec.')).toBe('Transaction introuvable.');
    expect(errorLabel(undefined, LABELS, 'Échec.')).toBe('Échec.');
  });

  test('digits are grouped as the number is written, and the caret follows', () => {
    const RPPS = [1, 4, 7];
    const SIRET = [3, 6, 9];
    expect(formatGrouped('10001234567', RPPS)).toBe('1 000 123 4567');
    expect(formatGrouped('12345678900012', SIRET)).toBe('123 456 789 00012');
    // No space is left hanging after the last digit typed.
    expect(formatGrouped('1', RPPS)).toBe('1');
    expect(formatGrouped('123', SIRET)).toBe('123');
    expect(digitIndexToFormattedIndex(5, RPPS)).toBe(7);
    expect(digitIndexToFormattedIndex(11, RPPS)).toBe(14);
    expect(countDigitsBefore('1 000 123', 7)).toBe(5);
  });

  test('the shared date format writes a day as the screens that spelled it out did', () => {
    const spelled = new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    for (let day = Date.UTC(2024, 0, 1); day < Date.UTC(2028, 0, 1); day += 5 * 86_400_000) {
      expect(dateFormat.format(day)).toBe(spelled.format(day));
    }
  });

  test('a label gives its ASCII words, without accents, joined as asked', () => {
    expect(slugOf('  Équipe — Nord ')).toBe('equipe-nord');
    expect(slugOf('Prénom', '_')).toBe('prenom');
    expect(slugOf("L'été d’Élodie n°2", ' ')).toBe('l ete d elodie n 2');
    expect(slugOf('« … »')).toBe('');
  });

  test('a new key is at most 24 characters, numbered until free, the fallback when the label gives none', () => {
    expect(keyFromLabel('Négociation', new Set(), 'stade')).toBe('negociation');
    expect(keyFromLabel('Négociation', new Set(['negociation', 'negociation_2']), 'stade')).toBe(
      'negociation_3',
    );
    expect(keyFromLabel('Une étape au nom vraiment très long', new Set(), 'etape')).toBe(
      'une_etape_au_nom_vraimen',
    );
    expect(keyFromLabel('…', new Set(['etape']), 'etape')).toBe('etape_2');
  });
});
