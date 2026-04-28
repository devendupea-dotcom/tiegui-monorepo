import Link from "next/link";
import { cn } from "../../_lib/cn";

type ButtonVariant = "primary" | "secondary";

type ButtonLinkProps = {
  href: string;
  label: string;
  className?: string;
  variant?: ButtonVariant;
  target?: "_blank" | "_self";
  rel?: string;
};

export default function ButtonLink({
  href,
  label,
  className,
  variant = "primary",
  target,
  rel,
}: ButtonLinkProps) {
  const classes = cn("tg-btn", variant === "primary" ? "tg-btn--primary" : "tg-btn--secondary", className);
  const isExternal = href.startsWith("http");

  if (isExternal) {
    return (
      <a className={classes} href={href} target={target ?? "_blank"} rel={rel ?? "noreferrer"}>
        {label}
      </a>
    );
  }

  return (
    <Link className={classes} href={href} target={target} rel={rel}>
      {label}
    </Link>
  );
}
