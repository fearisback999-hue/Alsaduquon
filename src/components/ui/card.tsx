import { forwardRef, type HTMLAttributes } from "react";

type CardVariant = "default" | "elevated" | "glass" | "shine";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  hover?: boolean;
  padded?: boolean;
}

const variantClasses: Record<CardVariant, string> = {
  default: "card",
  elevated: "card shadow-md",
  glass: "glass rounded-xl",
  shine: "shine border border-border rounded-xl shadow-sm",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", hover = false, padded = false, className = "", children, ...rest },
  ref,
) {
  const classes = [
    variantClasses[variant],
    hover ? "card-hover" : "",
    padded ? "p-5" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={classes} {...rest}>
      {children}
    </div>
  );
});

export function CardHeader({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-5 pt-5 pb-3 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className = "", children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-sm font-semibold text-fg tracking-tight ${className}`} {...rest}>
      {children}
    </h3>
  );
}

export function CardDescription({ className = "", children, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`text-xs text-fg-subtle mt-0.5 ${className}`} {...rest}>
      {children}
    </p>
  );
}

export function CardContent({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-5 pb-5 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-5 py-3 border-t border-border flex items-center ${className}`} {...rest}>
      {children}
    </div>
  );
}
