import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dropzone } from '../../src/design-system/components/inputs/dropzone';
import {
  acceptLabel,
  checkFiles,
  constraintsLabel,
  describeFileRefusal,
  formatFileSize,
} from '../../src/design-system/components/inputs/dropzone-rules';

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type });

describe('the rules a drop zone applies', () => {
  test('the accepted formats read as a sentence, one name per format, however it was named', () => {
    expect(acceptLabel(['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'])).toBe(
      'PNG, SVG, JPEG ou WebP',
    );
    expect(acceptLabel(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'])).toBe(
      'PNG ou ICO',
    );
    expect(acceptLabel(['.csv', '.xlsx'])).toBe('CSV ou XLSX');
    expect(acceptLabel(['image/*'])).toBe('images');
    expect(acceptLabel(['application/x-unknown'])).toBe('X-UNKNOWN');
  });

  test('the constraints line says what is checked, and nothing when nothing is', () => {
    expect(constraintsLabel({ accept: ['.html'], maxBytes: 800 * 1024 })).toBe('HTML · 800 Ko max');
    expect(constraintsLabel({ maxBytes: 10 * 1024 * 1024, multiple: true })).toBe(
      '10 Mo max par fichier',
    );
    expect(constraintsLabel({ accept: [] })).toBeNull();
    expect(formatFileSize(1536 * 1024)).toBe('1,5 Mo');
    expect(formatFileSize(1024 * 1024)).toBe('1 Mo');
    expect(formatFileSize(512)).toBe('512 o');
  });

  test('a file matches by MIME type, by family or by extension, case aside; a browser that reports no type still passes by extension', () => {
    const rules = { accept: ['image/png', 'text/*', '.xlsx'] };
    const ok = [
      file('a.png', 'image/png'),
      file('b.csv', 'text/csv'),
      file('C.XLSX', ''),
      file('d.xlsx', 'application/vnd.ms-excel'),
    ];
    expect(checkFiles(ok, { ...rules, multiple: true }).accepted).toEqual(ok);
    const pdf = file('e.pdf', 'application/pdf');
    expect(checkFiles([pdf], rules)).toEqual({
      accepted: [],
      refusals: [{ file: pdf, reason: 'type' }],
    });
  });

  test('a file over the ceiling is refused for its size, the others go through; a single zone refuses a drop of several', () => {
    const big = file('big.png', 'image/png', 2048);
    const small = file('small.png', 'image/png', 100);
    const rules = { accept: ['image/png'], maxBytes: 1024, multiple: true };
    expect(checkFiles([big, small], rules)).toEqual({
      accepted: [small],
      refusals: [{ file: big, reason: 'size' }],
    });
    expect(checkFiles([small, small], { ...rules, multiple: false })).toEqual({
      accepted: [],
      refusals: [{ file: null, reason: 'count' }],
    });
    expect(checkFiles([], rules)).toEqual({ accepted: [], refusals: [] });
  });

  test('a refusal names the file, the reason and the rule it broke', () => {
    const rules = { accept: ['image/png', 'image/svg+xml'], maxBytes: 1024 * 1024 };
    expect(
      describeFileRefusal({ file: file('photo.jpg', 'image/jpeg'), reason: 'type' }, rules),
    ).toBe('« photo.jpg » : format non pris en charge (PNG ou SVG).');
    expect(
      describeFileRefusal(
        { file: file('big.png', 'image/png', 3 * 1024 * 1024), reason: 'size' },
        rules,
      ),
    ).toBe('« big.png » : fichier trop volumineux (3 Mo, maximum 1 Mo).');
    expect(describeFileRefusal({ file: null, reason: 'count' }, rules)).toBe(
      'Déposez un seul fichier.',
    );
    expect(describeFileRefusal({ file: file('x.bin', ''), reason: 'type' }, {})).toBe(
      '« x.bin » : format non pris en charge.',
    );
  });
});

describe('the drop zone, state by state', () => {
  const render = (props: Partial<Parameters<typeof Dropzone>[0]>) =>
    renderToStaticMarkup(<Dropzone id="zone" onFiles={() => undefined} {...props} />);

  test('empty: the instruction, the constraints and the recommendation, and a button the label points at', () => {
    const html = render({
      accept: ['image/png', 'image/svg+xml'],
      maxBytes: 1024 * 1024,
      hint: 'Fond transparent recommandé.',
    });
    expect(html).toContain('data-state="empty"');
    expect(html).toContain('Glissez votre fichier ici ou choisissez un fichier');
    expect(html).toContain('id="zone-help"');
    expect(html).toContain('PNG ou SVG · 1 Mo max · Fond transparent recommandé.');
    expect(html).toContain('id="zone"');
    expect(html).toContain('aria-describedby="zone-help"');
    expect(html).toContain('>Choisir un fichier</button>');
    expect(html).toContain('accept="image/png,image/svg+xml"');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('role="alert"');
  });

  test('several files: the words are plural and the input takes several', () => {
    const html = render({ multiple: true, maxBytes: 10 * 1024 * 1024 });
    expect(html).toContain('Glissez vos fichiers ici ou choisissez des fichiers');
    expect(html).toContain('>Choisir des fichiers</button>');
    expect(html).toContain('multiple=""');
    expect(html).toContain('10 Mo max par fichier');
  });

  test('filled with an image: the preview in a frame of its shape, « Remplacer », no instruction', () => {
    const html = render({ preview: <img src="x.png" alt="" />, previewShape: 'wide' });
    expect(html).toContain('data-state="filled"');
    expect(html).toContain('h-16 w-28');
    expect(html).toContain('<img src="x.png" alt=""/>');
    expect(html).toContain('>Remplacer</button>');
    expect(html).not.toContain('Glissez votre fichier');
  });

  test('busy: a status says so, the preview stays, the button keeps its place and its focus but takes nothing, nor does the input', () => {
    const html = render({
      busy: true,
      busyLabel: 'Envoi… 2/3',
      preview: <img src="x.png" alt="" />,
    });
    expect(html).toContain('data-state="busy"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Envoi… 2/3');
    expect(html).toContain('<img src="x.png" alt=""/>');
    // Said disabled, not set so: a disabled button would drop the focus to the page.
    expect(html).toMatch(/<button[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain('cursor-not-allowed');
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(html).not.toContain('Glissez votre fichier');
  });

  test('error: said once, next to the field, announced, and the button names it', () => {
    const html = render({ error: 'L’envoi du fichier a échoué.' });
    expect(html).toContain('data-state="error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="zone-error"');
    expect(html).toContain('aria-describedby="zone-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('border-destructive');
  });

  test('disabled: said to assistive technology, nothing clickable', () => {
    const html = render({ disabled: true });
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('cursor-not-allowed');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  test('with its own content: the list replaces the empty state, the status joins it while busy', () => {
    const html = render({
      multiple: true,
      busy: true,
      busyLabel: 'Envoi… 1/2',
      children: <ul data-testid="list" />,
    });
    expect(html).toContain('data-testid="list"');
    expect(html).toContain('Envoi… 1/2');
    expect(html).not.toContain('Glissez vos fichiers');
    expect(html).not.toContain('<button');
  });
});
