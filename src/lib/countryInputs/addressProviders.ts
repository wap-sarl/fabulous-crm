import {
  createBanAddressProvider,
  createGooglePlacesProvider,
  type AddressDetailsResolver,
  type AddressSuggestionsProvider,
  type AddressValue,
} from '@crm/design-system';
import { addressFormatFor } from '@crm/lib/backend';

/**
 * Address suggestion providers, one per country (`*` = fallback), behind the
 * search box of `CountryAddressInput` (address.tsx):
 *   - FR → BAN, the French government's address API (keyless).
 *   - `*` → Photon (komoot, OpenStreetMap; keyless, worldwide), filtered to
 *     the selected country; or Google Places when `VITE_GOOGLE_MAPS_API_KEY`
 *     is configured (biased to the country).
 * Add or replace one with `registerAddressProvider('DE', factory)`.
 */

export interface AddressProvider {
  fetchSuggestions: AddressSuggestionsProvider;
  resolveDetails: AddressDetailsResolver;
}

/** Builds the provider for a country (called once per country, memoized). */
export type AddressProviderFactory = (country: string) => AddressProvider;

export const ANY_COUNTRY = '*';
const factories = new Map<string, AddressProviderFactory>();
const instances = new Map<string, AddressProvider>();

export function registerAddressProvider(country: string, factory: AddressProviderFactory): void {
  factories.set(country.toUpperCase(), factory);
  for (const key of [...instances.keys()]) {
    if (country === ANY_COUNTRY || key === country.toUpperCase()) instances.delete(key);
  }
}

/** The provider registered for `country` (exact, then `*`), or null when none. */
export function resolveAddressProvider(country: string): AddressProvider | null {
  const code = country.toUpperCase();
  const cached = instances.get(code);
  if (cached) return cached;
  const factory = factories.get(code) ?? factories.get(ANY_COUNTRY);
  if (!factory) return null;
  const provider = factory(code);
  instances.set(code, provider);
  return provider;
}

// ---------------------------------------------------------------------------
// Photon (komoot) — OpenStreetMap geocoder with an autocomplete-friendly API.
// Fair-use policy: fine for a CRM's address forms, throttled when abused.
// ---------------------------------------------------------------------------

const PHOTON_URL = 'https://photon.komoot.io/api/';

interface PhotonFeature {
  properties?: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    countrycode?: string;
    type?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

/** Map an OSM state name onto the country's metadata region key, else keep the name. */
function regionKeyFor(country: string, state: string | undefined): string | undefined {
  if (!state) return undefined;
  const regions = addressFormatFor(country).fields.find((f) => f.key === 'region')?.options;
  if (!regions) return state;
  const needle = state.trim().toLowerCase();
  const hit = regions.find(
    ([key, name]) => key.toLowerCase() === needle || name.toLowerCase() === needle,
  );
  return hit ? hit[0] : state;
}

export function createPhotonAddressProvider(country: string): AddressProvider {
  const cache = new Map<string, AddressValue>();
  // Countries with an enumerated region list are queried in English so the
  // OSM state name matches the metadata's Latin names ("California").
  const lang = addressFormatFor(country).fields.some((f) => f.key === 'region' && f.options)
    ? 'en'
    : 'fr';

  const fetchSuggestions: AddressSuggestionsProvider = async (query, signal) => {
    const params = new URLSearchParams({ q: query, limit: '15', lang });
    const res = await fetch(`${PHOTON_URL}?${params.toString()}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: PhotonFeature[] };
    return (data.features ?? [])
      .filter((f) => (f.properties?.countrycode ?? '').toUpperCase() === country)
      .filter((f) => f.properties?.street || f.properties?.name)
      .slice(0, 6)
      .map((f) => {
        const p = f.properties ?? {};
        const id = `${p.osm_type ?? 'X'}${p.osm_id ?? Math.random()}`;
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const street = p.street ?? (p.type === 'street' ? p.name : undefined) ?? '';
        const value: AddressValue = {
          country,
          streetNumber: p.housenumber ?? '',
          street,
          postalCode: p.postcode ?? '',
          city: p.city ?? p.town ?? p.village ?? '',
          region: regionKeyFor(country, p.state),
          placeId: id,
          coordinates: lat != null && lng != null ? { lat, lng } : undefined,
        };
        cache.set(id, value);
        const label = [p.housenumber, street || p.name].filter(Boolean).join(' ');
        const description = [label, [p.postcode, value.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ');
        return { id, placeId: id, label, description };
      });
  };

  const resolveDetails: AddressDetailsResolver = async (suggestion) =>
    cache.get(suggestion.placeId) ?? {};

  return { fetchSuggestions, resolveDetails };
}

/** Google Places key from the runtime env (docker entrypoint) or the Vite build. */
function googleMapsApiKey(): string | undefined {
  const key =
    window.__ENV__?.VITE_GOOGLE_MAPS_API_KEY ??
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined);
  return key?.trim() || undefined;
}

registerAddressProvider('FR', () => createBanAddressProvider());
registerAddressProvider(ANY_COUNTRY, (country) => {
  const apiKey = googleMapsApiKey();
  return apiKey
    ? createGooglePlacesProvider({ apiKey, languageCode: 'fr', regionCode: country })
    : createPhotonAddressProvider(country);
});
