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
  type AddressValue,
} from '@crm/design-system';
import { DEFAULT_COUNTRY, addressFormatFor } from '@crm/lib/backend';
import { formatAddress } from '../addresses';
import { COUNTRIES } from '../countries';
import { resolveAddressProvider } from './addressProviders';

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
        formatOneLine={formatAddress}
        renderFields={(props) => (
          <MetadataAddressFields {...props} country={effective} idPrefix={idPrefix} />
        )}
      />
    </div>
  );
}
