/**
 * OAuth Client Management Errors
 */

export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = "ClientError"
  }
}

export class ClientNotFoundError extends ClientError {
  constructor(clientId: string) {
    super("client_not_found", `Client not found: ${clientId}`)
  }
}

export class ClientNameConflictError extends ClientError {
  constructor(name: string) {
    super("client_name_conflict", `Client with name "${name}" already exists`)
  }
}

export class InvalidGrantTypeError extends ClientError {
  constructor(grantType: string) {
    super(
      "invalid_grant_type",
      `Invalid grant type: ${grantType}. Allowed: client_credentials, authorization_code, refresh_token`,
    )
  }
}

export class InvalidScopeFormatError extends ClientError {
  constructor(scope: string) {
    super(
      "invalid_scope_format",
      `Invalid scope format: ${scope}. Must match pattern: ^[a-zA-Z0-9_:.\\-]+$`,
    )
  }
}

export class InvalidRedirectUriError extends ClientError {
  constructor(uri: string) {
    super("invalid_redirect_uri", `Invalid redirect URI: ${uri}`)
  }
}

export class ClientDisabledError extends ClientError {
  constructor(clientId: string) {
    super("client_disabled", `Client is disabled: ${clientId}`)
  }
}
