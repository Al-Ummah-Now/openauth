import type { StorageAdapter } from "../storage/storage.js"
import type {
  User,
  UserIdentity,
  UserWithIdentities,
  CreateUserParams,
  UpdateUserParams,
  ListUsersParams,
  ListUsersResponse,
  RevokeSessionsResponse,
  SuspendUserResponse,
} from "./types.js"
import { USER_STORAGE_KEYS } from "./types.js"
import { UserError } from "./errors.js"
import type { D1UserAdapter } from "./d1-adapter.js"

export interface UserService {
  createUser(tenantId: string, params: CreateUserParams): Promise<User>
  getUser(tenantId: string, userId: string): Promise<User | null>
  getUserWithIdentities(
    tenantId: string,
    userId: string,
  ): Promise<UserWithIdentities | null>
  getUserByEmail(tenantId: string, email: string): Promise<User | null>
  updateUser(
    tenantId: string,
    userId: string,
    params: UpdateUserParams,
  ): Promise<User>
  deleteUser(tenantId: string, userId: string): Promise<void>
  listUsers(
    tenantId: string,
    params?: ListUsersParams,
  ): Promise<ListUsersResponse>
  suspendUser(tenantId: string, userId: string): Promise<SuspendUserResponse>
  unsuspendUser(tenantId: string, userId: string): Promise<User>
  revokeUserSessions(
    tenantId: string,
    userId: string,
  ): Promise<RevokeSessionsResponse>
  getUserIdentities(tenantId: string, userId: string): Promise<UserIdentity[]>
  linkIdentity(
    tenantId: string,
    userId: string,
    identity: Omit<UserIdentity, "id" | "user_id" | "tenant_id" | "created_at">,
  ): Promise<UserIdentity>
  unlinkIdentity(
    tenantId: string,
    userId: string,
    identityId: string,
  ): Promise<void>
  updateLastLogin(tenantId: string, userId: string): Promise<void>
  /** Force user to reset password on next login */
  forcePasswordReset(tenantId: string, userId: string): Promise<User>
  /** Clear the password reset required flag */
  clearPasswordResetRequired(tenantId: string, userId: string): Promise<User>
}

export interface UserServiceConfig {
  storage: StorageAdapter
  d1Adapter?: D1UserAdapter
}

export class UserServiceImpl implements UserService {
  private readonly storage: StorageAdapter
  private readonly d1Adapter: D1UserAdapter | undefined

  constructor(config: UserServiceConfig) {
    this.storage = config.storage
    this.d1Adapter = config.d1Adapter
  }

  async createUser(tenantId: string, params: CreateUserParams): Promise<User> {
    const { email, name, metadata } = params
    const normalizedEmail = email.toLowerCase().trim()

    const existingUser = await this.getUserByEmail(tenantId, normalizedEmail)
    if (existingUser) {
      throw new UserError(
        "email_already_exists",
        `Email '${normalizedEmail}' is already registered`,
      )
    }

    const now = Date.now()
    const userId = `usr_${crypto.randomUUID().replace(/-/g, "")}`

    const user: User = {
      id: userId,
      tenant_id: tenantId,
      email: normalizedEmail,
      name: name?.trim() || null,
      metadata: metadata || null,
      status: "active",
      created_at: now,
      updated_at: now,
      last_login_at: null,
      deleted_at: null,
      password_reset_required: false,
    }

    await this.storage.set(USER_STORAGE_KEYS.user(tenantId, userId), user)
    await this.storage.set(USER_STORAGE_KEYS.email(tenantId, normalizedEmail), {
      userId,
    })

    if (this.d1Adapter) {
      await this.d1Adapter.createUser(user)
    }

    return user
  }

  async getUser(tenantId: string, userId: string): Promise<User | null> {
    const user = await this.storage.get(
      USER_STORAGE_KEYS.user(tenantId, userId),
    )
    if (!user) return null
    const typedUser = user as User
    if (typedUser.deleted_at !== null) return null
    return typedUser
  }

  async getUserWithIdentities(
    tenantId: string,
    userId: string,
  ): Promise<UserWithIdentities | null> {
    const user = await this.getUser(tenantId, userId)
    if (!user) return null
    const identities = await this.getUserIdentities(tenantId, userId)
    return { ...user, identities }
  }

  async getUserByEmail(tenantId: string, email: string): Promise<User | null> {
    const normalizedEmail = email.toLowerCase().trim()
    const lookup = await this.storage.get(
      USER_STORAGE_KEYS.email(tenantId, normalizedEmail),
    )
    if (!lookup) return null
    return this.getUser(tenantId, (lookup as { userId: string }).userId)
  }

  async updateUser(
    tenantId: string,
    userId: string,
    params: UpdateUserParams,
  ): Promise<User> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }
    if (existingUser.status === "deleted") {
      throw new UserError("user_deleted", "Cannot update a deleted user")
    }

    const oldEmail = existingUser.email
    let newEmail =
      params.email !== undefined ? params.email.toLowerCase().trim() : oldEmail

    if (newEmail !== oldEmail) {
      const emailConflict = await this.getUserByEmail(tenantId, newEmail)
      if (emailConflict && emailConflict.id !== userId) {
        throw new UserError(
          "email_already_exists",
          `Email '${newEmail}' is already registered`,
        )
      }
    }

    const updatedUser: User = {
      ...existingUser,
      email: newEmail,
      name: params.name !== undefined ? params.name : existingUser.name,
      metadata:
        params.metadata !== undefined ? params.metadata : existingUser.metadata,
      updated_at: Date.now(),
    }

    if (oldEmail !== newEmail) {
      await this.storage.remove(USER_STORAGE_KEYS.email(tenantId, oldEmail))
      await this.storage.set(USER_STORAGE_KEYS.email(tenantId, newEmail), {
        userId,
      })
    }

    await this.storage.set(
      USER_STORAGE_KEYS.user(tenantId, userId),
      updatedUser,
    )

    if (this.d1Adapter) {
      await this.d1Adapter.updateUser(updatedUser)
    }

    return updatedUser
  }

  async deleteUser(tenantId: string, userId: string): Promise<void> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }

    const now = Date.now()
    const deletedUser: User = {
      ...existingUser,
      status: "deleted",
      deleted_at: now,
      updated_at: now,
    }

    await this.storage.remove(
      USER_STORAGE_KEYS.email(tenantId, existingUser.email),
    )
    await this.storage.set(
      USER_STORAGE_KEYS.user(tenantId, userId),
      deletedUser,
    )

    if (this.d1Adapter) {
      await this.d1Adapter.softDeleteUser(tenantId, userId, now)
      await this.d1Adapter.revokeAllUserSessions(tenantId, userId)
    }
  }

  async listUsers(
    tenantId: string,
    params?: ListUsersParams,
  ): Promise<ListUsersResponse> {
    if (this.d1Adapter) {
      return this.d1Adapter.listUsers(tenantId, params || {})
    }
    // KV fallback implementation would go here
    return { users: [], next_cursor: null, has_more: false }
  }

  async suspendUser(
    tenantId: string,
    userId: string,
  ): Promise<SuspendUserResponse> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }
    if (existingUser.status === "deleted") {
      throw new UserError("user_deleted", "Cannot suspend a deleted user")
    }
    if (existingUser.status === "suspended") {
      return { user: existingUser, revoked_sessions: 0 }
    }

    const updatedUser: User = {
      ...existingUser,
      status: "suspended",
      updated_at: Date.now(),
    }

    await this.storage.set(
      USER_STORAGE_KEYS.user(tenantId, userId),
      updatedUser,
    )

    let revokedSessions = 0
    if (this.d1Adapter) {
      await this.d1Adapter.updateUserStatus(tenantId, userId, "suspended")
      const result = await this.d1Adapter.revokeAllUserSessions(
        tenantId,
        userId,
      )
      revokedSessions = result.deletedCount
    }

    return { user: updatedUser, revoked_sessions: revokedSessions }
  }

  async unsuspendUser(tenantId: string, userId: string): Promise<User> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }
    if (existingUser.status !== "suspended") {
      throw new UserError("user_not_found", "User is not suspended")
    }

    const updatedUser: User = {
      ...existingUser,
      status: "active",
      updated_at: Date.now(),
    }

    await this.storage.set(
      USER_STORAGE_KEYS.user(tenantId, userId),
      updatedUser,
    )

    if (this.d1Adapter) {
      await this.d1Adapter.updateUserStatus(tenantId, userId, "active")
    }

    return updatedUser
  }

  async revokeUserSessions(
    tenantId: string,
    userId: string,
  ): Promise<RevokeSessionsResponse> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }

    let revokedCount = 0
    if (this.d1Adapter) {
      const result = await this.d1Adapter.revokeAllUserSessions(
        tenantId,
        userId,
      )
      revokedCount = result.deletedCount
    }

    return { revoked_count: revokedCount }
  }

  async getUserIdentities(
    tenantId: string,
    userId: string,
  ): Promise<UserIdentity[]> {
    if (this.d1Adapter) {
      return this.d1Adapter.getUserIdentities(tenantId, userId)
    }
    return []
  }

  async linkIdentity(
    tenantId: string,
    userId: string,
    identity: Omit<UserIdentity, "id" | "user_id" | "tenant_id" | "created_at">,
  ): Promise<UserIdentity> {
    const user = await this.getUser(tenantId, userId)
    if (!user) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }

    const existingIdentity = await this.storage.get(
      USER_STORAGE_KEYS.identity(
        tenantId,
        identity.provider,
        identity.provider_user_id,
      ),
    )
    if (existingIdentity) {
      throw new UserError(
        "identity_already_linked",
        `Identity ${identity.provider}:${identity.provider_user_id} is already linked`,
      )
    }

    const newIdentity: UserIdentity = {
      id: `idt_${crypto.randomUUID().replace(/-/g, "")}`,
      user_id: userId,
      tenant_id: tenantId,
      provider: identity.provider,
      provider_user_id: identity.provider_user_id,
      provider_data: identity.provider_data,
      created_at: Date.now(),
    }

    await this.storage.set(
      USER_STORAGE_KEYS.identity(
        tenantId,
        identity.provider,
        identity.provider_user_id,
      ),
      newIdentity,
    )

    if (this.d1Adapter) {
      await this.d1Adapter.createIdentity(newIdentity)
    }

    return newIdentity
  }

  async unlinkIdentity(
    tenantId: string,
    userId: string,
    identityId: string,
  ): Promise<void> {
    if (this.d1Adapter) {
      const identity = await this.d1Adapter.getIdentity(tenantId, identityId)
      if (!identity || identity.user_id !== userId) {
        throw new UserError(
          "identity_not_found",
          `Identity '${identityId}' not found`,
        )
      }
      await this.storage.remove(
        USER_STORAGE_KEYS.identity(
          tenantId,
          identity.provider,
          identity.provider_user_id,
        ),
      )
      await this.d1Adapter.deleteIdentity(tenantId, identityId)
    }
  }

  async updateLastLogin(tenantId: string, userId: string): Promise<void> {
    const user = await this.getUser(tenantId, userId)
    if (!user) return

    const updatedUser: User = { ...user, last_login_at: Date.now() }
    await this.storage.set(
      USER_STORAGE_KEYS.user(tenantId, userId),
      updatedUser,
    )

    if (this.d1Adapter) {
      await this.d1Adapter.updateLastLogin(tenantId, userId)
    }
  }

  async forcePasswordReset(tenantId: string, userId: string): Promise<User> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }
    if (existingUser.status === "deleted") {
      throw new UserError(
        "user_deleted",
        "Cannot force password reset for a deleted user",
      )
    }

    const updatedUser: User = {
      ...existingUser,
      password_reset_required: true,
      updated_at: Date.now(),
    }

    await this.storage.set(
      USER_STORAGE_KEYS.user(tenantId, userId),
      updatedUser,
    )

    if (this.d1Adapter) {
      await this.d1Adapter.setPasswordResetRequired(tenantId, userId, true)
    }

    return updatedUser
  }

  async clearPasswordResetRequired(
    tenantId: string,
    userId: string,
  ): Promise<User> {
    const existingUser = await this.getUser(tenantId, userId)
    if (!existingUser) {
      throw new UserError("user_not_found", `User '${userId}' not found`)
    }

    const updatedUser: User = {
      ...existingUser,
      password_reset_required: false,
      updated_at: Date.now(),
    }

    await this.storage.set(
      USER_STORAGE_KEYS.user(tenantId, userId),
      updatedUser,
    )

    if (this.d1Adapter) {
      await this.d1Adapter.setPasswordResetRequired(tenantId, userId, false)
    }

    return updatedUser
  }
}

export function createUserService(config: UserServiceConfig): UserService {
  return new UserServiceImpl(config)
}
