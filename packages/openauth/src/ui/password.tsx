/**
 * Configure the UI that's used by the Password provider.
 *
 * ```ts {1,7-12}
 * import { PasswordUI } from "@openauthjs/openauth/ui/password"
 * import { PasswordProvider } from "@openauthjs/openauth/provider/password"
 *
 * export default issuer({
 *   providers: {
 *     password: PasswordAdapter(
 *       PasswordUI({
 *         copy: {
 *           error_email_taken: "This email is already taken."
 *         },
 *         sendCode: (email, code) => console.log(email, code)
 *       })
 *     )
 *   },
 *   // ...
 * })
 * ```
 *
 * @packageDocumentation
 */
/** @jsxImportSource hono/jsx */

import {
  PasswordChangeError,
  PasswordConfig,
  PasswordLoginError,
  PasswordRegisterError,
} from "../provider/password.js"
import { Layout } from "./base.js"
import "./form.js"
import { FormAlert } from "./form.js"
import type { Theme } from "./theme.js"
import {
  getLocaleFromRequest,
  getTranslations,
  type Locale,
  type Translations,
} from "./i18n.js"

/**
 * Extracts theme from request header if available
 * @internal
 */
function getThemeFromRequest(req: Request): Theme | undefined {
  const themeHeader = req.headers.get("X-OpenAuth-Theme")
  if (!themeHeader) return undefined

  try {
    return JSON.parse(themeHeader) as Theme
  } catch {
    return undefined
  }
}

const DEFAULT_COPY = {
  /**
   * Error message when email is already taken.
   */
  error_email_taken: "There is already an account with this email.",
  /**
   * Error message when the confirmation code is incorrect.
   */
  error_invalid_code: "Code is incorrect.",
  /**
   * Error message when the email is invalid.
   */
  error_invalid_email: "Email is not valid.",
  /**
   * Error message when the password is incorrect.
   */
  error_invalid_password: "Password is incorrect.",
  /**
   * Error message when the passwords do not match.
   */
  error_password_mismatch: "Passwords do not match.",
  /**
   * Error message when the user enters a password that fails validation.
   */
  error_validation_error: "Password does not meet requirements.",
  /**
   * Title of the register page.
   */
  register_title: "Welcome to the app",
  /**
   * Description of the register page.
   */
  register_description: "Sign in with your email",
  /**
   * Title of the login page.
   */
  login_title: "Welcome to the app",
  /**
   * Description of the login page.
   */
  login_description: "Sign in with your email",
  /**
   * Copy for the register button.
   */
  register: "Register",
  /**
   * Copy for the register link.
   */
  register_prompt: "Don't have an account?",
  /**
   * Copy for the login link.
   */
  login_prompt: "Already have an account?",
  /**
   * Copy for the login button.
   */
  login: "Login",
  /**
   * Copy for the forgot password link.
   */
  change_prompt: "Forgot password?",
  /**
   * Copy for the resend code button.
   */
  code_resend: "Resend code",
  /**
   * Copy for the "Back to" link.
   */
  code_return: "Back to",
  /**
   * Copy for the logo.
   * @internal
   */
  logo: "A",
  /**
   * Copy for the email input.
   */
  input_email: "Email",
  /**
   * Copy for the password input.
   */
  input_password: "Password",
  /**
   * Copy for the code input.
   */
  input_code: "Code",
  /**
   * Copy for the repeat password input.
   */
  input_repeat: "Repeat password",
  /**
   * Copy for the continue button.
   */
  button_continue: "Continue",
} satisfies {
  [key in `error_${
    | PasswordLoginError["type"]
    | PasswordRegisterError["type"]
    | PasswordChangeError["type"]}`]: string
} & Record<string, string>

type PasswordUICopy = typeof DEFAULT_COPY

/**
 * Configure the password UI.
 */
export interface PasswordUIOptions extends Pick<
  PasswordConfig,
  "sendCode" | "validatePassword"
> {
  /**
   * Custom copy for the UI.
   */
  copy?: Partial<PasswordUICopy>
}

/**
 * Creates a UI for the Password provider flow.
 * @param input - Configure the UI.
 */
export function PasswordUI(input: PasswordUIOptions): PasswordConfig {
  return {
    validatePassword: input.validatePassword,
    sendCode: input.sendCode,
    login: async (req, form, error): Promise<Response> => {
      const theme = getThemeFromRequest(req)
      const locale = getLocaleFromRequest(req)
      const t = getTranslations(locale)
      const copy = {
        ...DEFAULT_COPY,
        // Override with translations
        error_email_taken: t.error_email_taken,
        error_invalid_code: t.error_invalid_code,
        error_invalid_email: t.error_invalid_email,
        error_invalid_password: t.error_invalid_password,
        error_password_mismatch: t.error_password_mismatch,
        error_validation_error: t.error_validation_error,
        register_title: t.register_title,
        register_description: t.register_description,
        login_title: t.login_title,
        login_description: t.login_description,
        register: t.register,
        register_prompt: t.register_prompt,
        login_prompt: t.login_prompt,
        login: t.login,
        change_prompt: t.change_prompt,
        code_resend: t.code_resend,
        code_return: t.code_return,
        logo: t.logo,
        input_email: t.input_email,
        input_password: t.input_password,
        input_code: t.input_code,
        input_repeat: t.input_repeat,
        button_continue: t.button_continue,
        // User overrides take precedence
        ...input.copy,
      }
      const jsx = (
        <Layout theme={theme} locale={locale}>
          <form data-component="form" method="post">
            <FormAlert message={error?.type && copy?.[`error_${error.type}`]} />
            <input
              data-component="input"
              type="email"
              name="email"
              required
              placeholder={copy.input_email}
              autofocus={!error}
              value={form?.get("email")?.toString()}
            />
            <input
              data-component="input"
              autofocus={error?.type === "invalid_password"}
              required
              type="password"
              name="password"
              placeholder={copy.input_password}
              autoComplete="current-password"
            />
            <button data-component="button">{copy.button_continue}</button>
            <div data-component="form-footer">
              <span>
                {copy.register_prompt}{" "}
                <a data-component="link" href="register">
                  {copy.register}
                </a>
              </span>
              <a data-component="link" href="change">
                {copy.change_prompt}
              </a>
            </div>
          </form>
        </Layout>
      )
      return new Response(jsx.toString(), {
        status: error ? 401 : 200,
        headers: {
          "Content-Type": "text/html",
        },
      })
    },
    register: async (req, state, form, error): Promise<Response> => {
      const theme = getThemeFromRequest(req)
      const locale = getLocaleFromRequest(req)
      const t = getTranslations(locale)
      const copy = {
        ...DEFAULT_COPY,
        error_email_taken: t.error_email_taken,
        error_invalid_code: t.error_invalid_code,
        error_invalid_email: t.error_invalid_email,
        error_invalid_password: t.error_invalid_password,
        error_password_mismatch: t.error_password_mismatch,
        error_validation_error: t.error_validation_error,
        register_title: t.register_title,
        register_description: t.register_description,
        login_title: t.login_title,
        login_description: t.login_description,
        register: t.register,
        register_prompt: t.register_prompt,
        login_prompt: t.login_prompt,
        login: t.login,
        change_prompt: t.change_prompt,
        code_resend: t.code_resend,
        code_return: t.code_return,
        logo: t.logo,
        input_email: t.input_email,
        input_password: t.input_password,
        input_code: t.input_code,
        input_repeat: t.input_repeat,
        button_continue: t.button_continue,
        ...input.copy,
      }
      const emailError = ["invalid_email", "email_taken"].includes(
        error?.type || "",
      )
      const passwordError = [
        "invalid_password",
        "password_mismatch",
        "validation_error",
      ].includes(error?.type || "")
      const jsx = (
        <Layout theme={theme} locale={locale}>
          <form data-component="form" method="post">
            <FormAlert
              message={
                error?.type
                  ? error.type === "validation_error"
                    ? (error.message ?? copy?.[`error_${error.type}`])
                    : copy?.[`error_${error.type}`]
                  : undefined
              }
            />
            {state.type === "start" && (
              <>
                <input type="hidden" name="action" value="register" />
                <input
                  data-component="input"
                  autofocus={!error || emailError}
                  type="email"
                  name="email"
                  value={!emailError ? form?.get("email")?.toString() : ""}
                  required
                  placeholder={copy.input_email}
                />
                <input
                  data-component="input"
                  autofocus={passwordError}
                  type="password"
                  name="password"
                  placeholder={copy.input_password}
                  required
                  value={
                    !passwordError ? form?.get("password")?.toString() : ""
                  }
                  autoComplete="new-password"
                />
                <input
                  data-component="input"
                  type="password"
                  name="repeat"
                  required
                  autofocus={passwordError}
                  placeholder={copy.input_repeat}
                  autoComplete="new-password"
                />
                <button data-component="button">{copy.button_continue}</button>
                <div data-component="form-footer">
                  <span>
                    {copy.login_prompt}{" "}
                    <a data-component="link" href="authorize">
                      {copy.login}
                    </a>
                  </span>
                </div>
              </>
            )}

            {state.type === "code" && (
              <>
                <input type="hidden" name="action" value="verify" />
                <input
                  data-component="input"
                  autofocus
                  name="code"
                  minLength={6}
                  maxLength={6}
                  required
                  placeholder={copy.input_code}
                  autoComplete="one-time-code"
                />
                <button data-component="button">{copy.button_continue}</button>
              </>
            )}
          </form>
        </Layout>
      ) as string
      return new Response(jsx.toString(), {
        headers: {
          "Content-Type": "text/html",
        },
      })
    },
    change: async (req, state, form, error): Promise<Response> => {
      const theme = getThemeFromRequest(req)
      const locale = getLocaleFromRequest(req)
      const t = getTranslations(locale)
      const copy = {
        ...DEFAULT_COPY,
        error_email_taken: t.error_email_taken,
        error_invalid_code: t.error_invalid_code,
        error_invalid_email: t.error_invalid_email,
        error_invalid_password: t.error_invalid_password,
        error_password_mismatch: t.error_password_mismatch,
        error_validation_error: t.error_validation_error,
        register_title: t.register_title,
        register_description: t.register_description,
        login_title: t.login_title,
        login_description: t.login_description,
        register: t.register,
        register_prompt: t.register_prompt,
        login_prompt: t.login_prompt,
        login: t.login,
        change_prompt: t.change_prompt,
        code_resend: t.code_resend,
        code_return: t.code_return,
        logo: t.logo,
        input_email: t.input_email,
        input_password: t.input_password,
        input_code: t.input_code,
        input_repeat: t.input_repeat,
        button_continue: t.button_continue,
        ...input.copy,
      }
      const passwordError = [
        "invalid_password",
        "password_mismatch",
        "validation_error",
      ].includes(error?.type || "")
      const jsx = (
        <Layout theme={theme} locale={locale}>
          <form data-component="form" method="post" replace>
            <FormAlert
              message={
                error?.type
                  ? error.type === "validation_error"
                    ? (error.message ?? copy?.[`error_${error.type}`])
                    : copy?.[`error_${error.type}`]
                  : undefined
              }
            />
            {state.type === "start" && (
              <>
                <input type="hidden" name="action" value="code" />
                <input
                  data-component="input"
                  autofocus
                  type="email"
                  name="email"
                  required
                  value={form?.get("email")?.toString()}
                  placeholder={copy.input_email}
                />
              </>
            )}
            {state.type === "code" && (
              <>
                <input type="hidden" name="action" value="verify" />
                <input
                  data-component="input"
                  autofocus
                  name="code"
                  minLength={6}
                  maxLength={6}
                  required
                  placeholder={copy.input_code}
                  autoComplete="one-time-code"
                />
              </>
            )}
            {state.type === "update" && (
              <>
                <input type="hidden" name="action" value="update" />
                <input
                  data-component="input"
                  autofocus
                  type="password"
                  name="password"
                  placeholder={copy.input_password}
                  required
                  value={
                    !passwordError ? form?.get("password")?.toString() : ""
                  }
                  autoComplete="new-password"
                />
                <input
                  data-component="input"
                  type="password"
                  name="repeat"
                  required
                  value={
                    !passwordError ? form?.get("password")?.toString() : ""
                  }
                  placeholder={copy.input_repeat}
                  autoComplete="new-password"
                />
              </>
            )}
            <button data-component="button">{copy.button_continue}</button>
          </form>
          {state.type === "code" && (
            <form method="post">
              <input type="hidden" name="action" value="code" />
              <input type="hidden" name="email" value={state.email} />
              {state.type === "code" && (
                <div data-component="form-footer">
                  <span>
                    {copy.code_return}{" "}
                    <a data-component="link" href="authorize">
                      {copy.login.toLowerCase()}
                    </a>
                  </span>
                  <button data-component="link">{copy.code_resend}</button>
                </div>
              )}
            </form>
          )}
        </Layout>
      )
      return new Response(jsx.toString(), {
        status: error ? 400 : 200,
        headers: {
          "Content-Type": "text/html",
        },
      })
    },
  }
}
