// Types
export type { BadgeVariant, ButtonVariant, ButtonColor } from './types';

// Utilities
export { cn } from './theme/utils';

// Hooks
export { useIsMobile } from './hooks/useIsMobile';
export { useIsTouchDevice } from './hooks/useIsTouchDevice';

// Portal
export { PortalContainerProvider, usePortalContainer } from './components/portal-container';

// UI Components - Inputs
export { Button, buttonVariants } from './components/inputs/button';
export type { ButtonProps } from './components/inputs/button';
export { IconButton, iconButtonVariants } from './components/inputs/icon-button';
export type { IconButtonProps } from './components/inputs/icon-button';
export { Input } from './components/inputs/input';
export { HelperText } from './components/inputs/helper-text';
export type { HelperTextProps } from './components/inputs/helper-text';
export { Textarea } from './components/inputs/textarea';
export type { TextareaProps } from './components/inputs/textarea';
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
  SelectSeparator,
} from './components/inputs/select';
export { MultiSelect } from './components/inputs/multi-select';
export type { MultiSelectProps, MultiSelectItem } from './components/inputs/multi-select';
export { Calendar, CalendarDayButton } from './components/inputs/calendar';
export { DatePicker } from './components/inputs/date-picker';
export type { DatePickerProps } from './components/inputs/date-picker';
export { OtpInput } from './components/inputs/otp-input';
export type { OtpInputProps } from './components/inputs/otp-input';
export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './components/inputs/command';
export { Combobox } from './components/inputs/combobox';
export type { ComboboxProps, ComboboxItem } from './components/inputs/combobox';
export {
  AddressInput,
  createGooglePlacesProvider,
  createBanAddressProvider,
} from './components/inputs/address-input';
export type {
  AddressInputProps,
  AddressValue,
  AddressSuggestion,
  AddressSuggestionsProvider,
  AddressDetailsResolver,
  GooglePlacesProviderOptions,
  BanAddressProviderOptions,
} from './components/inputs/address-input';
export { PhoneInput } from './components/inputs/phone-input';
export type { PhoneInputProps } from './components/inputs/phone-input';
export { SIRETInput } from './components/inputs/siret-input';
export type { SIRETInputProps, SIRETMode } from './components/inputs/siret-input';
export { RPPSInput } from './components/inputs/rpps-input';
export type { RPPSInputProps } from './components/inputs/rpps-input';
export { TimeInput } from './components/inputs/time-input';
export type { TimeInputProps } from './components/inputs/time-input';
export { EmailInput, validateEmail } from './components/inputs/email-input';
export type { EmailInputProps } from './components/inputs/email-input';
export { Checkbox } from './components/inputs/checkbox';
export { VerifiedSIRETInput } from './components/inputs/verified-siret-input';
export type {
  VerifiedSIRETInputProps,
  SiretVerificationResult,
} from './components/inputs/verified-siret-input';
export { VerifiedRPPSInput } from './components/inputs/verified-rpps-input';
export type {
  VerifiedRPPSInputProps,
  RppsVerificationResult,
} from './components/inputs/verified-rpps-input';

// UI Components - Feedback
export { Alert, AlertTitle, AlertDescription } from './components/feedback/alert';
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './components/feedback/dialog';
export { Progress } from './components/feedback/progress';
export { Skeleton } from './components/feedback/skeleton';
export { Toaster, toast } from './components/feedback/sonner';
export { Spinner } from './components/feedback/spinner';
export { LoaderSquares } from './components/feedback/loader-squares';
export { SiretCompanyCard } from './components/feedback/siret-company-card';
export type {
  SiretCompanyCardProps,
  SiretCompanyCardCompareTo,
  SiretCompanyData,
  SiretCompanyAddress,
} from './components/feedback/siret-company-card';
export { RppsPractitionerCard } from './components/feedback/rpps-practitioner-card';
export type {
  RppsPractitionerCardProps,
  RppsPractitionerCardCompareTo,
  RppsPractitionerData,
} from './components/feedback/rpps-practitioner-card';

// UI Components - Data Display
export { Avatar, AvatarImage, AvatarFallback } from './components/data-display/avatar';
export { InitialsAvatar, AVATAR_PALETTE } from './components/data-display/initials-avatar';
export type { InitialsAvatarProps } from './components/data-display/initials-avatar';
export { StatusBadge, TONE_STYLES } from './components/data-display/status-badge';
export type { StatusBadgeProps, StatusTone } from './components/data-display/status-badge';
export { StatCard } from './components/data-display/stat-card';
export type { StatCardProps } from './components/data-display/stat-card';
export { KeyValueList, KeyValueRow } from './components/data-display/key-value-list';
export type { KeyValueRowProps } from './components/data-display/key-value-list';
export { FunnelBar } from './components/data-display/funnel-bar';
export type { FunnelBarProps } from './components/data-display/funnel-bar';
export { Sparkline } from './components/data-display/sparkline';
export type { SparklineProps } from './components/data-display/sparkline';
export { TimeSeriesChart } from './components/data-display/time-series-chart';
export type { TimeSeriesChartProps, TimeSeriesPoint } from './components/data-display/time-series-chart';
export { Badge, badgeVariants } from './components/data-display/badge';
export type { BadgeProps } from './components/data-display/badge';
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './components/data-display/tooltip';
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from './components/data-display/table';

// UI Components - Surfaces
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from './components/surfaces/card';
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from './components/surfaces/popover';
export { Collapse } from './components/surfaces/collapse';
export type { CollapseProps } from './components/surfaces/collapse';

// UI Components - Navigation
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from './components/navigation/dropdown-menu';
export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from './components/navigation/sheet';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './components/navigation/tabs';
export { SegmentedControl } from './components/navigation/segmented-control';
export type { SegmentedControlProps, SegmentedControlItem } from './components/navigation/segmented-control';

// UI Components - Layout
export { Separator } from './components/layout/separator';
export { PageHeader } from './components/layout/page-header';
export type { PageHeaderProps } from './components/layout/page-header';

// Brand Components
export { Logo, LogoIcon, AppLogo } from './components/brand';
export type { LogoProps, LogoIconProps, AppLogoProps } from './components/brand';
