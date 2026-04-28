import { cn } from "../../_lib/cn";

type PageShellProps = {
  children: React.ReactNode;
  className?: string;
};

export default function PageShell({ children, className }: PageShellProps) {
  return <div className={cn("tg-shell", className)}>{children}</div>;
}
