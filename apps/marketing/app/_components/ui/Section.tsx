import { cn } from "../../_lib/cn";
import PageShell from "./PageShell";

type SectionVariant = "default" | "muted" | "borderTop";

type SectionProps = {
  children: React.ReactNode;
  id?: string;
  className?: string;
  shellClassName?: string;
  variant?: SectionVariant;
};

const variantClass: Record<SectionVariant, string> = {
  default: "",
  muted: "tg-section--muted",
  borderTop: "tg-section--borderTop",
};

export default function Section({
  children,
  id,
  className,
  shellClassName,
  variant = "default",
}: SectionProps) {
  return (
    <section id={id} className={cn("tg-section", variantClass[variant], className)}>
      <PageShell className={shellClassName}>{children}</PageShell>
    </section>
  );
}
