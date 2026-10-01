// Types

// Utilities
export { cn } from './theme/utils';

// UI Components - Inputs
export { Button } from './components/inputs/button';
export { IconButton } from './components/inputs/icon-button';
export { Input } from './components/inputs/input';
export { HelperText } from './components/inputs/helper-text';
export { Textarea } from './components/inputs/textarea';
export { Label } from './components/inputs/label';
export { Switch } from './components/inputs/switch';
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
} from './components/inputs/select';
export { MultiSelect } from './components/inputs/multi-select';
export { DatePicker } from './components/inputs/date-picker';
export { OtpInput } from './components/inputs/otp-input';
export { Combobox } from './components/inputs/combobox';
export { AddressInput } from './components/inputs/address-input';
export {
  createGooglePlacesProvider,
  createBanAddressProvider,
} from './components/inputs/address-providers';
export type {
  AddressValue,
  AddressSuggestionsProvider,
  AddressDetailsResolver,
} from './components/inputs/address-providers';
export { PhoneInput } from './components/inputs/phone-input';
export { TimeInput } from './components/inputs/time-input';
export { EmailInput, validateEmail } from './components/inputs/email-input';
export { Checkbox } from './components/inputs/checkbox';
export { VerifiedSIRETInput } from './components/inputs/verified-siret-input';
export type { SiretVerificationResult } from './components/inputs/verified-siret-input';
export { VerifiedRPPSInput } from './components/inputs/verified-rpps-input';
export type { RppsVerificationResult } from './components/inputs/verified-rpps-input';

// UI Components - Feedback
export { Alert, AlertTitle, AlertDescription } from './components/feedback/alert';
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './components/feedback/dialog';
export { Progress } from './components/feedback/progress';
export { ConfirmDialog } from './components/feedback/confirm-dialog';
export { Skeleton } from './components/feedback/skeleton';
export { Toaster, toast } from './components/feedback/sonner';
export { Spinner } from './components/feedback/spinner';
export type {
  SiretCompanyCardCompareTo,
  SiretCompanyData,
} from './components/feedback/siret-company-card';
// UI Components - Data Display
export { InitialsAvatar } from './components/data-display/initials-avatar';
export { StatusBadge } from './components/data-display/status-badge';
export type { StatusTone } from './components/data-display/status-badge';
export { StatCard } from './components/data-display/stat-card';
export { KeyValueList, KeyValueRow } from './components/data-display/key-value-list';
export { FunnelBar } from './components/data-display/funnel-bar';
export { SortableList } from './components/data-display/sortable-list';
export { Sparkline } from './components/data-display/sparkline';
export { TimeSeriesChart } from './components/data-display/time-series-chart';
export { Badge } from './components/data-display/badge';
export {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from './components/data-display/table';

// UI Components - Surfaces
export { Card } from './components/surfaces/card';
export { Collapse } from './components/surfaces/collapse';

// UI Components - Navigation
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './components/navigation/dropdown-menu';
export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from './components/navigation/sheet';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './components/navigation/tabs';
export { SegmentedControl } from './components/navigation/segmented-control';
// UI Components - Layout
export { PageHeader } from './components/layout/page-header';

// Brand Components
export { Logo } from './components/brand';
