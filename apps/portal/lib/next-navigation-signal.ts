type NextNavigationSignal = {
  digest?: unknown;
};

export function isNextNavigationSignal(error: unknown): boolean {
  const digest = (error as NextNavigationSignal | null)?.digest;
  if (typeof digest !== "string") {
    return false;
  }

  return (
    digest.startsWith("NEXT_REDIRECT;") ||
    digest === "NEXT_NOT_FOUND" ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")
  );
}
