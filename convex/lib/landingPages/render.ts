import type { Doc } from '../../_generated/dataModel';
import type { LandingSection, LandingVariant } from '../../_lib/validators/landingPages';

const esc = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const STYLE = `
:root{color-scheme:light}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;background:#fff;line-height:1.55}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
section{margin:0 0 40px}
h1{font-size:2.2rem;line-height:1.15;margin:0 0 12px}
h2{font-size:1.5rem;line-height:1.25;margin:0 0 10px}
p{margin:0 0 12px}
.hero{text-align:center;padding:24px 0 8px}
.hero img{max-width:100%;height:auto;border-radius:12px;margin:20px 0 0}
.lede{font-size:1.15rem;color:#475569}
.button{display:inline-block;margin-top:12px;padding:12px 22px;font-weight:600;color:#fff;background:#0f766e;border-radius:8px;text-decoration:none}
.button:hover{background:#115e59}
figure{margin:0}
figure img{max-width:100%;height:auto;border-radius:12px}
figcaption{font-size:.9rem;color:#64748b;margin-top:6px}
.text img{max-width:100%;height:auto}
.cta{text-align:center;padding:28px 20px;background:#f1f5f9;border-radius:14px}
.form{padding:24px 20px;border:1px solid #e2e8f0;border-radius:14px}
`;

export interface RenderOptions {
  /** The deployment's origin, where the form embed and the tracking script are served from. */
  base: string;
  /** The forms that can be shown: an inactive or deleted one leaves its block out. */
  liveFormIds: Set<string>;
  /** Whether the deployment tracks its pages: the script asks the visitor first. */
  tracking: boolean;
  /** The editor's preview: the form is drawn, not run, so nothing is submitted from there. */
  preview?: boolean;
  /** The variant shown: B's blocks when the page is under test and the visitor falls in B's share. */
  variant?: LandingVariant;
}

/** The blocks a variant shows. */
export function sectionsOf(page: Doc<'landingPages'>, variant: LandingVariant = 'a') {
  return variant === 'b' && page.abTest ? page.abTest.sections : page.sections;
}

/** What the page may load: scripts and calls from the deployment only, images from anywhere over https, styles inline (the scripts style what they add). Named by origin rather than 'self', so that it holds in the editor's frame too. */
export function pagePolicy(base: string): string {
  return `default-src 'none'; script-src ${base}; connect-src ${base}; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
}

function renderSection(section: LandingSection, page: Doc<'landingPages'>, opts: RenderOptions) {
  switch (section.type) {
    case 'hero':
      return `<section class="hero">${
        section.imageUrl ? `<img src="${esc(section.imageUrl)}" alt="">` : ''
      }<h1>${esc(section.heading)}</h1>${
        section.text ? `<p class="lede">${esc(section.text)}</p>` : ''
      }${
        section.ctaLabel && section.ctaHref
          ? `<a class="button" href="${esc(section.ctaHref)}">${esc(section.ctaLabel)}</a>`
          : ''
      }</section>`;
    case 'text':
      // The editor's HTML, as a campaign's body is: written by an employee, shown as written.
      return `<section class="text">${section.html}</section>`;
    case 'image':
      return `<section><figure><img src="${esc(section.url)}" alt="${esc(section.alt)}">${
        section.caption ? `<figcaption>${esc(section.caption)}</figcaption>` : ''
      }</figure></section>`;
    case 'cta':
      return `<section class="cta"><h2>${esc(section.heading)}</h2>${
        section.text ? `<p>${esc(section.text)}</p>` : ''
      }<a class="button" href="${esc(section.href)}">${esc(section.label)}</a></section>`;
    case 'form':
      if (!opts.liveFormIds.has(section.formId)) return '';
      if (opts.preview) {
        return `<section class="form" id="form">${
          section.heading ? `<h2>${esc(section.heading)}</h2>` : ''
        }<p class="lede">Le formulaire s’affiche ici sur la page publiée.</p></section>`;
      }
      // The embed posts the page's id with a submission, so the page counts its conversions; the variant is drawn again server-side, from the same address and browser.
      return `<section class="form" id="form">${
        section.heading ? `<h2>${esc(section.heading)}</h2>` : ''
      }<script src="${esc(opts.base)}/forms/${esc(section.formId)}/embed.js" data-page="${esc(page._id)}"></script></section>`;
  }
}

/** The whole document of a page, every text escaped but the editor's HTML; no inline script, so it holds under its own policy. */
export function renderLandingPage(page: Doc<'landingPages'>, opts: RenderOptions): string {
  const { seo } = page;
  const url = `${opts.base}/p/${page.slug}`;
  const head = [
    '<meta charset="utf-8">',
    // In the document as well as in the route's header: the editor's preview frame gets no header, and must behave as the page does.
    `<meta http-equiv="Content-Security-Policy" content="${esc(pagePolicy(opts.base))}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(seo.title)}</title>`,
    seo.description ? `<meta name="description" content="${esc(seo.description)}">` : '',
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:title" content="${esc(seo.title)}">`,
    seo.description ? `<meta property="og:description" content="${esc(seo.description)}">` : '',
    `<meta property="og:url" content="${esc(url)}">`,
    seo.imageUrl ? `<meta property="og:image" content="${esc(seo.imageUrl)}">` : '',
    `<style>${STYLE}</style>`,
    opts.tracking ? `<script src="${esc(opts.base)}/track.js" defer></script>` : '',
  ]
    .filter(Boolean)
    .join('');
  const body = sectionsOf(page, opts.variant)
    .map((section) => renderSection(section, page, opts))
    .join('');
  return `<!doctype html><html lang="fr"><head>${head}</head><body><main>${body}</main></body></html>`;
}

/** What a visitor sees at an address that has no published page. */
export const NOT_FOUND_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Page introuvable</title><style>${STYLE}</style></head><body><main><section class="hero"><h1>Page introuvable</h1><p class="lede">Cette page n’existe pas ou n’est plus publiée.</p></section></main></body></html>`;
