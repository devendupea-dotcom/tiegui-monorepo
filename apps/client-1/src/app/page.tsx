import fs from "fs";
import path from "path";

export default function Page() {
  const body = fs.readFileSync(path.join(process.cwd(), "src/app/body.html"), "utf8");
  return (
    <main suppressHydrationWarning dangerouslySetInnerHTML={{ __html: body }} />
  );
}
