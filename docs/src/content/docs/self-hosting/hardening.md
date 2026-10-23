---
title: Security hardening
description: A checklist for running opendesk securely on your own infrastructure.
---

opendesk ships with secure defaults. This checklist covers what is up to you as the operator.

## Before going live

- `OPENDESK_ENV=production`. This turns on the boot checks for secrets.
- `AUTH_SECRET` and `CREDENTIALS_KEY` are random, 32 bytes or more, and backed up somewhere private.
- The site is served over HTTPS only. Caddy handles certificates and redirects.
- `SIGNUP_ENABLED=false` once your team has accounts. People you invite can still join.
- Platform email (`MAIL_DRIVER`) is configured, so password resets work.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` are set if the instance is on the public internet.

## Network

- Expose only ports 80 and 443 (and 25 if you use the built-in SMTP receiver).
- Keep Postgres, NATS (`NATS_LISTEN`) and the gateway's port on the private network. When embedded NATS must listen beyond localhost, set `NATS_TOKEN`; production refuses to boot without it.
- Behind a proxy of your own, set `TRUSTED_PROXY_HOPS` to the number of proxies that append to `X-Forwarded-For`, and publish opendesk's ports only to them, so client IPs used for rate limits and audit logs cannot be spoofed. `TRUST_PROXY=true` is only for a proxy that sets the headers itself, like the bundled Caddy. See [Your own reverse proxy](/self-hosting/reverse-proxy/#client-addresses).
- Set `CHECK_ORIGINS` on the gateway to the origin of your opendesk web app. The chat widget uses its own endpoint, which takes only widget tokens.
- Set the widget's allowed origins in settings.

## Secrets

- `.env` is mode `0600`. Keep it that way, and keep backups private.
- Rotate OAuth client secrets before they expire (Microsoft secrets have a fixed lifetime).
- Rotate `INBOUND_SECRET` in opendesk and the Email Worker together.
- Replace `CREDENTIALS_KEY` only as described in [Replace CREDENTIALS_KEY](#replace-credentials_key), with the old key in `CREDENTIALS_KEY_PREVIOUS` until everything is encrypted with the new one. A new key set on its own leaves every stored credential unreadable.

## Replace CREDENTIALS_KEY

`CREDENTIALS_KEY` encrypts what opendesk stores to reach other services and to check who is who: mailbox passwords and OAuth tokens, Collab mail accounts, webhook signing secrets, widget secrets, two-factor (TOTP) secrets, your own AI provider keys, integration, MCP server and import credentials, Slack, Discord and Telegram connections, invitation links and the addresses of phones and browsers that get notifications.

opendesk encrypts with `CREDENTIALS_KEY` and decrypts with it or with any key in `CREDENTIALS_KEY_PREVIOUS`. While `CREDENTIALS_KEY_PREVIOUS` is set, a background pass encrypts every stored value again with `CREDENTIALS_KEY`: right after start, then every 15 minutes. One pass runs at a time, however many workers you run. It writes a value back only if nobody changed it in the meantime, and it never changes a value it cannot decrypt. Stopping it halfway is safe: the next pass skips what is already done.

### Routine replacement

1. Take a backup: `/opt/opendesk/opendesk-ctl backup`.
2. Generate a new key: `openssl rand -hex 32`.
3. In `/opt/opendesk/.env`, move the current key to `CREDENTIALS_KEY_PREVIOUS` and put the new one in `CREDENTIALS_KEY`:

   ```sh
   CREDENTIALS_KEY=<the new key>
   CREDENTIALS_KEY_PREVIOUS=<the old key>
   ```

   To list several old keys, separate them with commas.
4. Run `/opt/opendesk/opendesk-ctl start`. New values are encrypted with the new key from now on.
5. Watch the logs with `/opt/opendesk/opendesk-ctl logs opendesk`. Each pass logs `credentials key rotation pass` with counts, never values. Wait for:

   ```
   every stored value opens with CREDENTIALS_KEY: CREDENTIALS_KEY_PREVIOUS can be removed
   ```

6. Remove `CREDENTIALS_KEY_PREVIOUS` from `.env` and run `opendesk-ctl start` again.
7. Take a fresh backup, and keep the old key with the backups that still need it (see [Backups and older keys](#backups-and-older-keys)).

If a pass logs `sealed value opens with no configured key`, that value (named by table, column and row id) was encrypted with a key in neither variable. Add that key to `CREDENTIALS_KEY_PREVIOUS` if you still have it. Otherwise reconnect or recreate what the row belongs to, as in the table below.

To go back before step 6, swap the two values again: the pass then moves everything back to the old key.

With [several opendesk instances](/self-hosting/scaling/), every instance needs the same two values, and each must be able to decrypt what the others write while they restart one by one. Do it in two rounds: first add the new key to `CREDENTIALS_KEY_PREVIOUS` everywhere, keeping `CREDENTIALS_KEY` as it is, and restart every instance; then swap the two keys and restart every instance again. Wait for the log line after the second round.

### If the key may have leaked

Replacing the key protects stored values from someone who has the old key but not the data: once the pass is done, nothing in the database opens with the old key. Anyone who had the key and a copy of the database at the same time could decrypt every stored secret, and a new key cannot undo that. A backup from `opendesk-ctl backup` holds both, since it keeps `env` next to `db.dump`.

1. Replace the key as above, right away.
2. `.env` holds more than this key. If it leaked, replace its other secrets too: `AUTH_SECRET` (in opendesk and the realtime gateway together; it signs every session token, and it also keys two-factor recovery codes, notification keys and the values opendesk writes into outgoing mail to match replies, so members generate new recovery codes, browsers turn notifications on again and some replies to earlier mail may not be matched to their ticket), `INBOUND_SECRET` with the Email Worker, `NATS_TOKEN`, `POSTGRES_PASSWORD`, the SMTP password and the OAuth client secrets of your [OAuth apps](/self-hosting/oauth-apps/).
3. If the database or a backup may have leaked along with the key, change every stored secret at its source, because copies of them may already be decrypted:

| What | What to do |
| --- | --- |
| Mailboxes connected with Google or Microsoft | Remove opendesk's access in the Google account or in Microsoft (for work accounts, the Entra admin center), then reconnect the mailbox. See [Google](/guides/mailboxes/google/#disconnect) and [Microsoft](/guides/mailboxes/microsoft/#disconnect). |
| Mailboxes connected over SMTP or IMAP | Change the password or app password at the provider, then enter the new one on the mailbox. See [IMAP and SMTP](/guides/mailboxes/imap-smtp/). |
| Collab mail accounts | The same as mailboxes: remove the access or change the password at the provider, then connect the account again. |
| Webhooks | Create a new endpoint (it gets a new signing secret), move your receiver to it, then delete the old one. See [Webhooks](/api/webhooks/). |
| Widget secrets | **Rotate secret** on each widget and update your server. See [Identity verification](/guides/live-chat/identity-verification/). |
| Your own AI provider key | Create a new key at the provider, save it in **Settings, AI, Provider**, then revoke the old one. See [Your own provider key](/guides/ai/#your-own-provider-key). |
| Integrations and MCP servers | Revoke the token or the app's access at the product, then connect again. See [Integrations](/guides/integrations/). |
| Slack, Discord and Telegram | Reset the bot token or app credentials at the platform, then connect the channel again. |
| Imports | Revoke the API token you gave the import at the helpdesk it came from. See [Importing](/guides/importing/). |
| Two-factor authentication | Each member turns two-factor authentication off and on again, with a new entry in their authenticator app. See [Two-factor authentication](/guides/teams-and-roles/#two-factor-authentication). |
| Invitations | Revoke pending invitations and invite those people again. |
| Phones and browsers that get notifications | They belong to sessions: ending a session removes them. See [Sessions](/guides/teams-and-roles/#sessions). |

### Backups and older keys

A backup's data stays encrypted with the keys the instance had when it was taken. Keep each old key for as long as you keep backups that need it, stored with those backups.

- To restore a backup taken with another key, either restore its `env` as well, or keep your current `.env` and add the backup's `CREDENTIALS_KEY` to `CREDENTIALS_KEY_PREVIOUS`. The pass then encrypts the restored values with your current key.
- Restoring a backup from before a leak brings back the credentials it held, including ones you have since changed. After such a restore, go through the table above again, even for what you already changed before the restore.

## Accounts

- Turn on two-factor authentication for every owner and admin. Owner-level operations require it.
- Review members and API keys regularly, and give API keys only the scopes they need, with an expiry.
- Review the audit log (**Settings → Audit log**) for logins, failed logins, two-factor changes, role changes and API key, webhook and mailbox changes.

## Updates

- Upgrade promptly when a release mentions security fixes: `opendesk-ctl upgrade`.
- Keep the host OS and Docker patched.
- Watch [security advisories](https://github.com/useopendesk/opendesk/security/advisories) on GitHub.

## What opendesk does for you

- Passwords hashed with Argon2id, checked against a breached list, 12 to 128 characters.
- Sign-in rate limited per IP and per account, with uniform responses for unknown users.
- Mailbox credentials, OAuth tokens, webhook and TOTP secrets encrypted with AES-GCM.
- Security headers on every response, sanitized HTML, and webhook URLs restricted to public HTTPS targets.
- No secrets, tokens or request bodies in logs.

See [Security controls](/security/) for the full list.
