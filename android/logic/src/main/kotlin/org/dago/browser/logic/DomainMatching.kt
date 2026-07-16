package org.dago.browser.logic

/** True if `hostname` is exactly `domain` or a subdomain of it. */
fun matchesDomain(hostname: String, domain: String): Boolean =
    hostname == domain || hostname.endsWith(".$domain")

fun matchesAnyDomain(hostname: String, domains: Collection<String>): Boolean =
    domains.any { matchesDomain(hostname, it) }
