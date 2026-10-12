# From local workshop to a test guild

Guildwright's local workshop needs no Discord application or credentials. The live adapter uses discord.js, the Guilds gateway intent and your own application. It does not request Message Content or Guild Members privileged intents.

## 1. Create and install an application

Use the [Discord Developer Portal](https://discord.com/developers/applications). Create an application and a bot; store the bot token only in the local `.env`. Install the application into a server you control using the `bot` and `applications.commands` scopes. Choose a dedicated test guild first.

For the ticket recipe grant View Channel, Send Messages, Read Message History, Manage Channels and Manage Roles (needed to edit ticket permission overwrites on closure). Do not grant Administrator. Create a dedicated support role for people who should see tickets; **never use @everyone**, whose role ID equals the guild ID. Guildwright rejects that configuration. Record the application ID, guild ID and support role ID with Developer Mode's Copy ID actions.

The signup recipe only needs View Channel and Send Messages for interaction messages. It does not create channels or edit permission overwrites and does not require a support-role ID. The caller creating/closing managed events uses Manage Guild; the bot does not need that permission to perform those checks.

## 2. Configure locally

Copy `.env.example` to `.env` in your scaffolded bot directory:

```dotenv
DISCORD_TOKEN=your-local-token
DISCORD_APPLICATION_ID=your-application-id
DISCORD_GUILD_ID=your-test-guild-id
DISCORD_SUPPORT_ROLE_ID=your-support-role-id
GUILDWRIGHT_STATE=.guildwright/live-state.json
```

`guildwright doctor` validates required values and identifier formats offline. It cannot validate the token, role, guild membership or effective channel permissions. Never commit `.env`, send a token in a bug report, or put it in browser JavaScript.

## 3. Preview and register commands

```bash
npm run register
# Inspect the command names and default member permissions first.
npm run register -- --apply
```

Applying performs a bulk overwrite of this application's guild commands. It can remove other commands owned by the same application in that guild. Guildwright does not register globally in v0.1.

## 4. Start and verify

```bash
npm start
```

Open `/ticket` as an ordinary member. Verify only that member, the support role, administrators and the bot can see the new channel. A different ordinary member must not be able to close it by invoking a copied component ID. The owner or a member with Manage Channels may close it. Closing disables the owner's Send Messages overwrite and renames the channel; it never deletes the channel. A member with other allowing role overwrites or Administrator may still send messages, so inspect the real server's role structure. Archiving here is a workflow state, not Discord's thread archive feature.

The bot posts a close button inside the private ticket channel, so moderators can use it without seeing the owner's ephemeral response. `/close-ticket` also resolves the ticket from the current guild/channel state and applies the same authorization; it is a fallback if the welcome-message send was interrupted. In the workshop select the simulated ticket channel to exercise this command.

Restart the bot and verify `/status`. Components are routed by current durable state instead of in-memory collectors. Administrators retain Discord's normal permission bypass. Members with Manage Channels who are not in the support role may need View Channel through another role to inspect a private ticket.

## Recovery and storage

The file store atomically commits JSON using a temporary file and rename. Transactions serialize within one process. Run **one bot process per state file** and keep the state on durable local storage. Multiple containers, network filesystems, replicas and distributed locking are outside this store's guarantees; use a transactional database port before scaling.

Before channel creation the bot persists a `provisioning` reservation. If Discord creation times out after potentially succeeding, another interaction cannot create a duplicate ticket. At startup the adapter fetches channels and matches the complete Guildwright topic marker. A single match is adopted; missing or duplicate matches remain paused for operator inspection. Do not remove a reservation until you have checked the remote server for an orphaned channel. Treat markers as operational metadata, not a security boundary; people with Manage Channels can change them.

## Event signup integration

Run `init ../my-event-bot --recipe signups`, install dependencies and use its `.env.example` (three Discord values, no support role). Create an event as a server manager with `/event-create title:Reading group capacity:2`. A public signup card has Join, Leave and Close buttons. Capacity and duplicate checks happen in one durable transaction. Membership/closure edits serialize per event to prevent a slow earlier response overwriting newer counts. Multiple separately posted cards are snapshots until interacted with; use `/event-show` for a fresh card.

Check joins with two real accounts, a full third attempt, a duplicate click, leaving, closure permissions and a stale button after closure. Restart and try the original buttons: handlers resolve IDs through durable state, not collectors. Closed rosters are retained and immutable. `/event-list page:2` paginates five events per response. No calendar scheduling, reminders or attendance tracking is implied.

Closing uses a durable `closing` reservation. Startup retries the archive operation only for a channel whose stored ID and topic match. If recovery fails, inspect the log's codes and the state privately. Back up the state before manual repair. Corrupt/unknown state formats are rejected and left intact.

State contains user IDs and ticket topics. Set a retention policy and restrict access to the deployment directory. Exported local evidence also contains input fields; inspect it before publishing.

## Integration checks before real users

- Actual bot permissions and support-role visibility.
- Two ordinary members, an owner and a moderator.
- Restart during provisioning and closing, plus disconnected network.
- Persistence volume and backup restoration.
- Repeated clicks, missing/deleted channels and modified channel topics.
- Registration changes and graceful shutdown.

Official references: [Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding), [permissions](https://docs.discord.com/developers/topics/permissions), [rate limits](https://docs.discord.com/developers/topics/rate-limits). discord.js manages REST rate limits; Guildwright does not guess fixed retry intervals.
