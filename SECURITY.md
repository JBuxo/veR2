# Security Policy

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub: **Security → Report a vulnerability** on this repository ([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Please include affected versions, a description of the impact, and the minimal steps to reproduce. We aim to acknowledge reports within 5 business days and to agree on a disclosure timeline with you.

## Supported versions

veR2 is pre-1.0. Only the latest release receives security fixes.

## Scope

Especially interesting:

- Bypassing key validation to read or write inside the reserved namespace (`.ver2/` by default), including through path normalization (`.`/`..`, percent-encoding, Unicode normalization).
- Any path where veR2 reports success but history was lost or altered.
- Credential leakage through logs, error messages or CLI output.

Out of scope: behavior documented as a limitation in the README (for example, direct `DeleteObject` calls made outside veR2), and vulnerabilities in R2 itself (report those to Cloudflare).
