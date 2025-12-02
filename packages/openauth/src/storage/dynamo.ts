/**
 * Configure OpenAuth to use [DynamoDB](https://aws.amazon.com/dynamodb/) as a storage adapter.
 *
 * ```ts
 * import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"
 *
 * const storage = DynamoStorage({
 *   table: "my-table",
 *   pk: "pk",
 *   sk: "sk"
 * })
 *
 * export default issuer({
 *   storage,
 *   // ...
 * })
 * ```
 *
 * @packageDocumentation
 */

import { client } from "./aws.js"
import { joinKey, joinKeyLegacy, StorageAdapter } from "./storage.js"

/**
 * Configure the DynamoDB table that's created.
 *
 * @example
 * ```ts
 * {
 *   table: "my-table",
 *   pk: "pk",
 *   sk: "sk"
 * }
 * ```
 */
export interface DynamoStorageOptions {
  /**
   * The name of the DynamoDB table.
   */
  table: string
  /**
   * The primary key column name.
   * @default "pk"
   */
  pk?: string
  /**
   * The sort key column name.
   * @default "sk"
   */
  sk?: string
  /**
   * Endpoint URL for the DynamoDB service. Useful for local testing.
   * @default "https://dynamodb.{region}.amazonaws.com"
   */
  endpoint?: string
  /**
   * The name of the time to live attribute.
   * @default "expiry"
   */
  ttl?: string
}

/**
 * Creates a DynamoDB store.
 * @param options - The config for the adapter.
 */
export function DynamoStorage(options: DynamoStorageOptions): StorageAdapter {
  const pk = options.pk || "pk"
  const sk = options.sk || "sk"
  const ttl = options.ttl || "expiry"
  const tableName = options.table

  function parseKey(key: string[], useLegacy = false) {
    const join = useLegacy ? joinKeyLegacy : joinKey
    if (key.length === 2) {
      return {
        pk: key[0],
        sk: key[1],
      }
    }
    return {
      pk: join(key.slice(0, 2)),
      sk: join(key.slice(2)),
    }
  }

  async function dynamo(action: string, payload: any) {
    const c = await client()
    const endpoint =
      options.endpoint || `https://dynamodb.${c.region}.amazonaws.com`
    const response = await c.fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "X-Amz-Target": `DynamoDB_20120810.${action}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`DynamoDB request failed: ${response.statusText}`)
    }

    return response.json() as Promise<any>
  }

  return {
    async get(key: string[]) {
      // Try new format first
      const { pk: keyPk, sk: keySk } = parseKey(key)
      const params = {
        TableName: tableName,
        Key: {
          [pk]: { S: keyPk },
          [sk]: { S: keySk },
        },
      }
      let result = await dynamo("GetItem", params)

      // Fall back to legacy format if not found
      if (!result.Item) {
        const { pk: legacyPk, sk: legacySk } = parseKey(key, true)
        const legacyParams = {
          TableName: tableName,
          Key: {
            [pk]: { S: legacyPk },
            [sk]: { S: legacySk },
          },
        }
        result = await dynamo("GetItem", legacyParams)
      }

      if (!result.Item) return
      if (result.Item[ttl] && result.Item[ttl].N < Date.now() / 1000) {
        return
      }
      return JSON.parse(result.Item.value.S)
    },

    async set(key: string[], value: any, expiry?: Date) {
      const parsed = parseKey(key)
      const params = {
        TableName: tableName,
        Item: {
          [pk]: { S: parsed.pk },
          [sk]: { S: parsed.sk },
          ...(expiry
            ? {
                [ttl]: { N: Math.floor(expiry.getTime() / 1000).toString() },
              }
            : {}),
          value: { S: JSON.stringify(value) },
        },
      }
      await dynamo("PutItem", params)
    },

    async remove(key: string[]) {
      // Remove both new and legacy format keys
      const { pk: keyPk, sk: keySk } = parseKey(key)
      const { pk: legacyPk, sk: legacySk } = parseKey(key, true)

      await Promise.all([
        dynamo("DeleteItem", {
          TableName: tableName,
          Key: {
            [pk]: { S: keyPk },
            [sk]: { S: keySk },
          },
        }),
        dynamo("DeleteItem", {
          TableName: tableName,
          Key: {
            [pk]: { S: legacyPk },
            [sk]: { S: legacySk },
          },
        }),
      ])
    },

    async *scan(
      prefix: string[],
    ): AsyncGenerator<[string[], any], void, unknown> {
      const seenKeys = new Set<string>()
      const now = Date.now() / 1000

      // Helper to run a scan with a specific join function
      async function* scanWithJoin(
        join: typeof joinKey,
      ): AsyncGenerator<[string[], any], void, unknown> {
        const prefixPk =
          prefix.length >= 2 ? join(prefix.slice(0, 2)) : prefix[0]
        const prefixSk = prefix.length > 2 ? join(prefix.slice(2)) : ""
        let lastEvaluatedKey: any = undefined

        while (true) {
          const params = {
            TableName: tableName,
            ExclusiveStartKey: lastEvaluatedKey,
            KeyConditionExpression: prefixSk
              ? `#pk = :pk AND begins_with(#sk, :sk)`
              : `#pk = :pk`,
            ExpressionAttributeNames: {
              "#pk": pk,
              ...(prefixSk && { "#sk": sk }),
            },
            ExpressionAttributeValues: {
              ":pk": { S: prefixPk },
              ...(prefixSk && { ":sk": { S: prefixSk } }),
            },
          }

          const result = await dynamo("Query", params)

          for (const item of result.Items || []) {
            if (item[ttl] && item[ttl].N < now) {
              continue
            }
            const keyStr = JSON.stringify([item[pk].S, item[sk].S])
            if (!seenKeys.has(keyStr)) {
              seenKeys.add(keyStr)
              yield [[item[pk].S, item[sk].S], JSON.parse(item.value.S)] as [
                string[],
                any,
              ]
            }
          }

          if (!result.LastEvaluatedKey) break
          lastEvaluatedKey = result.LastEvaluatedKey
        }
      }

      // Scan with new format
      yield* scanWithJoin(joinKey)

      // Also scan with legacy format for migration
      yield* scanWithJoin(joinKeyLegacy)
    },
  }
}
