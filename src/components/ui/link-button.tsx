import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type LinkProps = ComponentProps<typeof Link>;
type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface LinkButtonProps extends Omit<LinkProps, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  children: ReactNode;
}

const baseClasses =
  "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all duration-150 active:scale-[0.98] focus-visible:outline-none whitespace-nowrap";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-fg hover:bg-brand-hover shadow-sm hover:shadow-md",
  secondary:
    "bg-surface-2 text-fg border border-border hover:bg-surface-hover hover:border-border-strong",
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  outline: "border border-border-strong text-fg hover:bg-surface-hover hover:border-brand",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-base",
};

export function LinkButton({
  variant = "primary",
  size = "md",
  leftIcon,
  rightIcon,
  className = "",
  children,
  ...rest
}: LinkButtonProps) {
  const classes = [baseClasses, variantClasses[variant], sizeClasses[size], className]
    .filter(Boolean)
    .join(" ");
  return (
    <Link className={classes} {...rest}>
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  );
}
