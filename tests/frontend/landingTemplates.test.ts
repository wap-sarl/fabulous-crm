import { describe, expect, test } from 'bun:test';
import type { Id } from '../../convex/_generated/dataModel';
import {
  validateLandingPageShape,
  validatePublishable,
} from '../../convex/_lib/validators/landingPages';
import {
  emptySection,
  LANDING_TEMPLATES,
  SECTION_LABEL,
} from '../../src/features/landingPages/lib/templates';

const formId = 'forms:1' as Id<'forms'>;

describe('the page templates', () => {
  test('each one makes a page the backend accepts, with a form or without, with blocks that have their own ids', () => {
    for (const template of LANDING_TEMPLATES) {
      for (const chosen of [formId, undefined]) {
        const sections = template.sections(chosen);
        const page = {
          name: template.label,
          slug: template.key,
          seo: { title: template.label },
          sections,
        };
        expect(validateLandingPageShape(page)).toBeNull();
        if (sections.length > 0) expect(validatePublishable(page)).toBeNull();
        expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
        expect(sections.some((s) => s.type === 'form')).toBe(
          chosen !== undefined && template.key !== 'blank',
        );
      }
    }
    // Two pages from one template do not share block ids.
    const [a, b] = [LANDING_TEMPLATES[0].sections(formId), LANDING_TEMPLATES[0].sections(formId)];
    expect(a.map((s) => s.id)).not.toEqual(b.map((s) => s.id));
  });

  test('a new block is of its type, and every type has a label', () => {
    for (const type of Object.keys(SECTION_LABEL) as (keyof typeof SECTION_LABEL)[]) {
      expect(emptySection(type, formId).type).toBe(type);
      expect(SECTION_LABEL[type]).toBeTruthy();
    }
  });
});
