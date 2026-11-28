export const TOKEN_LIMITS: Readonly<Record<string, number>> = {
  grant_type: 64,
  code: 512,
  redirect_uri: 4096,
  client_id: 256,
  client_secret: 512,
  code_verifier: 128,
  refresh_token: 4096,
  device_code: 512,
  scope: 2048,
  provider: 128,
  install_id: 256,
}

export const TOKEN_LOOKUP_LIMITS: Readonly<Record<string, number>> = {
  token: 16384,
  token_type_hint: 64,
  client_id: TOKEN_LIMITS.client_id!,
  client_secret: TOKEN_LIMITS.client_secret!,
}

const KEY_FIELDS = new Set(["code", "refresh_token", "device_code", "token"])
const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/

export function validFormFields(
  form: FormData,
  limits: Readonly<Record<string, number>>,
): boolean {
  return Object.entries(limits).every(([key, length]) => {
    const fields = form.getAll(key)
    return (
      fields.length <= 1 &&
      fields.every(
        (value) =>
          typeof value === "string" &&
          value.length <= length &&
          (key === "scope" || !CONTROL.test(value)) &&
          (!KEY_FIELDS.has(key) || !value.includes("::")),
      )
    )
  })
}

export function validScopeToken(scope: string): boolean {
  return SCOPE_TOKEN.test(scope)
}

export function validScopeString(scope: string): boolean {
  return (
    scope.length <= 2048 &&
    scope.split(" ").every((token) => !token || validScopeToken(token))
  )
}
