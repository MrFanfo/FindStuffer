# Security policy

## Supported versions

Security fixes are applied to the latest published release. Run a versioned
container tag and update promptly when a security release is published.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature:
**Security → Advisories → Report a vulnerability**. Do not include exploit
details, credentials, inventory exports, or private addresses in a public issue.

Include the affected version, deployment method, impact, reproduction steps,
and any proposed mitigation. Maintainers will acknowledge a complete report as
soon as practical.

## Deployment boundary

Findstuff contains private inventory data and administrative actions. Keep it
bound to loopback and publish it through an authenticated private network such
as Tailscale Serve. Docker deployments require an administrator password by
default. Do not expose port 8000 directly to the public internet.
