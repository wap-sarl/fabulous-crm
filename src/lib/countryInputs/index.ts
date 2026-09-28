// Importing this module registers the shipped country inputs (side effect).
import './companyRegistration';
import './vat';
import './address';

export {
  CountryInput,
  resolveCountryInput,
} from './registry';
export { COMPANY_REGISTRATION_INPUT, type CompanyRegistrationContext } from './companyRegistration';
export { COMPANY_VAT_INPUT, type CompanyVatContext } from './vat';
export { CountryAddressInput } from './address';
