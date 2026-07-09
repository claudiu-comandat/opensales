import * as React from 'react';

import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-[38px] w-full rounded-[10px] border border-ink-200 bg-surface px-3 py-0 text-[13.5px] text-ink-900 transition-all duration-150 ease-out',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-ink-400',
          'focus:outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
