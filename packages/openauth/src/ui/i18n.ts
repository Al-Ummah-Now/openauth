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
  error_code_send_failed: string
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
  /** Alt text for the theme's logo image when the theme has no title */
  logo_alt?: string
  input_email: string
  input_password: string
  input_code: string
  input_repeat: string

  // Restart (unknown state) page
  restart_title: string
  restart_description: string
  restart_button: string
  client_error_title: string
  client_error_description: string
  client_error_button: string
  server_error_title: string
  server_error_description: string
  server_error_reference: string
  server_error_button: string

  // Device activation (RFC 8628)
  device_title: string
  device_description: string
  device_code_label: string
  device_code_invalid: string
  device_rate_limited: string
  device_confirm_title: string
  device_confirm_description: string
  device_confirm_warning: string
  device_approve: string
  device_deny: string
  device_done_title: string
  device_done_description: string
  device_denied_title: string
  device_denied_description: string
  device_failed_title: string
  device_failed_description: string

  // Account picker
  picker_title: string
  picker_description: string
  picker_sign_out: string
  picker_use_another: string

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
  // Passkeys
  passkey_sign_in: string
  passkey_or: string
  passkey_error: string
}

/**
 * English translations (default).
 */
export const en: Translations = {
  // Common
  button_continue: "Continue",
  picker_title: "Choose Account",
  picker_description: "Select an account to continue",
  picker_sign_out: "Sign out",
  picker_use_another: "+ Use another account",
  restart_title: "Let's start your sign-in again",
  restart_description:
    "This sign-in page is no longer active. This happens when it was open for a long time, opened from a bookmark or the back button, or used in another tab.",
  restart_button: "Start sign-in again",
  client_error_title: "This app can't sign you in here",
  client_error_description:
    "The app that sent you here isn't set up to use this sign-in page. Please go back and try again. If it keeps happening, contact support.",
  client_error_button: "Go to the home page",
  server_error_title: "Something went wrong",
  server_error_description:
    "Sign-in hit a problem on our side. Please try again in a moment. If it keeps happening, contact support and quote the reference below.",
  server_error_reference: "Reference:",
  server_error_button: "Try again",
  device_title: "Sign in on your device",
  device_description:
    "Enter the code shown on your TV or other device to sign it in to your account.",
  device_code_label: "Device code",
  device_code_invalid:
    "That code isn't valid or has expired. Check the code on your device and try again.",
  device_rate_limited: "Too many attempts. Please wait a minute and try again.",
  device_confirm_title: "Sign in on {app}?",
  device_confirm_description:
    "Make sure this code matches the one shown on your device:",
  device_confirm_warning:
    "Only continue if you started this sign-in yourself. Never enter a code someone else gave you.",
  device_approve: "Yes, sign in",
  device_deny: "No, cancel",
  device_done_title: "Your device is signed in",
  device_done_description:
    "You can go back to your device now. You can close this page.",
  device_denied_title: "Sign-in cancelled",
  device_denied_description:
    "Your device was not signed in. You can close this page.",
  device_failed_title: "We couldn't sign in your device",
  device_failed_description:
    "The code may have expired. Start the sign-in again on your device to get a new code.",

  // Password UI
  error_email_taken: "There is already an account with this email.",
  error_invalid_code: "Code is incorrect.",
  error_invalid_email: "Email is not valid.",
  error_invalid_password: "Password is incorrect.",
  error_password_mismatch: "Passwords do not match.",
  error_validation_error: "Password does not meet requirements.",
  error_code_send_failed:
    "We couldn't send the code to this email. Check the address and try again.",
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
  logo_alt: "Logo",
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
  passkey_sign_in: "Sign in with a passkey",
  passkey_or: "or",
  passkey_error: "That passkey didn't work. Try again or use your password.",
}

/**
 * Arabic translations.
 */
export const ar: Translations = {
  // Common
  button_continue: "متابعة",
  restart_title: "لنبدأ تسجيل الدخول من جديد",
  restart_description:
    "صفحة تسجيل الدخول هذه لم تعد صالحة. يحدث ذلك إذا بقيت مفتوحة لفترة طويلة، أو فُتحت من إشارة مرجعية أو بزر الرجوع، أو استُخدمت في علامة تبويب أخرى.",
  restart_button: "ابدأ تسجيل الدخول من جديد",
  client_error_title: "لا يمكن لهذا التطبيق تسجيل دخولك هنا",
  client_error_description:
    "التطبيق الذي أرسلك إلى هنا غير مُعدّ لاستخدام صفحة تسجيل الدخول هذه. يُرجى الرجوع والمحاولة مرة أخرى، وإذا تكرر ذلك فتواصل مع الدعم.",
  client_error_button: "الذهاب إلى الصفحة الرئيسية",
  server_error_title: "حدث خطأ ما",
  server_error_description:
    "واجه تسجيل الدخول مشكلة من جهتنا. يُرجى المحاولة مرة أخرى بعد قليل، وإذا تكرر ذلك فتواصل مع الدعم واذكر رقم المرجع أدناه.",
  server_error_reference: "رقم المرجع:",
  server_error_button: "حاول مرة أخرى",
  device_title: "تسجيل الدخول على جهازك",
  device_description:
    "أدخل الرمز الظاهر على التلفاز أو الجهاز الآخر لتسجيل دخوله إلى حسابك.",
  device_code_label: "رمز الجهاز",
  device_code_invalid:
    "هذا الرمز غير صالح أو انتهت صلاحيته. تحقق من الرمز على جهازك وحاول مرة أخرى.",
  device_rate_limited:
    "محاولات كثيرة جدًا. يُرجى الانتظار دقيقة ثم المحاولة مرة أخرى.",
  device_confirm_title: "تسجيل الدخول على {app}؟",
  device_confirm_description:
    "تأكد من أن هذا الرمز يطابق الرمز الظاهر على جهازك:",
  device_confirm_warning:
    "تابع فقط إذا كنت أنت من بدأ تسجيل الدخول هذا. لا تُدخل أبدًا رمزًا أعطاك إياه شخص آخر.",
  device_approve: "نعم، سجّل الدخول",
  device_deny: "لا، إلغاء",
  device_done_title: "تم تسجيل دخول جهازك",
  device_done_description: "يمكنك الآن العودة إلى جهازك وإغلاق هذه الصفحة.",
  device_denied_title: "تم إلغاء تسجيل الدخول",
  device_denied_description: "لم يتم تسجيل دخول جهازك. يمكنك إغلاق هذه الصفحة.",
  device_failed_title: "تعذّر تسجيل دخول جهازك",
  device_failed_description:
    "ربما انتهت صلاحية الرمز. ابدأ تسجيل الدخول من جديد على جهازك للحصول على رمز جديد.",

  // Password UI
  error_email_taken: "يوجد حساب مسجل بهذا البريد الإلكتروني.",
  error_invalid_code: "الرمز غير صحيح.",
  error_invalid_email: "البريد الإلكتروني غير صالح.",
  error_invalid_password: "كلمة المرور غير صحيحة.",
  error_password_mismatch: "كلمتا المرور غير متطابقتين.",
  error_validation_error: "كلمة المرور لا تستوفي المتطلبات.",
  error_code_send_failed:
    "تعذّر إرسال الرمز إلى هذا البريد الإلكتروني. تحقق من العنوان وحاول مرة أخرى.",
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
  logo_alt: "الشعار",
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

  // Account picker
  picker_title: "اختر حسابًا",
  picker_description: "اختر حسابًا للمتابعة",
  picker_sign_out: "تسجيل الخروج",
  picker_use_another: "+ استخدام حساب آخر",
  passkey_sign_in: "الدخول بمفتاح المرور",
  passkey_or: "أو",
  passkey_error: "لم ينجح مفتاح المرور. حاول مرة أخرى أو استخدم كلمة المرور.",
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
  return isLocaleSupported(locale) ? localeDirections[locale] : "ltr"
}

/**
 * Get translations for a locale.
 * @param locale - The locale code
 * @returns The translations object
 */
export function getTranslations(locale?: Locale | string): Translations {
  const normalized = normalizeLocale(locale)
  return normalized ? translations[normalized] : en
}

/**
 * Check if a locale is supported.
 * @param locale - The locale code to check
 * @returns True if the locale is supported
 */
export function isLocaleSupported(locale: string): locale is Locale {
  // Own keys only: `"constructor" in translations` is true.
  return Object.prototype.hasOwnProperty.call(translations, locale)
}

/**
 * The supported locale a tag names, by its primary subtag ("ar-EG" is "ar").
 * @param locale - A locale tag
 * @returns The supported locale, or undefined
 */
export function normalizeLocale(locale?: string): Locale | undefined {
  const primary = locale?.split("-")[0].toLowerCase()
  return primary && isLocaleSupported(primary) ? primary : undefined
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
 * Extract locale from request: `?lang=`, otherwise English.
 * @param req - The request object
 * @returns The detected locale or default
 */
export function getLocaleFromRequest(req: Request): Locale {
  const url = new URL(req.url)
  return getLocaleFromUrl(url) || DEFAULT_LOCALE
}
