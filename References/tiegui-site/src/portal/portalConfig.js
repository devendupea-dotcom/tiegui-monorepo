export const ALLOWED_EMAILS = ["deven.dupea@gmail.com", "yaloturnt@gmail.com"];

export const isAllowedEmail = (email) => {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(String(email).toLowerCase());
};
