import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
  type Guild,
} from "discord.js";
import type {
  Bot,
  Input,
  Message,
  Modal,
  Permission,
  Port,
  Ticket,
} from "./types.js";
import { execute, Fault } from "./core.js";
import { Store } from "./store.js";
import { validateMessage } from "./messages.js";
import { runAutocomplete } from "./autocomplete.js";
import type { Command } from "./types.js";
export interface DiscordConfig {
  token: string;
  applicationId: string;
  guildId: string;
  supportRoleId?: string;
  statePath: string;
}
export function readConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { tickets?: boolean } = { tickets: true },
): DiscordConfig {
  const required = [
    "DISCORD_TOKEN",
    "DISCORD_APPLICATION_ID",
    "DISCORD_GUILD_ID",
    ...(options.tickets === false ? [] : ["DISCORD_SUPPORT_ROLE_ID"]),
  ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length)
    throw new Error(
      `Missing configuration: ${missing.join(", ")}. Copy .env.example and read docs/DISCORD_SETUP.md.`,
    );
  for (const k of required.slice(1))
    if (!/^\d{17,22}$/.test(env[k]!))
      throw new Error(`${k} must be a Discord snowflake identifier.`);
  if (env.DISCORD_SUPPORT_ROLE_ID === env.DISCORD_GUILD_ID)
    throw new Error(
      "DISCORD_SUPPORT_ROLE_ID must not be the @everyone role (guild ID).",
    );
  return {
    token: env.DISCORD_TOKEN!,
    applicationId: env.DISCORD_APPLICATION_ID!,
    guildId: env.DISCORD_GUILD_ID!,
    supportRoleId: env.DISCORD_SUPPORT_ROLE_ID!,
    statePath: env.GUILDWRIGHT_STATE ?? ".guildwright/live-state.json",
  };
}
export function commandManifest(bot: Bot) {
  function addOptions(builder: any, c: Command) {
    for (const option of [...(c.options ?? [])].sort(
      (a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)),
    )) {
      const common = (builder: any) =>
        builder
          .setName(option.name)
          .setDescription(option.description)
          .setRequired(option.required ?? false);
      if (option.type === "string")
        builder.addStringOption((b: any) => {
          common(b);
          if (option.minLength !== undefined) b.setMinLength(option.minLength);
          if (option.maxLength !== undefined) b.setMaxLength(option.maxLength);
          if (option.choices) b.addChoices(...option.choices);
          if (option.autocomplete) b.setAutocomplete(true);
          return b;
        });
      if (option.type === "number")
        builder.addNumberOption((b: any) => {
          common(b);
          if (option.min !== undefined) b.setMinValue(option.min);
          if (option.max !== undefined) b.setMaxValue(option.max);
          if (option.choices) b.addChoices(...option.choices);
          if (option.autocomplete) b.setAutocomplete(true);
          return b;
        });
      if (option.type === "integer")
        builder.addIntegerOption((b: any) => {
          common(b);
          if (option.min !== undefined) b.setMinValue(option.min);
          if (option.max !== undefined) b.setMaxValue(option.max);
          if (option.choices) b.addChoices(...option.choices);
          if (option.autocomplete) b.setAutocomplete(true);
          return b;
        });
      if (option.type === "boolean")
        builder.addBooleanOption((b: any) => common(b));
      if (option.type === "user") builder.addUserOption((b: any) => common(b));
      if (option.type === "channel")
        builder.addChannelOption((b: any) => common(b));
    }
    return builder;
  }
  const roots = new Map<string, Command[]>();
  for (const c of bot.commands) {
    const name = c.name.split(" ")[0];
    roots.set(name, [...(roots.get(name) ?? []), c]);
  }
  return [...roots].map(([name, commands]) => {
    const root = new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        commands[0].name === name
          ? commands[0].description
          : `${name} commands`,
      )
      .setDMPermission(false);
    const permissions = new Set(commands.map((c) => c.permission));
    if (permissions.size === 1 && commands[0].permission)
      root.setDefaultMemberPermissions(
        PermissionFlagsBits[commands[0].permission],
      );
    if (commands[0].name === name) addOptions(root, commands[0]);
    else {
      const groups = new Map<string, Command[]>();
      for (const c of commands) {
        const parts = c.name.split(" ");
        if (parts.length === 2)
          root.addSubcommand((b) =>
            addOptions(b.setName(parts[1]).setDescription(c.description), c),
          );
        else groups.set(parts[1], [...(groups.get(parts[1]) ?? []), c]);
      }
      for (const [group, children] of groups)
        root.addSubcommandGroup((g) => {
          g.setName(group).setDescription(`${group} commands`);
          for (const c of children)
            g.addSubcommand((b) =>
              addOptions(
                b.setName(c.name.split(" ")[2]).setDescription(c.description),
                c,
              ),
            );
          return g;
        });
    }
    return root.toJSON();
  });
}
export function interactionCommand(interaction: {
  commandName: string;
  options: {
    getSubcommandGroup: (required: false) => string | null;
    getSubcommand: (required: false) => string | null;
    data: readonly any[];
  };
}) {
  const group = interaction.options.getSubcommandGroup(false),
    sub = interaction.options.getSubcommand(false);
  const name = [interaction.commandName, group, sub].filter(Boolean).join(" ");
  let leaves = interaction.options.data;
  while (leaves.length === 1 && leaves[0].options) leaves = leaves[0].options;
  const args: Input["args"] = {};
  for (const option of leaves)
    if (
      option.value !== undefined &&
      ["string", "number", "boolean"].includes(typeof option.value)
    )
      args[option.name] = option.value;
  return { name, args };
}
export async function registerCommands(
  bot: Bot,
  config: DiscordConfig,
  apply = false,
) {
  const body = commandManifest(bot);
  if (!apply) return { apply: false, commands: body };
  await new REST({ version: "10" })
    .setToken(config.token)
    .put(
      Routes.applicationGuildCommands(config.applicationId, config.guildId),
      { body },
    );
  return { apply: true, commands: body };
}
export function discordMessage(message: Message) {
  validateMessage(message);
  const components: ActionRowBuilder<
    ButtonBuilder | StringSelectMenuBuilder
  >[] = [];
  if (message.buttons?.length)
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        message.buttons.map((b) =>
          new ButtonBuilder()
            .setCustomId(b.id)
            .setLabel(b.label)
            .setStyle(
              b.style === "danger"
                ? ButtonStyle.Danger
                : b.style === "primary"
                  ? ButtonStyle.Primary
                  : ButtonStyle.Secondary,
            ),
        ),
      ),
    );
  if (message.select)
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(message.select.id)
          .setPlaceholder(message.select.placeholder)
          .addOptions(message.select.options),
      ),
    );
  const embeds = (message.embeds ?? []).map((e) => {
    const b = new EmbedBuilder();
    if (e.title) b.setTitle(e.title);
    if (e.description) b.setDescription(e.description);
    if (e.url) b.setURL(e.url);
    if (e.color !== undefined) b.setColor(e.color);
    if (e.fields?.length) b.addFields(e.fields);
    if (e.footer) b.setFooter(e.footer);
    if (e.author) b.setAuthor(e.author);
    if (e.thumbnail) b.setThumbnail(e.thumbnail.url);
    if (e.image) b.setImage(e.image.url);
    if (e.timestamp) b.setTimestamp(new Date(e.timestamp));
    return b;
  });
  return {
    content: message.content,
    embeds,
    components,
    allowedMentions: { parse: [] as ("users" | "roles" | "everyone")[] },
    ...(message.ephemeral ? { flags: MessageFlags.Ephemeral as const } : {}),
  };
}
export function discordModal(modal: Modal) {
  return new ModalBuilder()
    .setCustomId(modal.id)
    .setTitle(modal.title)
    .addComponents(
      modal.fields.map((f) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(f.id)
            .setLabel(f.label)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(f.maxLength ?? 1000),
        ),
      ),
    );
}
function marker(t: Ticket) {
  return `guildwright:${t.guildId}:${t.id}:${t.owner}`;
}
async function archive(guild: Guild, ticket: Ticket) {
  const me = await guild.members.fetchMe();
  if (
    !me.permissions.has([
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
    ])
  )
    throw new Error("Archiving requires Manage Channels and Manage Roles");
  if (!ticket.channelId) throw new Error("Missing ticket channel");
  const channel = await guild.channels.fetch(ticket.channelId);
  if (
    !channel ||
    channel.type !== ChannelType.GuildText ||
    channel.topic !== marker(ticket)
  )
    throw new Error(
      "Channel identity mismatch; refusing to modify an unrelated channel",
    );
  await channel.permissionOverwrites.edit(
    ticket.owner,
    { SendMessages: false },
    { type: OverwriteType.Member, reason: "Guildwright ticket closed" },
  );
  await channel.setName(`closed-${ticket.id}`, "Guildwright ticket closed");
}
/** Reconcile already-created channels. Missing or ambiguous effects require an operator; never guess. */
export async function reconcile(guild: Guild, store: Store) {
  const channels = await guild.channels.fetch();
  const report: { ticketId: string; action: string }[] = [];
  for (const ticket of store
    .snapshot()
    .tickets.filter(
      (t) =>
        t.guildId === guild.id &&
        (t.status === "provisioning" || t.status === "closing"),
    )) {
    try {
      if (ticket.status === "closing" && ticket.channelId) {
        await archive(guild, ticket);
        await store.mutate((s) => {
          s.tickets.find((t) => t.id === ticket.id)!.status = "closed";
        });
        report.push({ ticketId: ticket.id, action: "archived and closed" });
        continue;
      }
      const matches = channels.filter(
        (c) => c?.type === ChannelType.GuildText && c.topic === marker(ticket),
      );
      if (matches.size === 1) {
        const channel = matches.first()!;
        await store.mutate((s) => {
          const t = s.tickets.find((t) => t.id === ticket.id)!;
          t.channelId = channel.id;
          t.status = "open";
        });
        report.push({
          ticketId: ticket.id,
          action: "recovered existing channel",
        });
      } else
        report.push({
          ticketId: ticket.id,
          action: `paused: ${matches.size} matching channels; inspect manually before changing the record`,
        });
    } catch {
      report.push({
        ticketId: ticket.id,
        action:
          "paused: channel reconciliation failed; inspect this ticket privately",
      });
    }
  }
  return report;
}
export async function startDiscord(bot: Bot, config: DiscordConfig) {
  const store = new Store(config.statePath);
  store.configure(bot.stateSchemas);
  await store.load();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once("clientReady", async () => {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      console.log(
        JSON.stringify({
          event: "ready",
          bot: bot.name,
          recovery: await reconcile(guild, store),
        }),
      );
    } catch {
      console.error(
        "Startup recovery failed. Inspect configured guild, permissions and state privately.",
      );
    }
  });
  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        if (interaction.guildId !== config.guildId) {
          await interaction.respond([]);
          return;
        }
        const parsed = interactionCommand(interaction);
        const focused = interaction.options.getFocused(true);
        const permissions = (
          Object.keys(PermissionFlagsBits) as Permission[]
        ).filter((p) =>
          interaction.memberPermissions?.has(PermissionFlagsBits[p]),
        );
        const result = await runAutocomplete(
          bot,
          {
            ...parsed,
            option: focused.name,
            value: focused.value,
            actor: {
              id: interaction.user.id,
              name: interaction.user.username,
              permissions,
            },
            guildId: interaction.guildId!,
            ageMs: Math.max(0, Date.now() - interaction.createdTimestamp),
          },
          store,
        );
        await interaction.respond(result.choices);
        return;
      }
      if (
        !interaction.isChatInputCommand() &&
        !interaction.isButton() &&
        !interaction.isModalSubmit() &&
        !interaction.isStringSelectMenu()
      )
        return;
      // The app's other guilds must never mutate the configured deployment state.
      if (interaction.guildId !== config.guildId) {
        await interaction.reply({
          content: "This bot is configured for a different server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const permissions = (
        Object.keys(PermissionFlagsBits) as Permission[]
      ).filter((p) =>
        interaction.memberPermissions?.has(PermissionFlagsBits[p]),
      );
      const fields: Record<string, string> = {};
      if (interaction.isModalSubmit())
        for (const row of interaction.components)
          if ("components" in row)
            for (const component of row.components)
              if (component.type === 4)
                fields[component.customId] = component.value;
      const parsed = interaction.isChatInputCommand()
        ? interactionCommand(interaction)
        : { name: interaction.customId, args: {} };
      const value: Input = {
        id: interaction.id,
        kind: interaction.isChatInputCommand()
          ? "command"
          : interaction.isButton()
            ? "button"
            : interaction.isModalSubmit()
              ? "modal"
              : "select",
        name: parsed.name,
        actor: {
          id: interaction.user.id,
          name: interaction.user.username,
          permissions,
        },
        guildId: interaction.guildId!,
        channelId: interaction.channelId ?? undefined,
        fields,
        args: parsed.args,
        values: interaction.isStringSelectMenu()
          ? interaction.values
          : undefined,
        ageMs: Math.max(0, Date.now() - interaction.createdTimestamp),
      };
      const port = makePort(interaction, client, config);
      const result = await execute(bot, value, store, port);
      console.log(
        JSON.stringify({
          event: "interaction",
          kind: value.kind,
          name: value.name,
          elapsedMs: result.elapsedMs,
          diagnostics: result.diagnostics.map((d) => ({
            code: d.code,
            severity: d.severity,
          })),
        }),
      );
    } catch {
      console.error(
        "Interaction transport failed. Inspect connection, response deadline and permissions privately.",
      );
    }
  });
  client.on("error", () =>
    console.error(
      "Discord client error. Check network and credentials privately.",
    ),
  );
  await client.login(config.token);
  return client;
}
function makePort(
  interaction: Interaction,
  client: Client,
  config: DiscordConfig,
): Port {
  return {
    send: async (type, data) => {
      if (!interaction.isRepliable()) throw new Error("Not repliable");
      if (type === "defer")
        await interaction.deferReply(
          (data as { ephemeral: boolean }).ephemeral
            ? { flags: MessageFlags.Ephemeral }
            : {},
        );
      if (type === "deferUpdate") {
        if (!interaction.isMessageComponent())
          throw new Error("Only message components can defer updates");
        await interaction.deferUpdate();
      }
      if (type === "reply")
        await interaction.reply(discordMessage(data as Message));
      if (type === "edit") {
        const { flags, ...message } = discordMessage(data as Message);
        await interaction.editReply(message);
      }
      if (type === "followup")
        await interaction.followUp(discordMessage(data as Message));
      if (type === "modal") {
        if (
          !interaction.isChatInputCommand() &&
          !interaction.isMessageComponent()
        )
          throw new Error("This interaction cannot open a modal");
        await interaction.showModal(discordModal(data as Modal));
      }
    },
    createTicket: async (ticket) => {
      const guild = await client.guilds.fetch(ticket.guildId);
      const me = await guild.members.fetchMe();
      if (
        !me.permissions.has([
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ])
      )
        throw new Fault(
          "GW_BOT_PERMISSION",
          "The bot lacks required channel permissions.",
          "Grant Manage Channels, Manage Roles, View Channel and Send Messages before retrying.",
        );
      if (!config.supportRoleId || config.supportRoleId === guild.id)
        throw new Fault(
          "GW_SUPPORT_ROLE_MISSING",
          "Configure a support role other than @everyone.",
          "Set DISCORD_SUPPORT_ROLE_ID to a dedicated support role before retrying.",
        );
      if (!(await guild.roles.fetch(config.supportRoleId)))
        throw new Fault(
          "GW_SUPPORT_ROLE_MISSING",
          "The configured support role does not exist.",
          "Correct DISCORD_SUPPORT_ROLE_ID and restart the bot.",
        );
      const overwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: ticket.owner,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: config.supportRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ];
      if (new Set(overwrites.map((o) => o.id)).size !== overwrites.length)
        throw new Fault(
          "GW_SUPPORT_ROLE_MISSING",
          "Ticket visibility principals must be distinct.",
          "Check guild, owner, support-role and bot identifiers.",
        );
      const channel = await guild.channels.create({
        name: ticket.id,
        type: ChannelType.GuildText,
        topic: marker(ticket),
        permissionOverwrites: overwrites,
      });
      const { flags, ...welcome } = discordMessage({
        content: `${ticket.id}\n${ticket.topic}\nThe owner or a moderator can close this ticket.`,
        buttons: [
          {
            id: `ticket:close:${ticket.id}`,
            label: "Close ticket",
            style: "danger",
          },
        ],
      });
      await channel.send(welcome);
      return channel.id;
    },
    closeTicket: async (ticket) => {
      await archive(await client.guilds.fetch(ticket.guildId), ticket);
    },
  };
}
