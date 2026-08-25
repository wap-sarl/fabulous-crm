import { useMemo } from 'react';
import {
  AddressInput,
  Combobox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  createBanAddressProvider,
  createGooglePlacesProvider,
  type AddressDetailsResolver,
  type AddressSuggestionsProvider,
  type AddressValue,
} from '@crm/design-system';
import { DEFAULT_COUNTRY, addressFormatFor, formatAddressOneLine } from '@crm/lib/backend';
import { COUNTRIES, countryName } from '../countries';

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

// ---------------------------------------------------------------------------
// Fields + block
// ---------------------------------------------------------------------------

export interface AddressFieldsProps {
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  /** The country the fields are laid out for (`value.country`). */
  country: string;
  idPrefix?: string;
  disabled?: boolean;
}

/** The country's nested fields in its writing order, from the metadata. */
export function MetadataAddressFields({
  value,
  onChange,
  country,
  idPrefix,
  disabled,
}: AddressFieldsProps) {
  const format = useMemo(() => addressFormatFor(country), [country]);
  const id = (key: string) => `${idPrefix ? `${idPrefix}-` : ''}address-${key}`;
  const set = (patch: Partial<AddressValue>) =>
    onChange({ ...value, ...patch, placeId: undefined });

  return (
    <div className="grid gap-3">
      {format.fields.map((field) => {
        switch (field.key) {
          case 'street':
            return (
              <div key={field.key} className="grid gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="grid gap-1.5 sm:col-span-1">
                    <Label htmlFor={id('streetNumber')}>N°</Label>
                    <Input
                      id={id('streetNumber')}
                      value={value.streetNumber}
                      onChange={(e) => set({ streetNumber: e.target.value })}
                      disabled={disabled}
                      autoComplete="off"
                    />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-3">
                    <Label htmlFor={id('street')} required={field.required}>
                      {field.label}
                    </Label>
                    <Input
                      id={id('street')}
                      value={value.street}
                      onChange={(e) => set({ street: e.target.value })}
                      disabled={disabled}
                      autoComplete="off"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={id('line2')}>Complément d’adresse</Label>
                  <Input
                    id={id('line2')}
                    value={value.line2 ?? ''}
                    onChange={(e) => set({ line2: e.target.value || undefined })}
                    disabled={disabled}
                    autoComplete="off"
                    placeholder="Bâtiment, étage, boîte postale…"
                  />
                </div>
              </div>
            );
          case 'region':
            return (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={id('region')} required={field.required}>
                  {field.label}
                </Label>
                {field.options ? (
                  <Select
                    value={value.region ?? ''}
                    onValueChange={(v) => set({ region: v || undefined })}
                    disabled={disabled}
                  >
                    <SelectTrigger id={id('region')} className="w-full">
                      <SelectValue placeholder="Choisir…" />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={id('region')}
                    value={value.region ?? ''}
                    onChange={(e) => set({ region: e.target.value || undefined })}
                    disabled={disabled}
                    autoComplete="off"
                  />
                )}
              </div>
            );
          default:
            return (
              <div key={field.key} className="grid gap-1.5">
                <Label htmlFor={id(field.key)} required={field.required}>
                  {field.label}
                </Label>
                <Input
                  id={id(field.key)}
                  value={value[field.key]}
                  onChange={(e) => set({ [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  disabled={disabled}
                  autoComplete="off"
                />
              </div>
            );
        }
      })}
    </div>
  );
}

export interface CountryAddressInputProps {
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  /**
   * Country controlled by the parent (a company's legal country): the
   * selector is hidden and the address follows it. Unset = the block shows
   * its own country selector (a lead's address).
   */
  country?: string;
  idPrefix?: string;
  disabled?: boolean;
  /** Section label above the fields; empty hides it. */
  label?: string;
}

const oneLine = (v: AddressValue) => formatAddressOneLine(v, countryName);

/**
 * Country selector (own or parent-controlled) + search box with the
 * country's provider + the country's nested fields. Changing the country
 * resets the region (its keys are country-specific) and any place id.
 */
export function CountryAddressInput({
  value,
  onChange,
  country,
  idPrefix,
  disabled,
  label = 'Adresse',
}: CountryAddressInputProps) {
  const effective = (country ?? value.country ?? DEFAULT_COUNTRY).toUpperCase();
  const syncedValue = value.country === effective ? value : { ...value, country: effective };
  const items = useMemo(() => COUNTRIES.map((c) => ({ value: c.code, label: c.name })), []);
  const provider = useMemo(() => resolveAddressProvider(effective), [effective]);

  return (
    <div className="grid gap-3">
      {label ? <Label>{label}</Label> : null}
      {country === undefined ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix ?? 'addr'}-country`}>Pays</Label>
          <Combobox
            items={items}
            value={effective}
            onValueChange={(code) =>
              onChange({ ...value, country: code, region: undefined, placeId: undefined })
            }
            placeholder="Pays"
            searchPlaceholder="Rechercher un pays…"
            disabled={disabled}
            modal
            className="w-full"
          />
        </div>
      ) : null}
      <AddressInput
        // Remount on country change: the search state (query, suggestions,
        // manual toggle) belongs to one country's provider.
        key={effective}
        idPrefix={idPrefix}
        value={syncedValue}
        onChange={onChange}
        fetchSuggestions={provider?.fetchSuggestions}
        resolveDetails={provider?.resolveDetails}
        showCountry={false}
        disabled={disabled}
        searchLabel="Rechercher une adresse"
        searchPlaceholder="Commencez à saisir l’adresse…"
        formatOneLine={oneLine}
        renderFields={(props) => (
          <MetadataAddressFields {...props} country={effective} idPrefix={idPrefix} />
        )}
      />
    </div>
  );
}
