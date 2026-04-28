export function formatOperationalJobStatusLabel(status: string): string {
  return status
    .trim()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}
