# Threat Model (alpha, read this before trusting Dago with anything sensitive)

This is an honest account of what the current alpha does and does not
protect against. Dago is early-stage software built on a limited budget by a
small team - it has **not** been independently security-audited, and none of
the claims below should be treated as a guarantee.

## What Dago currently defends against

- **Network eavesdroppers / your ISP** - when Tor is installed and running,
  tab traffic is routed through the Tor network, hiding browsing destinations
  from your local network and ISP the same way Tor Browser does.
- **Cross-tab tracking via shared circuits** - each tab gets its own isolated
  Tor `SocksPort`/circuit rather than sharing one, and each tab's
  cookies/storage live in a non-persistent, per-tab session that's wiped when
  the tab closes.
- **Common commercial trackers and ad networks** - blocked at the network
  request level (see `src/main/adblock.js`).
- **Casual canvas/WebGL/timezone fingerprinting scripts** - given noisy or
  normalized values instead of your real hardware/timezone signature.
- **Local disk snooping of history** - history is encrypted at rest via the
  OS keychain; viewing it in-app additionally requires a PIN.
- **Being pulled into an unwanted video/voice call** - the camera can't be
  activated by any site or script, in this browser, by design.

## What Dago does NOT currently defend against (known gaps)

- **A global network adversary** - like Tor itself, Dago cannot prevent an
  attacker who can observe both your entry and exit traffic from correlating
  it. "More private than Tor" refers to the additional application-layer
  protections (tracker blocking, fingerprint resistance, per-tab circuit
  isolation) layered on top of onion routing - it is not a claim about
  defeating traffic correlation, which no browser can do alone.
- **Sophisticated fingerprinting** - the JS-level patches in
  `privacy-preload.js` are a best-effort deterrent, not equivalent to
  Tor Browser's years of engine-level hardening (letterboxing, font
  restrictions, etc.) or an anti-fingerprinting audit. Treat this as
  "raises the cost," not "makes you unfingerprintable."
- **Compromise of your own device** - malware, keyloggers, or physical
  access defeat any browser-level protection, including the PIN gate (which
  protects against casual/shoulder-surfing access to history, not a
  determined local attacker with root/admin access).
- **Screenshare metadata** - the signaling server sees room codes and
  connection timing (not video content); the WebRTC connection itself, like
  any P2P call, can reveal your public IP address to the other peer unless
  you're both routed through Tor or a TURN relay (not yet integrated - see
  roadmap).
- **Supply-chain trust** - Dago is unaudited alpha software. Review the
  source yourself before relying on it, especially the privacy-preload and
  Tor integration code.

If your safety depends on strong anonymity (e.g. journalism, activism under
surveillance), use the mature, audited **Tor Browser** today. Dago's goal is
to eventually meet or exceed that bar, but it isn't there yet.
