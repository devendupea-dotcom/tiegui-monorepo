import type enMessages from "../messages/en.json";
import type { PortalLocale } from "../lib/i18n-shared";

declare module "use-intl" {
  interface AppConfig {
    Locale: PortalLocale;
    Messages: typeof enMessages;
  }
}
