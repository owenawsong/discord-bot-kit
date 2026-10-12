# Security

Do not include tokens, .env, live state, ticket topics or Discord user IDs in public issues. Report vulnerabilities privately through GitHub's private vulnerability reporting when enabled, or email `owen.aw.song@gmail.com`.

The playground is a loopback development tool, not a public service. Bot modules are trusted executable code. Production uses must review bot permissions, storage access and personal-data retention. The included file store supports one process and does not provide database-level distributed transactions.

If a token is exposed, reset it in the Discord Developer Portal. Removing the token from a commit does not revoke it.
