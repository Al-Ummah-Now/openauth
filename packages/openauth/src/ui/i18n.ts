/**
 * Internationalization (i18n) support for OpenAuth UI.
 *
 * @example
 * ```ts
 * import { getTranslations, type Locale } from "@openauthjs/openauth/ui/i18n"
 *
 * const t = getTranslations("ar")
 * console.log(t.button_continue) // "متابعة"
 * ```
 *
 * @packageDocumentation
 */

/**
 * Supported locale codes.
 */
export type Locale = "en" | "ar"

/**
 * Text direction for a locale.
 */
export type Direction = "ltr" | "rtl"

/**
 * All translatable strings used in the UI.
 */
export interface Translations {
  // Common
  button_continue: string

  // Password UI
  error_email_taken: string
  error_invalid_code: string
  error_invalid_email: string
  error_invalid_password: string
  error_password_mismatch: string
  error_validation_error: string
  register_title: string
  register_description: string
  login_title: string
  login_description: string
  register: string
  register_prompt: string
  login_prompt: string
  login: string
  change_prompt: string
  code_resend: string
  code_return: string
  logo: string
  input_email: string
  input_password: string
  input_code: string
  input_repeat: string

  // Code UI
  email_placeholder: string
  email_invalid: string
  code_info: string
  code_placeholder: string
  code_invalid: string
  code_sent: string
  code_resent: string
  code_didnt_get: string

  // Select UI
  continue_with: string
  provider_twitch: string
  provider_google: string
  provider_github: string
  provider_apple: string
  provider_x: string
  provider_facebook: string
  provider_microsoft: string
  provider_slack: string
}

/**
 * English translations (default).
 */
export const en: Translations = {
  // Common
  button_continue: "Continue",

  // Password UI
  error_email_taken: "There is already an account with this email.",
  error_invalid_code: "Code is incorrect.",
  error_invalid_email: "Email is not valid.",
  error_invalid_password: "Password is incorrect.",
  error_password_mismatch: "Passwords do not match.",
  error_validation_error: "Password does not meet requirements.",
  register_title: "Welcome to the app",
  register_description: "Sign in with your email",
  login_title: "Welcome to the app",
  login_description: "Sign in with your email",
  register: "Register",
  register_prompt: "Don't have an account?",
  login_prompt: "Already have an account?",
  login: "Login",
  change_prompt: "Forgot password?",
  code_resend: "Resend code",
  code_return: "Back to",
  logo: "A",
  input_email: "Email",
  input_password: "Password",
  input_code: "Code",
  input_repeat: "Repeat password",

  // Code UI
  email_placeholder: "Email",
  email_invalid: "Email address is not valid",
  code_info: "We'll send a pin code to your email.",
  code_placeholder: "Code",
  code_invalid: "Invalid code",
  code_sent: "Code sent to ",
  code_resent: "Code resent to ",
  code_didnt_get: "Didn't get code?",

  // Select UI
  continue_with: "Continue with",
  provider_twitch: "Twitch",
  provider_google: "Google",
  provider_github: "GitHub",
  provider_apple: "Apple",
  provider_x: "X",
  provider_facebook: "Facebook",
  provider_microsoft: "Microsoft",
  provider_slack: "Slack",
}

/**
 * Arabic translations.
 */
export const ar: Translations = {
  // Common
  button_continue: "متابعة",

  // Password UI
  error_email_taken: "يوجد حساب مسجل بهذا البريد الإلكتروني.",
  error_invalid_code: "الرمز غير صحيح.",
  error_invalid_email: "البريد الإلكتروني غير صالح.",
  error_invalid_password: "كلمة المرور غير صحيحة.",
  error_password_mismatch: "كلمتا المرور غير متطابقتين.",
  error_validation_error: "كلمة المرور لا تستوفي المتطلبات.",
  register_title: "مرحباً بك في التطبيق",
  register_description: "سجل دخولك بالبريد الإلكتروني",
  login_title: "مرحباً بك في التطبيق",
  login_description: "سجل دخولك بالبريد الإلكتروني",
  register: "تسجيل",
  register_prompt: "ليس لديك حساب؟",
  login_prompt: "لديك حساب بالفعل؟",
  login: "دخول",
  change_prompt: "نسيت كلمة المرور؟",
  code_resend: "إعادة إرسال الرمز",
  code_return: "العودة إلى",
  logo: "أ",
  input_email: "البريد الإلكتروني",
  input_password: "كلمة المرور",
  input_code: "الرمز",
  input_repeat: "تأكيد كلمة المرور",

  // Code UI
  email_placeholder: "البريد الإلكتروني",
  email_invalid: "عنوان البريد الإلكتروني غير صالح",
  code_info: "سنرسل رمز التحقق إلى بريدك الإلكتروني.",
  code_placeholder: "الرمز",
  code_invalid: "الرمز غير صالح",
  code_sent: "تم إرسال الرمز إلى ",
  code_resent: "تم إعادة إرسال الرمز إلى ",
  code_didnt_get: "لم تستلم الرمز؟",

  // Select UI
  continue_with: "المتابعة عبر",
  provider_twitch: "تويتش",
  provider_google: "جوجل",
  provider_github: "جيت هاب",
  provider_apple: "أبل",
  provider_x: "إكس",
  provider_facebook: "فيسبوك",
  provider_microsoft: "مايكروسوفت",
  provider_slack: "سلاك",
}

/**
 * Map of all available translations.
 */
export const translations: Record<Locale, Translations> = {
  en,
  ar,
}

/**
 * Map of locale codes to their text direction.
 */
export const localeDirections: Record<Locale, Direction> = {
  en: "ltr",
  ar: "rtl",
}

/**
 * Default locale.
 */
export const DEFAULT_LOCALE: Locale = "en"

/**
 * Get the text direction for a locale.
 * @param locale - The locale code
 * @returns The text direction ("ltr" or "rtl")
 */
export function getDirection(locale: Locale): Direction {
  return localeDirections[locale] || "ltr"
}

/**
 * Get translations for a locale.
 * @param locale - The locale code
 * @returns The translations object
 */
export function getTranslations(locale?: Locale | string): Translations {
  if (!locale) return en
  const normalizedLocale = locale.split("-")[0].toLowerCase() as Locale
  return translations[normalizedLocale] || en
}

/**
 * Check if a locale is supported.
 * @param locale - The locale code to check
 * @returns True if the locale is supported
 */
export function isLocaleSupported(locale: string): locale is Locale {
  return locale in translations
}

/**
 * Extract locale from URL query parameter.
 * @param url - The URL or URLSearchParams
 * @returns The locale if found and valid, undefined otherwise
 */
export function getLocaleFromUrl(url: URL | string): Locale | undefined {
  const urlObj = typeof url === "string" ? new URL(url) : url
  const lang = urlObj.searchParams.get("lang")
  if (lang && isLocaleSupported(lang)) {
    return lang
  }
  return undefined
}

/**
 * Extract locale from request (URL parameter).
 * @param req - The request object
 * @returns The detected locale or default
 */
export function getLocaleFromRequest(req: Request): Locale {
  const url = new URL(req.url)
  return getLocaleFromUrl(url) || DEFAULT_LOCALE
}
