/**
 * Multi-Region Audit Query Helper
 *
 * Provides utilities to query audit logs across multiple regional D1 instances
 * and merge the results into a unified view.
 *
 * Used by admin dashboards for compliance and security investigations.
 *
 * @packageDocumentation
 */

import type { D1Database } from "@cloudflare/workers-types"
import {
  AuditService,
  type TokenUsageEvent,
  type TokenEventType,
} from "./audit.js"

export interface RegionalD1Config {
  name: string // e.g., "us-east", "eu-west", "apac"
  database: D1Database
  tableName?: string
}

export interface MultiRegionAuditQueryOptions {
  subject?: string
  event_type?: TokenEventType
  client_id?: string
  start_timestamp?: number
  end_timestamp?: number
  limit?: number
  offset?: number
}

/**
 * Query audit logs across multiple regional D1 instances
 * and merge results chronologically
 */
export async function queryMultiRegionAuditLogs(
  regions: RegionalD1Config[],
  options: MultiRegionAuditQueryOptions = {},
): Promise<TokenUsageEvent[]> {
  // Query all regions in parallel
  const regionalResults = await Promise.allSettled(
    regions.map(async (region) => {
      try {
        const auditService = new AuditService({
          database: region.database,
          tableName: region.tableName,
        })

        const logs = await auditService.getAuditLogs(options)

        // Tag each log with source region for debugging
        return logs.map((log) => ({
          ...log,
          _region: region.name,
        }))
      } catch (error) {
        console.error(`Failed to query region ${region.name}:`, error)
        return []
      }
    }),
  )

  // Collect successful results
  const allLogs: (TokenUsageEvent & { _region?: string })[] = []
  for (const result of regionalResults) {
    if (result.status === "fulfilled") {
      allLogs.push(...result.value)
    }
  }

  // Sort by timestamp (newest first)
  allLogs.sort((a, b) => b.timestamp - a.timestamp)

  // Apply global limit
  const limit = options.limit || 100
  return allLogs.slice(0, limit)
}

/**
 * Get token analytics across all regions for a subject
 */
export async function getMultiRegionTokenAnalytics(
  regions: RegionalD1Config[],
  subject: string,
  limit = 100,
): Promise<TokenUsageEvent[]> {
  const regionalResults = await Promise.allSettled(
    regions.map(async (region) => {
      try {
        const auditService = new AuditService({
          database: region.database,
          tableName: region.tableName,
        })

        const analytics = await auditService.getTokenAnalytics(subject, limit)

        return analytics.map((log) => ({
          ...log,
          _region: region.name,
        }))
      } catch (error) {
        console.error(
          `Failed to get analytics from region ${region.name}:`,
          error,
        )
        return []
      }
    }),
  )

  const allAnalytics: (TokenUsageEvent & { _region?: string })[] = []
  for (const result of regionalResults) {
    if (result.status === "fulfilled") {
      allAnalytics.push(...result.value)
    }
  }

  allAnalytics.sort((a, b) => b.timestamp - a.timestamp)
  return allAnalytics.slice(0, limit)
}

/**
 * Get token family history across all regions
 */
export async function getMultiRegionTokenFamily(
  regions: RegionalD1Config[],
  tokenId: string,
  limit = 50,
): Promise<TokenUsageEvent[]> {
  const regionalResults = await Promise.allSettled(
    regions.map(async (region) => {
      try {
        const auditService = new AuditService({
          database: region.database,
          tableName: region.tableName,
        })

        const family = await auditService.getTokenFamily(tokenId, limit)

        return family.map((log) => ({
          ...log,
          _region: region.name,
        }))
      } catch (error) {
        console.error(
          `Failed to get token family from region ${region.name}:`,
          error,
        )
        return []
      }
    }),
  )

  const allFamily: (TokenUsageEvent & { _region?: string })[] = []
  for (const result of regionalResults) {
    if (result.status === "fulfilled") {
      allFamily.push(...result.value)
    }
  }

  // Sort by timestamp (oldest first for family history)
  allFamily.sort((a, b) => a.timestamp - b.timestamp)
  return allFamily.slice(0, limit)
}

/**
 * Aggregate statistics across all regions
 */
export interface AuditStatistics {
  total_events: number
  by_event_type: Record<TokenEventType, number>
  by_region: Record<string, number>
  time_range: {
    earliest: number
    latest: number
  }
}

export async function getMultiRegionStatistics(
  regions: RegionalD1Config[],
  options: {
    subject?: string
    start_timestamp?: number
    end_timestamp?: number
  } = {},
): Promise<AuditStatistics> {
  const allLogs = await queryMultiRegionAuditLogs(regions, {
    ...options,
    limit: 10000, // Get all for stats
  })

  const stats: AuditStatistics = {
    total_events: allLogs.length,
    by_event_type: {
      generated: 0,
      refreshed: 0,
      revoked: 0,
      reused: 0,
    },
    by_region: {},
    time_range: {
      earliest: allLogs.length > 0 ? allLogs[allLogs.length - 1].timestamp : 0,
      latest: allLogs.length > 0 ? allLogs[0].timestamp : 0,
    },
  }

  for (const log of allLogs) {
    // Count by event type
    stats.by_event_type[log.event_type]++

    // Count by region
    const region = (log as any)._region || "unknown"
    stats.by_region[region] = (stats.by_region[region] || 0) + 1
  }

  return stats
}
