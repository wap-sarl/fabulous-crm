/** `street` holds the raw text while typing; the other fields are filled from the selected suggestion and stay individually editable. */
export interface AddressValue {
  streetNumber: string;
  street: string;
  /** Second street line (building, floor…). */
  line2?: string;
  postalCode: string;
  city: string;
  /** Administrative area (state, province, prefecture…) — metadata key or free text. */
  region?: string;
  /** ISO-3166-1 alpha-2, e.g. "FR" — drives the country-specific layout. */
  country: string;
  /** Provider place id when chosen from autocomplete; cleared on manual edit. */
  placeId?: string;
  coordinates?: { lat: number; lng: number };
}

export interface AddressSuggestion {
  /** Stable key — the provider place id. */
  id: string;
  placeId: string;
  /** Primary line, e.g. "8 Boulevard du Port". */
  label: string;
  /** Full predicted text, e.g. "8 Boulevard du Port, 80000 Amiens, France". */
  description: string;
}

export type AddressSuggestionsProvider = (
  query: string,
  signal: AbortSignal,
) => Promise<AddressSuggestion[]>;

export type AddressDetailsResolver = (
  suggestion: AddressSuggestion,
  signal: AbortSignal,
) => Promise<Partial<AddressValue>>;

export interface GooglePlacesProviderOptions {
  apiKey: string;
  /** BCP-47 language for results. Defaults to 'fr'. */
  languageCode?: string;
  /** Region code that BIASES (not restricts) results. Defaults to 'FR'. */
  regionCode?: string;
}

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';

interface GooglePlacePrediction {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
}

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

/** The key travels from the browser, so it must be restricted by HTTP referrer; one token covers the autocomplete and details calls of a selection, which Google bills as one session. */
export function createGooglePlacesProvider({
  apiKey,
  languageCode = 'fr',
  regionCode = 'FR',
}: GooglePlacesProviderOptions): {
  fetchSuggestions: AddressSuggestionsProvider;
  resolveDetails: AddressDetailsResolver;
} {
  let sessionToken: string | null = null;
  const ensureSession = () => {
    if (!sessionToken) sessionToken = crypto.randomUUID();
    return sessionToken;
  };

  const fetchSuggestions: AddressSuggestionsProvider = async (query, signal) => {
    const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        input: query,
        languageCode,
        regionCode,
        sessionToken: ensureSession(),
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: GooglePlacePrediction[] };
    return (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<GooglePlacePrediction['placePrediction']> => !!p?.placeId)
      .map((p) => {
        const main = p.structuredFormat?.mainText?.text;
        const full = p.text?.text;
        return {
          id: p.placeId as string,
          placeId: p.placeId as string,
          label: main ?? full ?? '',
          description: full ?? main ?? '',
        };
      });
  };

  const resolveDetails: AddressDetailsResolver = async (suggestion, signal) => {
    const token = sessionToken;
    sessionToken = null; // the session ends with the details call
    const params = new URLSearchParams({ languageCode });
    if (token) params.set('sessionToken', token);
    const res = await fetch(
      `${PLACES_DETAILS_URL}/${encodeURIComponent(suggestion.placeId)}?${params.toString()}`,
      {
        signal,
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,addressComponents,location,formattedAddress',
        },
      },
    );
    if (!res.ok) return {};
    const data = (await res.json()) as {
      addressComponents?: GoogleAddressComponent[];
      location?: { latitude?: number; longitude?: number };
    };
    const comps = data.addressComponents ?? [];
    const pick = (type: string) => comps.find((c) => c.types?.includes(type));
    const countryComp = pick('country');
    const patch: Partial<AddressValue> = {
      placeId: suggestion.placeId,
      streetNumber: pick('street_number')?.longText ?? '',
      street: pick('route')?.longText ?? '',
      postalCode: pick('postal_code')?.longText ?? '',
      city:
        pick('locality')?.longText ??
        pick('postal_town')?.longText ??
        pick('administrative_area_level_2')?.longText ??
        '',
      country: countryComp?.shortText ?? '',
      region: pick('administrative_area_level_1')?.shortText ?? undefined,
    };
    const { latitude, longitude } = data.location ?? {};
    if (latitude != null && longitude != null) {
      patch.coordinates = { lat: latitude, lng: longitude };
    }
    return patch;
  };

  return { fetchSuggestions, resolveDetails };
}

export interface BanAddressProviderOptions {
  /** Max suggestions per query. Defaults to 5. */
  limit?: number;
}

const BAN_SEARCH_URL = 'https://api-adresse.data.gouv.fr/search/';

interface BanFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    id?: string;
    label?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
  };
}

/** The Base Adresse Nationale is free, keyless and France-only; a search returns structured results, so they are cached by BAN id and the details cost no second call. */
export function createBanAddressProvider({ limit = 5 }: BanAddressProviderOptions = {}): {
  fetchSuggestions: AddressSuggestionsProvider;
  resolveDetails: AddressDetailsResolver;
} {
  const cache = new Map<string, AddressValue>();

  const fetchSuggestions: AddressSuggestionsProvider = async (query, signal) => {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      autocomplete: '1',
    });
    const res = await fetch(`${BAN_SEARCH_URL}?${params.toString()}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: BanFeature[] };
    return (data.features ?? [])
      .filter((f): f is BanFeature & { properties: { id: string } } => !!f.properties?.id)
      .map((f) => {
        const p = f.properties;
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const value: AddressValue = {
          streetNumber: p.housenumber ?? '',
          street: p.street ?? p.name ?? '',
          postalCode: p.postcode ?? '',
          city: p.city ?? '',
          country: 'FR',
          placeId: p.id,
          coordinates: lat != null && lng != null ? { lat, lng } : undefined,
        };
        cache.set(p.id, value);
        return {
          id: p.id,
          placeId: p.id,
          label: p.name ?? p.label ?? '',
          description: p.label ?? p.name ?? '',
        };
      });
  };

  const resolveDetails: AddressDetailsResolver = async (suggestion) =>
    cache.get(suggestion.placeId) ?? {};

  return { fetchSuggestions, resolveDetails };
}
