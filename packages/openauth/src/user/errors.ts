export type UserErrorCode =
  | "user_not_found"
  | "user_already_exists"
  | "email_already_exists"
  | "invalid_user_id"
  | "invalid_email"
  | "user_suspended"
  | "user_deleted"
  | "identity_not_found"
  | "identity_already_linked"

export class UserError extends Error {
  constructor(
    public readonly code: UserErrorCode,
    message: string
  ) {
    super(message)
    this.name = "UserError"
  }
}

export class UserValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message)
    this.name = "UserValidationError"
  }
}
