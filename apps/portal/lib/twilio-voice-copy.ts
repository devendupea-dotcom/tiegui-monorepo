function escapeTwiml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function twimlResponse(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
    },
  });
}

function normalizeVoiceBusinessName(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
}

export function buildForwardDialTwiml(input: {
  afterCallUrl: string;
  forwardingNumber: string;
  timeoutSeconds: number;
  callerId?: string | null;
}) {
  const attributes = [
    `timeout="${Math.max(1, Math.min(60, Math.floor(input.timeoutSeconds || 0) || 20))}"`,
    `action="${escapeTwiml(input.afterCallUrl)}"`,
    'method="POST"',
    'answerOnBridge="true"',
  ];

  if (input.callerId?.trim()) {
    attributes.push(`callerId="${escapeTwiml(input.callerId)}"`);
  }

  return twimlResponse(
    [`<Dial ${attributes.join(" ")}>`, escapeTwiml(input.forwardingNumber), "</Dial>"].join(""),
  );
}

export function buildVoicemailFallbackTwiml(input: {
  afterCallUrl: string;
  businessName?: string | null;
}) {
  const businessName = normalizeVoiceBusinessName(input.businessName);
  const intro = businessName
    ? `Thanks for calling ${businessName}. We're helping another customer right now. Please leave a message after the tone.`
    : "Thanks for calling. We're helping another customer right now. Please leave a message after the tone.";

  return twimlResponse(
    [
      `<Say>${escapeTwiml(intro)}</Say>`,
      `<Record maxLength="90" playBeep="true" action="${escapeTwiml(input.afterCallUrl)}" method="POST" />`,
      "<Say>Thanks. We will get back to you shortly.</Say>",
    ].join(""),
  );
}
