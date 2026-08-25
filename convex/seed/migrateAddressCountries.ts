import { v } from 'convex/values';
// Trigger-wrapped constructor: the patched leads/companies keep their
// aggregates and searchText in sync.
import { internalMutation } from '../_lib/functions';

/**
 * Display names the pre-refactor address forms wrote into `address.country`
 * (the form defaulted to "France"; autocomplete providers wrote the Google
 * long name), mapped to ISO-3166-1 alpha-2 for backfillAddressCountries.
 * Lower-cased, accent-free keys. Anything else is left untouched and counted.
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  france: 'FR',
  belgique: 'BE',
  belgium: 'BE',
  suisse: 'CH',
  switzerland: 'CH',
  luxembourg: 'LU',
  allemagne: 'DE',
  germany: 'DE',
  deutschland: 'DE',
  espagne: 'ES',
  spain: 'ES',
  espana: 'ES',
  italie: 'IT',
  italy: 'IT',
  italia: 'IT',
  'royaume-uni': 'GB',
  'united kingdom': 'GB',
  'pays-bas': 'NL',
  netherlands: 'NL',
  nederland: 'NL',
  portugal: 'PT',
  'etats-unis': 'US',
  'united states': 'US',
  usa: 'US',
  canada: 'CA',
  maroc: 'MA',
  morocco: 'MA',
  algerie: 'DZ',
  algeria: 'DZ',
  tunisie: 'TN',
  tunisia: 'TN',
  monaco: 'MC',
  andorre: 'AD',
  andorra: 'AD',
  irlande: 'IE',
  ireland: 'IE',
  autriche: 'AT',
  austria: 'AT',
  pologne: 'PL',
  poland: 'PL',
  suede: 'SE',
  sweden: 'SE',
  danemark: 'DK',
  denmark: 'DK',
  norvege: 'NO',
  norway: 'NO',
  finlande: 'FI',
  finland: 'FI',
  grece: 'GR',
  greece: 'GR',
  'republique tcheque': 'CZ',
  tchequie: 'CZ',
  czechia: 'CZ',
  roumanie: 'RO',
  romania: 'RO',
  hongrie: 'HU',
  hungary: 'HU',
  senegal: 'SN',
  "cote d'ivoire": 'CI',
  cameroun: 'CM',
  madagascar: 'MG',
  liban: 'LB',
  lebanon: 'LB',
  israel: 'IL',
  turquie: 'TR',
  turkey: 'TR',
  japon: 'JP',
  japan: 'JP',
  chine: 'CN',
  china: 'CN',
  inde: 'IN',
  india: 'IN',
  australie: 'AU',
  australia: 'AU',
  bresil: 'BR',
  brazil: 'BR',
  mexique: 'MX',
  mexico: 'MX',
};

function countryNameToCode(raw: string): string | null {
  const key = raw.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return COUNTRY_NAME_TO_CODE[key] ?? null;
}

const ADDRESS_TABLES = ['leads', 'companies', 'users'] as const;

export const backfillAddressCountries = internalMutation({
  args: {
    table: v.union(v.literal('leads'), v.literal('companies'), v.literal('users')),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const table = ADDRESS_TABLES.find((t) => t === args.table) ?? 'leads';
    const page = await ctx.db.query(table).paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let patched = 0;
    let unmapped = 0;
    for (const doc of page.page) {
      const address = doc.address;
      if (!address) continue;
      const code =
        (address.countryCode && /^[A-Za-z]{2}$/.test(address.countryCode)
          ? address.countryCode.toUpperCase()
          : null) ?? countryNameToCode(address.country);
      if (!code) {
        unmapped++;
        continue;
      }
      if (code === address.country && address.countryCode === undefined) continue;
      const { countryCode: _dropped, ...rest } = address;
      await ctx.db.patch(doc._id, { address: { ...rest, country: code } });
      patched++;
    }
    return {
      seen: page.page.length,
      patched,
      unmapped,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
