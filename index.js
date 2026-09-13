const express = require('express');

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  Events,
  EmbedBuilder,
  MessageFlags,
  AuditLogEvent
} = require('discord.js');

// ================================================================
// 1. EXPRESS SERVER
// ================================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('KyngMod Bot is Online!');
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`[Express] Listening on port ${PORT}`);
});

// ================================================================
// 2. GITHUB GIST STORAGE
// ================================================================

let settingsCache = {};

async function loadSettings() {
  try {
    if (!process.env.GIST_ID || !process.env.GITHUB_TOKEN) {
      console.warn(
        '[Gist] GIST_ID or GITHUB_TOKEN is missing. Settings will not persist.'
      );
      return {};
    }

    const response = await fetch(
      `https://api.github.com/gists/${process.env.GIST_ID}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'User-Agent': 'KyngMod-Bot'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    const content = data.files?.['settings.json']?.content;

    settingsCache = content ? JSON.parse(content) : {};

    console.log('[Gist] Settings loaded successfully.');

    return settingsCache;
  } catch (error) {
    console.error('[Gist Load Error]', error.message);
    return settingsCache;
  }
}

async function saveSettings(newSettings) {
  settingsCache = newSettings;

  try {
    if (!process.env.GIST_ID || !process.env.GITHUB_TOKEN) {
      return;
    }

    const response = await fetch(
      `https://api.github.com/gists/${process.env.GIST_ID}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'KyngMod-Bot'
        },
        body: JSON.stringify({
          files: {
            'settings.json': {
              content: JSON.stringify(settingsCache, null, 2)
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    console.log('[Gist] Settings saved successfully.');
  } catch (error) {
    console.error('[Gist Save Error]', error.message);
  }
}

// ================================================================
// 3. DISCORD CLIENT
// ================================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ================================================================
// 4. OWNER IDS
// ================================================================

const OWNER_IDS = new Set([
  '1255536194159247437',
  '1222291103974428814'
]);

function isOwner(userId) {
  return OWNER_IDS.has(userId);
}

// ================================================================
// 5. GENERAL HELPERS
// ================================================================

function truncate(value, max = 1000) {
  if (value === null || value === undefined || value === '') {
    return '*Unavailable*';
  }

  const text = String(value);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}

function ensureGuildConfig(guildId) {
  if (!settingsCache[guildId]) {
    settingsCache[guildId] = {};
  }

  if (!Array.isArray(settingsCache[guildId].adminRoleIds)) {
    settingsCache[guildId].adminRoleIds = [];
  }

  if (!settingsCache[guildId].warnings) {
    settingsCache[guildId].warnings = {};
  }

  return settingsCache[guildId];
}

function isAdmin(interaction) {
  if (isOwner(interaction.user.id)) {
    return true;
  }

  if (
    interaction.member?.permissions?.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  const config = ensureGuildConfig(interaction.guild.id);

  if (
    config.adminRoleId &&
    interaction.member.roles.cache.has(config.adminRoleId)
  ) {
    return true;
  }

  return config.adminRoleIds.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );
}

// ================================================================
// 6. LOGGING
// ================================================================

async function sendLog(guild, embed) {
  try {
    const config = settingsCache[guild.id];

    if (!config?.logChannelId) {
      return;
    }

    const channel = guild.channels.cache.get(config.logChannelId);

    if (!channel || !channel.isTextBased()) {
      return;
    }

    await channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.error('[Log Error]', error.message);
  }
}

async function logEvent(
  guild,
  title,
  fields = [],
  color = '#5865F2'
) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(fields)
    .setColor(color)
    .setTimestamp();

  await sendLog(guild, embed);
}

async function getAuditExecutor(guild, type, targetId) {
  try {
    const auditLogs = await guild.fetchAuditLogs({
      type,
      limit: 10
    });

    const entry = auditLogs.entries.find(entry => {
      return (
        entry.target?.id === targetId &&
        Date.now() - entry.createdTimestamp < 15000
      );
    });

    return entry?.executor || null;
  } catch {
    return null;
  }
}

// ================================================================
// 7. SLASH COMMANDS
// ================================================================

const commands = [

  // --------------------------------------------------------------
  // /setlogs
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('Set the moderation logging channel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where logs should be sent')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  // --------------------------------------------------------------
  // /setadmin
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('setadmin')
    .setDescription('Set the main bot admin role')
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role that can use bot admin functions')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  // --------------------------------------------------------------
  // /adminrole
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('adminrole')
    .setDescription('Manage multiple bot admin roles')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add an admin role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to add')
            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName('del')
        .setDescription('Remove an admin role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to remove')
            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List configured admin roles')
    ),

  // --------------------------------------------------------------
  // /warn
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Manage user warnings')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Issue a warning')
        .addUserOption(option =>
          option
            .setName('target')
            .setDescription('User to warn')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('reason')
            .setDescription('Reason for the warning')
            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View a user warnings')
        .addUserOption(option =>
          option
            .setName('target')
            .setDescription('User to check')
            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Clear all warnings')
        .addUserOption(option =>
          option
            .setName('target')
            .setDescription('User to clear')
            .setRequired(true)
        )
    ),

  // --------------------------------------------------------------
  // /roles
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('List all server roles'),

  // --------------------------------------------------------------
  // /settings
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View the current bot configuration'),

  // --------------------------------------------------------------
  // /kick
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('Member to kick')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the kick')
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.KickMembers
    ),

  // --------------------------------------------------------------
  // /ban
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('Member to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the ban')
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.BanMembers
    ),

  // --------------------------------------------------------------
  // /purge
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete up to 1000 messages')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of messages to delete (1-1000)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    ),

  // --------------------------------------------------------------
  // /end
  // --------------------------------------------------------------
  // Owner-only emergency failsafe.
  // It intentionally does NOT destroy the server.
  // --------------------------------------------------------------

  new SlashCommandBuilder()
    .setName('end')
    .setDescription('Ask owner for more info')

].map(command => command.toJSON());

// ================================================================
// 8. BOT READY
// ================================================================

client.once(Events.ClientReady, async bot => {
  console.log(`[Bot Online] Logged in as ${bot.user.tag}`);

  await loadSettings();

  const token =
    process.env.DISCORD_TOKEN ||
    process.env.TOKEN;

  const rest = new REST({
    version: '10'
  }).setToken(token);

  try {
    console.log('[Slash Commands] Registering commands globally...');

    await rest.put(
      Routes.applicationCommands(bot.user.id),
      {
        body: commands
      }
    );

    console.log(
      '[Slash Commands] Commands registered successfully.'
    );
  } catch (error) {
    console.error(
      '[Slash Commands Error]',
      error
    );
  }
});

// ================================================================
// 9. INTERACTION HANDLER
// ================================================================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ This command can only be used inside a server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const guild = interaction.guild;
    const member = interaction.member;
    const commandName = interaction.commandName;

    const config = ensureGuildConfig(guild.id);

    try {

      // ==========================================================
      // COMMAND LOGGING
      // ==========================================================

      await logEvent(
        guild,
        'Slash Command Used',
        [
          {
            name: 'Command',
            value: `/${commandName}`
          },
          {
            name: 'User',
            value: `${interaction.user.tag} (${interaction.user.id})`
          },
          {
            name: 'Channel',
            value: `${interaction.channel}`
          }
        ],
        '#3498DB'
      );

      // ==========================================================
      // /setlogs
      // ==========================================================

      if (commandName === 'setlogs') {

        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              '❌ You lack permission to configure the bot.',
            flags: MessageFlags.Ephemeral
          });
        }

        const channel =
          interaction.options.getChannel('channel');

        config.logChannelId = channel.id;

        await saveSettings(settingsCache);

        await interaction.reply({
          content:
            `✅ Logging channel set to ${channel}.`,
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ==========================================================
      // /setadmin
      // ==========================================================

      if (commandName === 'setadmin') {

        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              '❌ You lack permission to configure the bot.',
            flags: MessageFlags.Ephemeral
          });
        }

        const role =
          interaction.options.getRole('role');

        config.adminRoleId = role.id;

        if (!config.adminRoleIds.includes(role.id)) {
          config.adminRoleIds.push(role.id);
        }

        await saveSettings(settingsCache);

        await interaction.reply({
          content:
            `✅ Main admin role set to **${role.name}**.`,
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ==========================================================
      // /adminrole
      // ==========================================================

      if (commandName === 'adminrole') {

        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              '❌ You lack permission to manage admin roles.',
            flags: MessageFlags.Ephemeral
          });
        }

        const subcommand =
          interaction.options.getSubcommand();

        const roles = config.adminRoleIds;

        if (subcommand === 'add') {

          const role =
            interaction.options.getRole('role');

          if (roles.includes(role.id)) {
            return interaction.reply({
              content:
                `⚠️ **${role.name}** is already an admin role.`,
              flags: MessageFlags.Ephemeral
            });
          }

          roles.push(role.id);

          await saveSettings(settingsCache);

          return interaction.reply({
            content:
              `✅ Added **${role.name}** to the bot admin roles.`,
            flags: MessageFlags.Ephemeral
          });
        }

        if (subcommand === 'del') {

          const role =
            interaction.options.getRole('role');

          if (!roles.includes(role.id)) {
            return interaction.reply({
              content:
                `⚠️ **${role.name}** is not an admin role.`,
              flags: MessageFlags.Ephemeral
            });
          }

          config.adminRoleIds =
            roles.filter(id => id !== role.id);

          if (config.adminRoleId === role.id) {
            config.adminRoleId = null;
          }

          await saveSettings(settingsCache);

          return interaction.reply({
            content:
              `🗑️ Removed **${role.name}** from the bot admin roles.`,
            flags: MessageFlags.Ephemeral
          });
        }

        if (subcommand === 'list') {

          const roleList =
            config.adminRoleIds.length
              ? config.adminRoleIds
                  .map(id => `<@&${id}>`)
                  .join('\n')
              : 'No admin roles configured.';

          const embed = new EmbedBuilder()
            .setTitle(`🔑 Admin Roles — ${guild.name}`)
            .setDescription(roleList)
            .setColor('#5865F2')
            .setTimestamp();

          return interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
          });
        }
      }

      // ==========================================================
      // /warn
      // ==========================================================

      if (commandName === 'warn') {

        if (
          !isAdmin(interaction) &&
          !member.permissions.has(
            PermissionFlagsBits.ModerateMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ You lack permission to manage warnings.',
            flags: MessageFlags.Ephemeral
          });
        }

        const subcommand =
          interaction.options.getSubcommand();

        const target =
          interaction.options.getUser('target');

        const userId = target.id;

        if (!config.warnings[userId]) {
          config.warnings[userId] = [];
        }

        const warnings =
          config.warnings[userId];

        // --------------------------------------------------------
        // /warn add
        // --------------------------------------------------------

        if (subcommand === 'add') {

          const reason =
            interaction.options.getString('reason');

          warnings.push({
            reason,
            moderator: interaction.user.tag,
            moderatorId: interaction.user.id,
            date: new Date().toISOString()
          });

          await saveSettings(settingsCache);

          try {
            await target.send(
              `⚠️ You have received a warning in **${guild.name}**.\n\nReason: ${reason}`
            );
          } catch {
            console.log(
              `[Warning DM] Could not DM ${target.tag}`
            );
          }

          await interaction.reply({
            content:
              `⚠️ Warned **${target.tag}**.\nTotal warnings: **${warnings.length}**`,
            flags: MessageFlags.Ephemeral
          });

          await logEvent(
            guild,
            '⚠️ User Warned',
            [
              {
                name: 'User',
                value: `${target.tag} (${target.id})`
              },
              {
                name: 'Moderator',
                value: `${interaction.user.tag} (${interaction.user.id})`
              },
              {
                name: 'Reason',
                value: truncate(reason, 1000)
              },
              {
                name: 'Total Warnings',
                value: String(warnings.length)
              }
            ],
            '#F39C12'
          );

          return;
        }

        // --------------------------------------------------------
        // /warn list
        // --------------------------------------------------------

        if (subcommand === 'list') {

          if (!warnings.length) {
            return interaction.reply({
              content:
                `✅ **${target.tag}** has no active warnings.`,
              flags: MessageFlags.Ephemeral
            });
          }

          const description =
            warnings
              .map(
                (warning, index) =>
                  `**#${index + 1}** — ${truncate(
                    warning.reason,
                    500
                  )}\nModerator: ${warning.moderator}\nDate: <t:${Math.floor(
                    new Date(warning.date).getTime() / 1000
                  )}:R>`
              )
              .join('\n\n');

          const embed = new EmbedBuilder()
            .setTitle(`⚠️ Warnings — ${target.tag}`)
            .setDescription(description)
            .setColor('#F39C12')
            .setTimestamp();

          return interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
          });
        }

        // --------------------------------------------------------
        // /warn clear
        // --------------------------------------------------------

        if (subcommand === 'clear') {

          const count = warnings.length;

          config.warnings[userId] = [];

          await saveSettings(settingsCache);

          await interaction.reply({
            content:
              `🗑️ Cleared **${count}** warning(s) from **${target.tag}**.`,
            flags: MessageFlags.Ephemeral
          });

          await logEvent(
            guild,
            'Warnings Cleared',
            [
              {
                name: 'User',
                value: `${target.tag} (${target.id})`
              },
              {
                name: 'Moderator',
                value: `${interaction.user.tag} (${interaction.user.id})`
              },
              {
                name: 'Warnings Removed',
                value: String(count)
              }
            ],
            '#2ECC71'
          );

          return;
        }
      }

      // ==========================================================
      // /roles
      // ==========================================================

      if (commandName === 'roles') {

        const roles =
          guild.roles.cache
            .filter(role => role.id !== guild.id)
            .map(role => `<@&${role.id}>`)
            .join('\n');

        const embed = new EmbedBuilder()
          .setTitle(`📜 Roles — ${guild.name}`)
          .setDescription(
            roles || 'No custom roles.'
          )
          .setColor('#5865F2')
          .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }

      // ==========================================================
      // /settings
      // ==========================================================

      if (commandName === 'settings') {

        const logChannel =
          config.logChannelId
            ? `<#${config.logChannelId}>`
            : 'Not configured';

        const adminRoles =
          config.adminRoleIds.length
            ? config.adminRoleIds
                .map(id => `<@&${id}>`)
                .join(', ')
            : 'None';

        const embed = new EmbedBuilder()
          .setTitle(`⚙️ Bot Settings — ${guild.name}`)
          .addFields(
            {
              name: 'Log Channel',
              value: logChannel,
              inline: true
            },
            {
              name: 'Admin Roles',
              value: adminRoles,
              inline: true
            }
          )
          .setColor('#5865F2')
          .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }

      // ==========================================================
      // /kick
      // ==========================================================

      if (commandName === 'kick') {

        if (
          !isAdmin(interaction) &&
          !member.permissions.has(
            PermissionFlagsBits.KickMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags: MessageFlags.Ephemeral
          });
        }

        const target =
          interaction.options.getMember('target');

        const reason =
          interaction.options.getString('reason') ||
          'No reason provided';

        if (!target) {
          return interaction.reply({
            content:
              '❌ That member could not be found.',
            flags: MessageFlags.Ephemeral
          });
        }

        if (!target.kickable) {
          return interaction.reply({
            content:
              '❌ I cannot kick that member. Check my role position and permissions.',
            flags: MessageFlags.Ephemeral
          });
        }

        await target.kick(reason);

        await interaction.reply({
          content:
            `👢 Kicked **${target.user.tag}**.\nReason: ${reason}`
        });

        await logEvent(
          guild,
          '👢 Member Kicked',
          [
            {
              name: 'User',
              value: `${target.user.tag} (${target.id})`
            },
            {
              name: 'Moderator',
              value: `${interaction.user.tag} (${interaction.user.id})`
            },
            {
              name: 'Reason',
              value: truncate(reason, 1000)
            }
          ],
          '#E74C3C'
        );

        return;
      }

      // ==========================================================
      // /ban
      // ==========================================================

      if (commandName === 'ban') {

        if (
          !isAdmin(interaction) &&
          !member.permissions.has(
            PermissionFlagsBits.BanMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags: MessageFlags.Ephemeral
          });
        }

        const target =
          interaction.options.getUser('target');

        const reason =
          interaction.options.getString('reason') ||
          'No reason provided';

        const targetMember =
          await guild.members
            .fetch(target.id)
            .catch(() => null);

        if (
          targetMember &&
          !targetMember.bannable
        ) {
          return interaction.reply({
            content:
              '❌ I cannot ban that member. Check my role position and permissions.',
            flags: MessageFlags.Ephemeral
          });
        }

        await guild.members.ban(target.id, {
          reason
        });

        await interaction.reply({
          content:
            `🔨 Banned **${target.tag}**.\nReason: ${reason}`
        });

        await logEvent(
          guild,
          '🔨 Member Banned',
          [
            {
              name: 'User',
              value: `${target.tag} (${target.id})`
            },
            {
              name: 'Moderator',
              value: `${interaction.user.tag} (${interaction.user.id})`
            },
            {
              name: 'Reason',
              value: truncate(reason, 1000)
            }
          ],
          '#992D22'
        );

        return;
      }

      // ==========================================================
      // /purge
      // ==========================================================

      if (commandName === 'purge') {

        if (
          !isAdmin(interaction) &&
          !member.permissions.has(
            PermissionFlagsBits.ManageMessages
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags: MessageFlags.Ephemeral
          });
        }

        const amount =
          interaction.options.getInteger('amount');

        if (amount < 1 || amount > 1000) {
          return interaction.reply({
            content:
              '❌ Amount must be between 1 and 1000.',
            flags: MessageFlags.Ephemeral
          });
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        let remaining = amount;
        let deletedTotal = 0;

        while (remaining > 0) {

          const batchSize =
            Math.min(remaining, 100);

          const deleted =
            await interaction.channel.bulkDelete(
              batchSize,
              true
            );

          deletedTotal += deleted.size;
          remaining -= batchSize;

          if (deleted.size < batchSize) {
            break;
          }
        }

        await interaction.editReply({
          content:
            `🧹 Deleted **${deletedTotal}** message(s).`
        });

        await logEvent(
          guild,
          '🧹 Messages Purged',
          [
            {
              name: 'Channel',
              value: `${interaction.channel}`
            },
            {
              name: 'Messages Deleted',
              value: String(deletedTotal)
            },
            {
              name: 'Moderator',
              value: `${interaction.user.tag} (${interaction.user.id})`
            }
          ],
          '#F1C40F'
        );

        return;
      }

      // ==========================================================
      // /end
      // ==========================================================

      if (commandName === 'end') {

        // --------------------------------------------------------
        // Only the two owner IDs can access the failsafe.
        // Everyone else gets the exact requested response.
        // --------------------------------------------------------

        if (!isOwner(interaction.user.id)) {

          await interaction.reply({
            content:
              'Ask owner for info',
            flags: MessageFlags.Ephemeral
          });

          await logEvent(
            guild,
            '🚨 /end Attempt Blocked',
            [
              {
                name: 'User',
                value:
                  `${interaction.user.tag} (${interaction.user.id})`
              },
              {
                name: 'Result',
                value:
                  'Blocked — user is not an owner'
              }
            ],
            '#E74C3C'
          );

          return;
        }

        // --------------------------------------------------------
        // Safe failsafe.
        //
        // The requested version that deletes every channel,
        // deletes roles and mass-bans members is intentionally
        // not included.
        //
        // Instead, this owner-only command places the server into
        // emergency lockdown by disabling @everyone from sending
        // messages where possible.
        // --------------------------------------------------------

        await interaction.reply({
          content:
            '🚨 Owner failsafe activated. Starting emergency lockdown...',
          flags: MessageFlags.Ephemeral
        });

        let lockedChannels = 0;
        let failedChannels = 0;

        for (const channel of guild.channels.cache.values()) {

          if (!channel.isTextBased()) {
            continue;
          }

          try {

            await channel.permissionOverwrites.edit(
              guild.roles.everyone,
              {
                SendMessages: false,
                AddReactions: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
                SendMessagesInThreads: false
              },
              {
                reason:
                  `Owner emergency failsafe activated by ${interaction.user.tag}`
              }
            );

            lockedChannels++;

          } catch {
            failedChannels++;
          }
        }

        await logEvent(
          guild,
          '🚨 OWNER FAILSAFE ACTIVATED',
          [
            {
              name: 'Owner',
              value:
                `${interaction.user.tag} (${interaction.user.id})`
            },
            {
              name: 'Action',
              value:
                'Emergency server lockdown'
            },
            {
              name: 'Channels Locked',
              value:
                String(lockedChannels)
            },
            {
              name: 'Channels Failed',
              value:
                String(failedChannels)
            },
            {
              name: 'Destructive Wipe',
              value:
                'NOT performed'
            }
          ],
          '#E74C3C'
        );

        try {
          await interaction.followUp({
            content:
              `🚨 Emergency lockdown complete.\n\nLocked channels: **${lockedChannels}**\nFailed channels: **${failedChannels}**\n\nNo channels, roles or members were deleted/banned.`,
            flags: MessageFlags.Ephemeral
          });
        } catch {
          // Ignore follow-up errors.
        }

        return;
      }

    } catch (error) {

      console.error(
        `[Command Error] /${commandName}`,
        error
      );

      const errorMessage =
        '⚠️ An error occurred while executing this command.';

      try {

        if (
          interaction.replied ||
          interaction.deferred
        ) {
          await interaction.followUp({
            content: errorMessage,
            flags: MessageFlags.Ephemeral
          });
        } else {
          await interaction.reply({
            content: errorMessage,
            flags: MessageFlags.Ephemeral
          });
        }

      } catch {
        // Ignore response errors.
      }
    }
  }
);

// ================================================================
// 10. MESSAGE LOGGING
// ================================================================

// ---------------------------------------------------------------
// MESSAGE SENT
// ---------------------------------------------------------------

client.on(
  Events.MessageCreate,
  async message => {

    if (!message.guild) return;
    if (message.author.bot) return;

    const config =
      settingsCache[message.guild.id] || {};

    // Prevent the logging channel from logging itself.
    if (
      config.logChannelId ===
      message.channel.id
    ) {
      return;
    }

    await logEvent(
      message.guild,
      '💬 Message Sent',
      [
        {
          name: 'Author',
          value:
            `${message.author.tag} (${message.author.id})`
        },
        {
          name: 'Channel',
          value:
            `${message.channel}`
        },
        {
          name: 'Content',
          value:
            truncate(message.content, 1000)
        },
        {
          name: 'Message ID',
          value:
            message.id
        }
      ],
      '#3498DB'
    );
  }
);

// ---------------------------------------------------------------
// MESSAGE EDITED
// ---------------------------------------------------------------

client.on(
  Events.MessageUpdate,
  async (oldMessage, newMessage) => {

    if (!newMessage.guild) return;

    if (newMessage.author?.bot) {
      return;
    }

    const config =
      settingsCache[newMessage.guild.id] || {};

    if (
      config.logChannelId ===
      newMessage.channel?.id
    ) {
      return;
    }

    const oldContent =
      oldMessage.content || '*Unavailable*';

    const newContent =
      newMessage.content || '*No text content*';

    if (oldContent === newContent) {
      return;
    }

    await logEvent(
      newMessage.guild,
      '✏️ Message Edited',
      [
        {
          name: 'Author',
          value:
            `${newMessage.author?.tag || 'Unknown'} (${newMessage.author?.id || 'Unknown'})`
        },
        {
          name: 'Channel',
          value:
            `${newMessage.channel}`
        },
        {
          name: 'Before',
          value:
            truncate(oldContent, 900)
        },
        {
          name: 'After',
          value:
            truncate(newContent, 900)
        },
        {
          name: 'Message ID',
          value:
            newMessage.id
        }
      ],
      '#F1C40F'
    );
  }
);

// ---------------------------------------------------------------
// MESSAGE DELETED
// ---------------------------------------------------------------

client.on(
  Events.MessageDelete,
  async message => {

    if (!message.guild) return;

    if (message.author?.bot) {
      return;
    }

    const config =
      settingsCache[message.guild.id] || {};

    if (
      config.logChannelId ===
      message.channel?.id
    ) {
      return;
    }

    await logEvent(
      message.guild,
      '🗑️ Message Deleted',
      [
        {
          name: 'Author',
          value:
            `${message.author?.tag || 'Unknown'} (${message.author?.id || 'Unknown'})`
        },
        {
          name: 'Channel',
          value:
            `${message.channel}`
        },
        {
          name: 'Content',
          value:
            truncate(message.content, 1000)
        },
        {
          name: 'Message ID',
          value:
            message.id
        }
      ],
      '#E74C3C'
    );
  }
);

// ---------------------------------------------------------------
// BULK MESSAGE DELETE
// ---------------------------------------------------------------

client.on(
  Events.MessageBulkDelete,
  async messages => {

    const first =
      messages.first();

    if (!first?.guild) {
      return;
    }

    const config =
      settingsCache[first.guild.id] || {};

    if (
      config.logChannelId ===
      first.channel?.id
    ) {
      return;
    }

    await logEvent(
      first.guild,
      '🧹 Bulk Message Delete',
      [
        {
          name: 'Channel',
          value:
            `${first.channel}`
        },
        {
          name: 'Messages Deleted',
          value:
            String(messages.size)
        }
      ],
      '#E67E22'
    );
  }
);

// ================================================================
// 11. SERVER LOGGING
// ================================================================

// ---------------------------------------------------------------
// BOT ADDED
// ---------------------------------------------------------------

client.on(
  Events.GuildCreate,
  async guild => {

    ensureGuildConfig(guild.id);

    await logEvent(
      guild,
      '➕ Bot Added to Server',
      [
        {
          name: 'Server',
          value:
            `${guild.name} (${guild.id})`
        },
        {
          name: 'Members',
          value:
            String(guild.memberCount)
        }
      ],
      '#2ECC71'
    );
  }
);

// ---------------------------------------------------------------
// SERVER UPDATED
// ---------------------------------------------------------------

client.on(
  Events.GuildUpdate,
  async (oldGuild, newGuild) => {

    const changes = [];

    if (oldGuild.name !== newGuild.name) {
      changes.push({
        name: 'Server Name',
        value:
          `${oldGuild.name} → ${newGuild.name}`
      });
    }

    if (
      oldGuild.description !==
      newGuild.description
    ) {
      changes.push({
        name: 'Description',
        value:
          'Server description changed.'
      });
    }

    if (!changes.length) {
      return;
    }

    await logEvent(
      newGuild,
      '🏠 Server Updated',
      changes,
      '#9B59B6'
    );
  }
);

// ================================================================
// 12. CHANNEL LOGGING
// ================================================================

// ---------------------------------------------------------------
// CHANNEL CREATED
// ---------------------------------------------------------------

client.on(
  Events.ChannelCreate,
  async channel => {

    if (!channel.guild) return;

    await logEvent(
      channel.guild,
      '📁 Channel Created',
      [
        {
          name: 'Channel',
          value:
            `${channel.name} (${channel.id})`
        },
        {
          name: 'Type',
          value:
            String(channel.type)
        }
      ],
      '#2ECC71'
    );
  }
);

// ---------------------------------------------------------------
// CHANNEL DELETED
// ---------------------------------------------------------------

client.on(
  Events.ChannelDelete,
  async channel => {

    if (!channel.guild) return;

    await logEvent(
      channel.guild,
      '🗑️ Channel Deleted',
      [
        {
          name: 'Channel',
          value:
            `${channel.name} (${channel.id})`
        }
      ],
      '#E74C3C'
    );
  }
);

// ---------------------------------------------------------------
// CHANNEL UPDATED
// ---------------------------------------------------------------

client.on(
  Events.ChannelUpdate,
  async (oldChannel, newChannel) => {

    if (!newChannel.guild) return;

    const changes = [];

    if (
      oldChannel.name !==
      newChannel.name
    ) {
      changes.push({
        name: 'Name',
        value:
          `${oldChannel.name} → ${newChannel.name}`
      });
    }

    if (
      oldChannel.topic !==
      newChannel.topic
    ) {
      changes.push({
        name: 'Topic',
        value:
          'Channel topic changed.'
      });
    }

    if (!changes.length) {
      return;
    }

    await logEvent(
      newChannel.guild,
      '✏️ Channel Updated',
      [
        {
          name: 'Channel',
          value:
            `${newChannel}`
        },
        ...changes
      ],
      '#9B59B6'
    );
  }
);

// ================================================================
// 13. ROLE LOGGING
// ================================================================

// ---------------------------------------------------------------
// ROLE CREATED
// ---------------------------------------------------------------

client.on(
  Events.RoleCreate,
  async role => {

    await logEvent(
      role.guild,
      '🆕 Role Created',
      [
        {
          name: 'Role',
          value:
            `${role.name} (${role.id})`
        },
        {
          name: 'Created By',
          value:
            'Check server audit log for executor'
        }
      ],
      '#2ECC71'
    );
  }
);

// ---------------------------------------------------------------
// ROLE DELETED
// ---------------------------------------------------------------

client.on(
  Events.RoleDelete,
  async role => {

    await logEvent(
      role.guild,
      '🗑️ Role Deleted',
      [
        {
          name: 'Role',
          value:
            `${role.name} (${role.id})`
        }
      ],
      '#E74C3C'
    );
  }
);

// ---------------------------------------------------------------
// ROLE UPDATED
// ---------------------------------------------------------------

client.on(
  Events.RoleUpdate,
  async (oldRole, newRole) => {

    const changes = [];

    if (
      oldRole.name !==
      newRole.name
    ) {
      changes.push({
        name: 'Name',
        value:
          `${oldRole.name} → ${newRole.name}`
      });
    }

    if (
      oldRole.color !==
      newRole.color
    ) {
      changes.push({
        name: 'Colour',
        value:
          'Role colour changed.'
      });
    }

    if (
      oldRole.permissions.bitfield !==
      newRole.permissions.bitfield
    ) {
      changes.push({
        name: 'Permissions',
        value:
          'Role permissions changed.'
      });
    }

    if (!changes.length) {
      return;
    }

    await logEvent(
      newRole.guild,
      '✏️ Role Updated',
      [
        {
          name: 'Role',
          value:
            `${newRole.name} (${newRole.id})`
        },
        ...changes
      ],
      '#9B59B6'
    );
  }
);

// ================================================================
// 14. MEMBER LOGGING
// ================================================================

// ---------------------------------------------------------------
// MEMBER JOINED
// ---------------------------------------------------------------

client.on(
  Events.GuildMemberAdd,
  async member => {

    await logEvent(
      member.guild,
      '📥 Member Joined',
      [
        {
          name: 'Member',
          value:
            `${member.user.tag} (${member.id})`
        },
        {
          name: 'Account Created',
          value:
            `<t:${Math.floor(
              member.user.createdTimestamp / 1000
            )}:R>`
        }
      ],
      '#2ECC71'
    );
  }
);

// ---------------------------------------------------------------
// MEMBER LEFT
// ---------------------------------------------------------------

client.on(
  Events.GuildMemberRemove,
  async member => {

    await logEvent(
      member.guild,
      '📤 Member Left / Removed',
      [
        {
          name: 'Member',
          value:
            `${member.user?.tag || 'Unknown'} (${member.id})`
        }
      ],
      '#E74C3C'
    );
  }
);

// ---------------------------------------------------------------
// MEMBER UPDATED
// ---------------------------------------------------------------

client.on(
  Events.GuildMemberUpdate,
  async (oldMember, newMember) => {

    const changes = [];

    if (
      oldMember.nickname !==
      newMember.nickname
    ) {
      changes.push({
        name: 'Nickname',
        value:
          `${oldMember.nickname || 'None'} → ${newMember.nickname || 'None'}`
      });
    }

    const oldRoles =
      oldMember.roles.cache
        .map(role => role.id)
        .sort()
        .join(',');

    const newRoles =
      newMember.roles.cache
        .map(role => role.id)
        .sort()
        .join(',');

    if (oldRoles !== newRoles) {
      changes.push({
        name: 'Roles',
        value:
          'Member roles changed.'
      });
    }

    if (!changes.length) {
      return;
    }

    await logEvent(
      newMember.guild,
      '✏️ Member Updated',
      [
        {
          name: 'Member',
          value:
            `${newMember.user.tag} (${newMember.id})`
        },
        ...changes
      ],
      '#9B59B6'
    );
  }
);

// ================================================================
// 15. BAN / UNBAN LOGGING
// ================================================================

// ---------------------------------------------------------------
// BAN
// ---------------------------------------------------------------

client.on(
  Events.GuildBanAdd,
  async ban => {

    const executor =
      await getAuditExecutor(
        ban.guild,
        AuditLogEvent.MemberBanAdd,
        ban.user.id
      );

    await logEvent(
      ban.guild,
      '🔨 Member Banned',
      [
        {
          name: 'User',
          value:
            `${ban.user.tag} (${ban.user.id})`
        },
        {
          name: 'Executor',
          value:
            executor
              ? `${executor.tag} (${executor.id})`
              : 'Unknown'
        },
        {
          name: 'Reason',
          value:
            ban.reason || 'No reason provided'
        }
      ],
      '#992D22'
    );
  }
);

// ---------------------------------------------------------------
// UNBAN
// ---------------------------------------------------------------

client.on(
  Events.GuildBanRemove,
  async ban => {

    const executor =
      await getAuditExecutor(
        ban.guild,
        AuditLogEvent.MemberBanRemove,
        ban.user.id
      );

    await logEvent(
      ban.guild,
      '🔓 Member Unbanned',
      [
        {
          name: 'User',
          value:
            `${ban.user.tag} (${ban.user.id})`
        },
        {
          name: 'Executor',
          value:
            executor
              ? `${executor.tag} (${executor.id})`
              : 'Unknown'
        }
      ],
      '#2ECC71'
    );
  }
);

// ================================================================
// 16. VOICE LOGGING
// ================================================================

client.on(
  Events.VoiceStateUpdate,
  async (oldState, newState) => {

    if (!newState.guild) {
      return;
    }

    const memberName =
      newState.member?.user?.tag ||
      newState.id;

    // Joined voice
    if (
      !oldState.channelId &&
      newState.channelId
    ) {

      await logEvent(
        newState.guild,
        '🔊 Voice Channel Joined',
        [
          {
            name: 'Member',
            value:
              `${memberName} (${newState.id})`
          },
          {
            name: 'Channel',
            value:
              `${newState.channel}`
          }
        ],
        '#3498DB'
      );

      return;
    }

    // Left voice
    if (
      oldState.channelId &&
      !newState.channelId
    ) {

      await logEvent(
        newState.guild,
        '🔇 Voice Channel Left',
        [
          {
            name: 'Member',
            value:
              `${memberName} (${newState.id})`
          },
          {
            name: 'Channel',
            value:
              `${oldState.channel}`
          }
        ],
        '#E67E22'
      );

      return;
    }

    // Moved voice channel
    if (
      oldState.channelId !==
      newState.channelId
    ) {

      await logEvent(
        newState.guild,
        '🔀 Voice Channel Moved',
        [
          {
            name: 'Member',
            value:
              `${memberName} (${newState.id})`
          },
          {
            name: 'From',
            value:
              `${oldState.channel}`
          },
          {
            name: 'To',
            value:
              `${newState.channel}`
          }
        ],
        '#9B59B6'
      );
    }
  }
);

// ================================================================
// 17. LOGIN
// ================================================================

const TOKEN =
  process.env.DISCORD_TOKEN ||
  process.env.TOKEN;

if (!TOKEN) {
  console.error(
    '[Startup Error] No Discord token was found.'
  );
  process.exit(1);
}

client.login(TOKEN);
