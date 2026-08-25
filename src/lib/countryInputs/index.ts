// Importing this module registers the shipped country inputs (side effect).
import './companyRegistration';
import './vat';
import './address';

export {
  ANY_COUNTRY,
  CountryInput,
  PlainCountryInput,
  registerCountryInput,
  registeredCountries,
  resolveCountryInput,
  type CountryInputElementProps,
  type CountryInputProps,
  type CountryInputRegistration,
} from './registry';
export { COMPANY_REGISTRATION_INPUT, type CompanyRegistrationContext } from './companyRegistration';
export { COMPANY_VAT_INPUT, type CompanyVatContext } from './vat';
export {
  CountryAddressInput,
  MetadataAddressFields,
  createPhotonAddressProvider,
  registerAddressProvider,
  resolveAddressProvider,
  type AddressFieldsProps,
  type AddressProvider,
  type AddressProviderFactory,
  type CountryAddressInputProps,
} from './address';
