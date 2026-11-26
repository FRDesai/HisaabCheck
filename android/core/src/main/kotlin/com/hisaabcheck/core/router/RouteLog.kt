package com.hisaabcheck.core.router

import com.hisaabcheck.core.ProcessedBill

/** Same 13 names and order as web/src/core/router/routeLog.ts. */
val ROUTE_LOG_KEYS: List<String>
    get() = TODO("Task 5")

/** Field map for a routeLogs document, without createdAt (the store adds the server timestamp). platform is "android". */
fun toRouteLogFields(p: ProcessedBill, billId: String, shopId: String, caUid: String): Map<String, Any> = TODO("Task 5")
