package com.hisaabcheck.core.router

import com.hisaabcheck.core.ProcessedBill

/** Same 13 names and order as web/src/core/router/routeLog.ts. */
val ROUTE_LOG_KEYS: List<String> = listOf(
    "billId", "shopId", "caUid", "platform", "path", "reason", "piiMasked", "piiTypes",
    "latencyMs", "estCostUsd", "modelName", "promptVersion", "createdAt",
)

/**
 * Field map for a routeLogs document, without createdAt (the store adds the server timestamp). platform is "android".
 * Port of toRouteLog: counts and types only, never bill content. Types match the Firestore rules: piiMasked is an Int,
 * latencyMs a Long, estCostUsd a Double, piiTypes a list of enum names, the rest strings (path and reason as wire strings).
 */
fun toRouteLogFields(p: ProcessedBill, billId: String, shopId: String, caUid: String): Map<String, Any> = linkedMapOf(
    "billId" to billId,
    "shopId" to shopId,
    "caUid" to caUid,
    "platform" to "android",
    "path" to p.route.path.wire,
    "reason" to p.route.reason.wire,
    "piiMasked" to p.piiMasked,
    "piiTypes" to p.piiTypes.map { it.name },
    "latencyMs" to p.latencyMs,
    "estCostUsd" to p.estCostUsd,
    "modelName" to p.route.modelName,
    "promptVersion" to p.route.promptVersion,
)
