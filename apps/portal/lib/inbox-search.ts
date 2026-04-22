export type InboxSearchConversation = {
  contactName: string;
  phoneE164: string;
  lastSnippet?: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeDigits(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

export function matchesInboxConversationSearch(
  row: InboxSearchConversation,
  rawSearch: string,
): boolean {
  const term = normalizeText(rawSearch);
  if (!term) {
    return true;
  }

  const contactName = normalizeText(row.contactName);
  const phoneRaw = normalizeText(row.phoneE164);
  const snippet = normalizeText(row.lastSnippet);

  if (contactName.includes(term) || phoneRaw.includes(term) || snippet.includes(term)) {
    return true;
  }

  const searchDigits = normalizeDigits(term);
  if (!searchDigits) {
    return false;
  }

  const phoneDigits = normalizeDigits(row.phoneE164);
  if (!phoneDigits) {
    return false;
  }

  return phoneDigits.includes(searchDigits)
    || (phoneDigits.length === 11 && phoneDigits.startsWith("1") && phoneDigits.slice(1).includes(searchDigits))
    || (searchDigits.length === 11 && searchDigits.startsWith("1") && phoneDigits.includes(searchDigits.slice(1)));
}
