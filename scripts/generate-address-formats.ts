import { writeFileSync } from 'node:fs';
import { getCountries } from 'libphonenumber-js';

const BASE =
  'https://www.gstatic.com/chrome/autofill/libaddressinput/chromium-i18n/ssl-address/data';
const OUT = new URL('../convex/_lib/validators/addressFormats.generated.ts', import.meta.url);

type Raw = {
  fmt?: string;
  lfmt?: string;
  require?: string;
  upper?: string;
  zip?: string;
  zipex?: string;
  state_name_type?: string;
  locality_name_type?: string;
  zip_name_type?: string;
  sub_keys?: string;
  sub_names?: string;
  sub_lnames?: string;
};

async function fetchRegion(code: string): Promise<Raw | null> {
  const res = await fetch(`${BASE}/${code}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  return (await res.json()) as Raw;
}

const codes = ['ZZ', ...getCountries()].sort();
const out: Record<string, unknown> = {};
const CONCURRENCY = 8;
for (let i = 0; i < codes.length; i += CONCURRENCY) {
  const batch = codes.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(fetchRegion));
  batch.forEach((code, j) => {
    const raw = results[j];
    if (!raw) return;
    const entry: Record<string, unknown> = {};
    if (raw.fmt) entry.fmt = raw.fmt;
    if (raw.lfmt) entry.lfmt = raw.lfmt;
    if (raw.require) entry.require = raw.require;
    if (raw.upper) entry.upper = raw.upper;
    if (raw.zip) entry.zip = raw.zip;
    if (raw.zipex) entry.zipex = raw.zipex.split(',')[0];
    if (raw.state_name_type) entry.regionType = raw.state_name_type;
    if (raw.locality_name_type) entry.cityType = raw.locality_name_type;
    if (raw.zip_name_type) entry.postalType = raw.zip_name_type;
    if (raw.sub_keys) {
      const keys = raw.sub_keys.split('~');
      // Latin names when the local script isn't Latin (JP, KR, CN…), else local.
      const names = (raw.sub_lnames ?? raw.sub_names ?? raw.sub_keys).split('~');
      entry.regions = keys.map((key, k) => [key, names[k] ?? key]);
    }
    out[code] = entry;
  });
  process.stdout.write(`${Math.min(i + CONCURRENCY, codes.length)}/${codes.length}\r`);
}

const body = `// GENERATED FILE — do not edit. Run \`bun run scripts/generate-address-formats.ts\`.
// Source: Google libaddressinput metadata (https://github.com/google/libaddressinput),
// Apache License 2.0. Field semantics: see addressFormats.ts.
import type { AddressFormatData } from './addressFormats';

export const ADDRESS_FORMAT_DATA: Record<string, AddressFormatData> = ${JSON.stringify(out, null, 1)};
`;
writeFileSync(OUT, body);
console.log(`\nwrote ${Object.keys(out).length} regions to ${OUT.pathname}`);
