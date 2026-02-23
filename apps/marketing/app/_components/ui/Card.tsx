import { cn } from "../../_lib/cn";

type CardProps = {
  children: React.ReactNode;
  className?: string;
  as?: "article" | "div";
};

export default function Card({ children, className, as = "article" }: CardProps) {
  if (as === "div") {
    return <div className={cn("tg-card", className)}>{children}</div>;
  }

  return <article className={cn("tg-card", className)}>{children}</article>;
}
