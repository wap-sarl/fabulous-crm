import { describe, expect, test } from 'bun:test';
import {
  formatPropertyParamValue,
  OPTION_BASED_TYPES,
  propertyTypeValidator,
  validatePropertyValue,
} from '../../convex/_lib/validators/properties';
import { PROPERTY_TYPE_KEYS, PROPERTY_TYPES } from '../../convex/_lib/validators/propertyTypes';

/**
 * The type registry is the single definition of a custom-property type: the
 * validator union, the option-based list and every check derive from it.
 */
describe('property type registry', () => {
  test('the validator union and the option-based list derive from the registry keys', () => {
    expect(Object.keys(PROPERTY_TYPES).sort()).toEqual([...PROPERTY_TYPE_KEYS].sort());
    const members = (propertyTypeValidator as unknown as { members: { value: string }[] }).members;
    expect(members.map((m) => m.value).sort()).toEqual([...PROPERTY_TYPE_KEYS].sort());
    expect(OPTION_BASED_TYPES.sort()).toEqual(
      PROPERTY_TYPE_KEYS.filter((k) => PROPERTY_TYPES[k].optionBased).sort(),
    );
    for (const key of PROPERTY_TYPE_KEYS) {
      const d = PROPERTY_TYPES[key];
      expect(typeof d.sanitize).toBe('function');
      expect(typeof d.validate).toBe('function');
      expect(typeof d.formatParam).toBe('function');
      expect(Array.isArray(d.rules)).toBe(true);
    }
  });

  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  test.each([
    ['text', 'hello', 'hello'],
    ['text', 42, undefined],
    ['text', '', undefined],
    ['number', 3.5, 3.5],
    ['number', '3', undefined],
    ['number', Number.NaN, undefined],
    ['email', 'a@b.co', 'a@b.co'],
    ['select', 'a', 'a'],
    ['select', 'zz', undefined],
    ['radio', 'b', 'b'],
    ['checkbox', ['a', 'zz', 'b'], ['a', 'b']],
    ['checkbox', ['zz'], undefined],
    ['checkbox', 'a', undefined],
    ['date', '2026-01-31', '2026-01-31'],
    ['boolean', false, false],
    ['boolean', 'true', undefined],
    ['rpps', '10001234567', '10001234567'],
  ] as const)('sanitize %s %p → %p', (type, input, expected) => {
    expect(PROPERTY_TYPES[type].sanitize(input, { options })).toEqual(expected);
  });

  test.each([
    ['email', 'nope', 'Adresse e-mail invalide.'],
    ['email', 'a@b.co', null],
    ['number', 5, { min: 10 }, 'La valeur doit être supérieure ou égale à 10.'],
    ['number', 50, { max: 10 }, 'La valeur doit être inférieure ou égale à 10.'],
    ['number', 5, { min: 1, max: 10 }, null],
    ['text', 'ab', { minLength: 3 }, 'Au moins 3 caractère(s) requis.'],
    ['text', 'abcd', { maxLength: 3 }, 'Au plus 3 caractère(s) autorisé(s).'],
    ['text', 'abc', { pattern: '^\\d+$' }, 'Format invalide.'],
    ['text', '123', { pattern: '^\\d+$' }, null],
    ['text', 'abc', { pattern: '(' }, null],
    ['rpps', '123', 'Numéro RPPS invalide (11 chiffres, commence par 1).'],
    ['rpps', '1 000 123 4567', null],
    ['select', 'a', null],
  ] as const)('validate %s %p', (type, value, ...rest) => {
    const rules = typeof rest[0] === 'object' && rest[0] !== null ? rest[0] : {};
    const expected = rest[rest.length - 1];
    expect(validatePropertyValue({ type, validation: rules }, value)).toBe(
      expected as string | null,
    );
  });

  test('empty values are always valid and render as empty params', () => {
    for (const type of PROPERTY_TYPE_KEYS) {
      expect(validatePropertyValue({ type }, undefined)).toBeNull();
      expect(validatePropertyValue({ type }, '')).toBeNull();
      expect(formatPropertyParamValue({ type, options }, undefined)).toBe('');
    }
  });

  test.each([
    ['boolean', true, 'oui'],
    ['boolean', false, 'non'],
    ['select', 'a', 'Alpha'],
    ['radio', 'zz', 'zz'],
    ['checkbox', ['a', 'b'], 'Alpha, Beta'],
    ['date', '2026-01-31', '31/01/2026'],
    ['number', 12, '12'],
    ['text', 'hi', 'hi'],
  ] as const)('formatParam %s %p → %p', (type, value, expected) => {
    expect(formatPropertyParamValue({ type, options }, value)).toBe(expected);
  });
});
