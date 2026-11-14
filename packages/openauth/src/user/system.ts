/**
 * System accounts: placeholder users that only label automatic actions
 * (`rbac_user_roles.assigned_by = "user_system"` for the Member role every
 * new account gets). They are never people.
 *
 * - They can never sign in or hold a role. Consumers refuse every way in for
 *   them (`isSystemUser`), and `RBACServiceImpl.assignRoleToUser` refuses to
 *   grant them a role.
 * - Their rows are kept, so existing `assigned_by` references stay valid.
 *
 * `SYSTEM_USER_IDS` is the canonical list: what admin screens hide from the
 * normal user lists (and show in their own read-only view) is exactly this
 * list, so hiding one never hides a risk. `metadata.type = "system"` is also
 * refused at sign-in, which is safe (refusing more never hides anything).
 */

/** The seeded system user (migrations/002_seed.sql). */
export const SYSTEM_USER_ID = "user_system"

/** Every system account id. Admin lists hide exactly these. */
export const SYSTEM_USER_IDS: readonly string[] = [SYSTEM_USER_ID]

/** One of the system account ids. */
export function isSystemUserId(id: unknown): boolean {
  return typeof id === "string" && SYSTEM_USER_IDS.includes(id)
}

/** `metadata.type === "system"`, for metadata as an object or as its stored JSON text. */
export function isSystemMetadata(metadata: unknown): boolean {
  let value = metadata
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return false
    }
  }
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "system"
  )
}

/** A system account, by id or by `metadata.type`. */
export function isSystemUser(
  user: { id?: unknown; metadata?: unknown } | null | undefined,
): boolean {
  if (!user) return false
  return isSystemUserId(user.id) || isSystemMetadata(user.metadata)
}
