import * as React from 'react';
import { Mail } from 'lucide-react';
import { zEmailSchema } from '@crm/lib/types';
import { Input, type InputProps } from './input';
import { HelperText } from './helper-text';
import { Collapse } from '../surfaces/collapse';
import { cn } from '../../theme/utils';

function validateEmail(value: string): string | null {
  const result = zEmailSchema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? null);
}

interface EmailInputProps extends Omit<InputProps, 'type'> {
  error?: string | null;
  hideIcon?: boolean;
  errorId?: string;
}

function EmailInput({
  error,
  hideIcon,
  errorId,
  className,
  invalid,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  autoComplete,
  ref,
  ...props
}: EmailInputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const hasError = !!error;
  const [lastMessage, setLastMessage] = React.useState<string | null>(error ?? null);
  React.useEffect(() => {
    if (error) setLastMessage(error);
  }, [error]);

  return (
    <>
      <div className="relative">
        {!hideIcon && (
          <Mail
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <Input
          {...props}
          ref={ref}
          type="email"
          autoComplete={autoComplete ?? 'email'}
          invalid={hasError || invalid}
          aria-invalid={hasError || ariaInvalid}
          aria-describedby={hasError && errorId ? errorId : ariaDescribedBy}
          className={cn(!hideIcon && 'pl-11', className)}
        />
      </div>
      <Collapse open={hasError}>
        <HelperText id={errorId} variant="error">
          {lastMessage}
        </HelperText>
      </Collapse>
    </>
  );
}

export { EmailInput, validateEmail, type EmailInputProps };
