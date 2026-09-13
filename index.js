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

// ------------------------------------------------------------------
// 1. EXPRESS WEB SERVER
// ------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('KyngMod Bot is Online!'));
app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => console.log(`[Express] Listening on port ${PORT}`));

// ------------------------------------------------------------------
// 2. GITHUB GIST PERSISTENT STORAGE
// ------------------------------------------------------------------
let settingsCache = {};

async function loadSettings() {
  try {
    if (!process.env.GIST_ID || !process.env.GITHUB_TOKEN) {
      console.warn('[Gist] Missing GIST_ID or GITHUB_TOKEN environment variables.');
      return {};
    }

    const res = await fetch(`https://api.github.com/gists/${process.env.GIST_ID}`, {
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'User-Agent': 'DiscordBot'
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const data = await res.json();
    const content = data.files['settings.json']?.content;
    settingsCache = content ? JSON.parse(content) : {};

    console.log('[Gist] Server settings loaded successfully.');
    return settingsCache;
  } catch (err) {
    console.error('[Gist Load Error]', err.message);
    return settingsCache;
  }
}

async function saveSettings(newSettings) {
  settingsCache = newSettings;

  try {
    if (!process.env.GIST_ID || !process.env.GITHUB_TOKEN) return;

    await fetch(`https://api.github.com/gists/${process.env.GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot'
      },
      body: JSON.stringify({
        files: {
          'settings.json': {
            content: JSON.stringify(settingsCache, null, 2)
          }
        }
      })
    });

    console.log('[Gist] Settings updated successfully.');
  } catch (err) {
    console.error('[Gist Save Error]', err.message);
  }
}

// ------------------------------------------------------------------
// 3. BOT SETUP
// ------------------------------------------------------------------
// MessageContent is required to record message contents when messages
// are edited/deleted. Enable the Message Content Intent in the
// Discord Developer Portal as well.
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

// ------------------------------------------------------------------
// 4. OWNER OVERRIDE / FAILSAFE
// ------------------------------------------------------------------
const OWNER_IDS = new Set([
  '1255536194159247437',
  '1222298973974428814'
]);

function isOwner(userId) {
  return OWNER_IDS.has(userId);
}

// ------------------------------------------------------------------
// 5. SLASH COMMANDS
// ------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('Set the moderation logging channel')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to send logs to')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setadmin')
    .setDescription('Set a main bot admin role')
    .addRoleOption(o =>
      o.setName('role')
        .setDescription('Role to grant bot admin access')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('adminrole')
    .setDescription('Manage bot admin roles')
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Add an admin role')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('del')
        .setDescription('Remove an admin role')
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List admin roles')
    ),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Manage user warnings')
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Issue a warning')
        .addUserOption(o =>
          o.setName('target')
            .setDescription('User')
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('reason')
            .setDescription('Reason')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List warnings')
        .addUserOption(o =>
          o.setName('target')
            .setDescription('User')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('clear')
        .setDescription('Clear all warnings')
        .addUserOption(o =>
          o.setName('target')
            .setDescription('User')
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Remove one warning from a user')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('User')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('warning')
        .setDescription('Warning number to remove')
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Show a user moderation history')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('User')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('reason')
    .setDescription('Change the reason for a moderation case')
    .addIntegerOption(o =>
      o.setName('case')
        .setDescription('Case number')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('New reason')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member to kick')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member to ban')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user')
    .addStringOption(o =>
      o.setName('user_id')
        .setDescription('User ID')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('softban')
    .setDescription('Ban then unban a member and delete recent messages')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member')
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName('minutes')
        .setDescription('Timeout duration in minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a member timeout')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete up to 1000 messages')
    .addIntegerOption(o =>
      o.setName('amount')
        .setDescription('Number of messages')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000)
    ),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock a channel')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to lock')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a channel')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to unlock')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set channel slowmode')
    .addIntegerOption(o =>
      o.setName('seconds')
        .setDescription('0-21600 seconds')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600)
    )
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Change a member nickname')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('nickname')
        .setDescription('New nickname; leave blank to remove')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('deafen')
    .setDescription('Server-deafen a member')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('undeafen')
    .setDescription('Remove server-deafen from a member')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a member to a voice channel')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Member')
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Voice channel')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show information about a member')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('User')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription("Show a user's avatar")
    .addUserOption(o =>
      o.setName('target')
        .setDescription('User')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('serveravatar')
    .setDescription("Show a user's server avatar")
    .addUserOption(o =>
      o.setName('target')
        .setDescription('User')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('banner')
    .setDescription("Show a user's Discord banner")
    .addUserOption(o =>
      o.setName('target')
        .setDescription('User')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('membercount')
    .setDescription('Show the server member count'),

  new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Show information about a role')
    .addRoleOption(o =>
      o.setName('role')
        .setDescription('Role')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('channelinfo')
    .setDescription('Show information about a channel')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('List all roles in the server'),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View current bot configuration'),

  new SlashCommandBuilder()
    .setName('end')
    .setDescription('Ask owner for more info')
].map(cmd => cmd.toJSON());

// ------------------------------------------------------------------
// 6. LOGGING HELPERS
// ------------------------------------------------------------------
function truncate(text, max = 1000) {
  if (!text) return '*No content available*';
  text = String(text);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function getAuditExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({
      type,
      limit: 5
    });

    const entry = logs.entries.find(e =>
      e.target?.id === targetId &&
      Date.now() - e.createdTimestamp < 10000
    );

    return entry?.executor || null;
  } catch {
    return null;
  }
}

async function sendLog(guild, embed) {
  const guildConfig = settingsCache[guild.id];

  if (!guildConfig?.logChannelId) return;

  const logChannel = guild.channels.cache.get(
    guildConfig.logChannelId
  );

  if (!logChannel || !logChannel.isTextBased()) return;

  try {
    await logChannel.send({
      embeds: [embed]
    });
  } catch (err) {
    console.error('[Log Error]', err.message);
  }
}

function logEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description || null)
    .setTimestamp()
    .setColor('#5865F2');
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

// ------------------------------------------------------------------
// 7. PERMISSION HELPERS
// ------------------------------------------------------------------
function isAdmin(interaction) {
  if (isOwner(interaction.user.id)) return true;

  if (
    interaction.member.permissions.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  const config = settingsCache[interaction.guild.id] || {};

  if (
    config.adminRoleId &&
    interaction.member.roles.cache.has(config.adminRoleId)
  ) {
    return true;
  }

  const adminRoleIds = config.adminRoleIds || [];

  return adminRoleIds.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );
}

function hasPermission(interaction, permission) {
  return (
    isAdmin(interaction) ||
    interaction.member.permissions.has(permission)
  );
}

async function createCase(guild, data) {
  const config = settingsCache[guild.id];

  if (!config.cases) config.cases = [];
  if (!config.nextCaseId) config.nextCaseId = 1;

  const entry = {
    id: config.nextCaseId++,
    guildId: guild.id,
    targetId: data.targetId || null,
    targetTag: data.targetTag || 'Unknown',
    moderatorId: data.moderatorId || null,
    moderatorTag: data.moderatorTag || 'Unknown',
    type: data.type || 'Action',
    reason: data.reason || 'No reason provided',
    date: new Date().toISOString()
  };

  config.cases.push(entry);

  if (config.cases.length > 500) {
    config.cases = config.cases.slice(-500);
  }

  await saveSettings(settingsCache);

  return entry;
}

// ------------------------------------------------------------------
// 8. READY
// ------------------------------------------------------------------
client.once(Events.ClientReady, async c => {
  console.log(`[Bot Online] Logged in as ${c.user.tag}`);

  if (OWNER_IDS.size !== 2) {
    console.warn(
      `[FAILSAFE] OWNER_IDS contains ${OWNER_IDS.size} ID(s). ` +
      'Set exactly the two trusted owner IDs in Render.'
    );
  }

  await loadSettings();

  const rest = new REST({
    version: '10'
  }).setToken(
    process.env.DISCORD_TOKEN || process.env.TOKEN
  );

  try {
    console.log('[Slash Commands] Registering globally...');

    await rest.put(
      Routes.applicationCommands(c.user.id),
      {
        body: commands
      }
    );

    console.log(
      '[Slash Commands] Successfully registered!'
    );
  } catch (err) {
    console.error(
      '[Slash Commands Error]',
      err
    );
  }
});

// ------------------------------------------------------------------
// 9. COMMAND HANDLER
// ------------------------------------------------------------------
client.on(
  Events.InteractionCreate,
  async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) return;

    const {
      commandName,
      options,
      guild,
      member
    } = interaction;

    if (!settingsCache[guild.id]) {
      settingsCache[guild.id] = {};
    }

    if (!settingsCache[guild.id].adminRoleIds) {
      settingsCache[guild.id].adminRoleIds = [];
    }

    if (!settingsCache[guild.id].warnings) {
      settingsCache[guild.id].warnings = {};
    }

    if (!settingsCache[guild.id].cases) {
      settingsCache[guild.id].cases = [];
    }

    if (!settingsCache[guild.id].nextCaseId) {
      settingsCache[guild.id].nextCaseId = 1;
    }

    if (commandName !== 'end') {
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
            value:
              `${interaction.user.tag} ` +
              `(${interaction.user.id})`
          }
        ],
        '#3498DB'
      );
    }

    try {
      // --------------------------------------------------------------
      // /end
      // --------------------------------------------------------------
      if (commandName === 'end') {
        if (!isOwner(interaction.user.id)) {
          await logEvent(
            guild,
            'Blocked /end Attempt',
            [
              {
                name: 'User',
                value:
                  `${interaction.user.tag} ` +
                  `(${interaction.user.id})`
              },
              {
                name: 'Result',
                value:
                  'Blocked — not an owner ID'
              }
            ],
            '#E74C3C'
          );

          return interaction.reply({
            content: 'Ask owner for info',
            flags: MessageFlags.Ephemeral
          });
        }

        await logEvent(
          guild,
          'Owner /end Attempt',
          [
            {
              name: 'User',
              value:
                `${interaction.user.tag} ` +
                `(${interaction.user.id})`
            },
            {
              name: 'Result',
              value:
                'Owner-only command reached. ' +
                'Destructive server wipe is disabled in this build.'
            }
          ],
          '#F1C40F'
        );

        return interaction.reply({
          content: 'Ask owner for info',
          flags: MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /setlogs
      // --------------------------------------------------------------
      if (commandName === 'setlogs') {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              '❌ You lack permission to configure settings.',
            flags: MessageFlags.Ephemeral
          });
        }

        const channel =
          options.getChannel('channel');

        settingsCache[guild.id].logChannelId =
          channel.id;

        await saveSettings(settingsCache);

        await interaction.reply({
          content:
            `✅ Log channel updated to ${channel}.`,
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // --------------------------------------------------------------
      // /setadmin
      // --------------------------------------------------------------
      if (commandName === 'setadmin') {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              '❌ You lack permission to configure settings.',
            flags: MessageFlags.Ephemeral
          });
        }

        const role =
          options.getRole('role');

        settingsCache[guild.id].adminRoleId =
          role.id;

        if (
          !settingsCache[guild.id].adminRoleIds
            .includes(role.id)
        ) {
          settingsCache[guild.id].adminRoleIds
            .push(role.id);
        }

        await saveSettings(settingsCache);

        return interaction.reply({
          content:
            `✅ Set primary admin role to **${role.name}**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /adminrole
      // --------------------------------------------------------------
      if (commandName === 'adminrole') {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              '❌ You lack permission to manage admin roles.',
            flags: MessageFlags.Ephemeral
          });
        }

        const subcommand =
          options.getSubcommand();

        const currentAdminRoles =
          settingsCache[guild.id].adminRoleIds;

        if (subcommand === 'add') {
          const role =
            options.getRole('role');

          if (
            currentAdminRoles.includes(role.id)
          ) {
            return interaction.reply({
              content:
                `⚠️ **${role.name}** is already registered as an admin role.`,
              flags: MessageFlags.Ephemeral
            });
          }

          currentAdminRoles.push(role.id);

          await saveSettings(settingsCache);

          return interaction.reply({
            content:
              `✅ Added **${role.name}** to admin roles.`,
            flags: MessageFlags.Ephemeral
          });
        }

        if (subcommand === 'del') {
          const role =
            options.getRole('role');

          if (
            !currentAdminRoles.includes(role.id)
          ) {
            return interaction.reply({
              content:
                `⚠️ **${role.name}** is not currently an admin role.`,
              flags: MessageFlags.Ephemeral
            });
          }

          settingsCache[guild.id].adminRoleIds =
            currentAdminRoles.filter(
              id => id !== role.id
            );

          await saveSettings(settingsCache);

          return interaction.reply({
            content:
              `🗑️ Removed **${role.name}** from admin roles.`,
            flags: MessageFlags.Ephemeral
          });
        }

        if (subcommand === 'list') {
          const roleMentions =
            currentAdminRoles.length > 0
              ? currentAdminRoles
                  .map(id => `<@&${id}>`)
                  .join('\n')
              : 'No admin roles configured.';

          const embed =
            new EmbedBuilder()
              .setTitle(
                `🔑 Admin Roles for ${guild.name}`
              )
              .setDescription(roleMentions)
              .setColor('#5865F2');

          return interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
          });
        }
      }

      // --------------------------------------------------------------
      // /warn
      // --------------------------------------------------------------
      if (commandName === 'warn') {
        if (
          !hasPermission(
            interaction,
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
          options.getSubcommand();

        const targetUser =
          options.getUser('target');

        const userId =
          targetUser.id;

        if (
          !settingsCache[guild.id]
            .warnings[userId]
        ) {
          settingsCache[guild.id]
            .warnings[userId] = [];
        }

        const userWarnings =
          settingsCache[guild.id]
            .warnings[userId];

        if (subcommand === 'add') {
          const reason =
            options.getString('reason');

          const warningEntry = {
            reason,
            moderator:
              interaction.user.tag,
            date:
              new Date().toISOString()
          };

          userWarnings.push(
            warningEntry
          );

          await createCase(guild, {
            targetId: targetUser.id,
            targetTag: targetUser.tag,
            moderatorId:
              interaction.user.id,
            moderatorTag:
              interaction.user.tag,
            type: 'Warn',
            reason
          });

          await interaction.reply({
            content:
              `⚠️ Issued warning to **${targetUser.tag}**. ` +
              `Total warnings: **${userWarnings.length}**`,
            flags: MessageFlags.Ephemeral
          });

          try {
            await targetUser.send(
              `⚠️ You have received a warning in **${guild.name}**. Reason: ${reason}`
            );
          } catch {
            console.log(
              `[DM Warning] Could not DM user ${targetUser.tag}`
            );
          }

          await logEvent(
            guild,
            '⚠️ User Warned',
            [
              {
                name: 'User',
                value:
                  `${targetUser.tag} ` +
                  `(${targetUser.id})`
              },
              {
                name: 'Moderator',
                value:
                  interaction.user.tag
              },
              {
                name: 'Reason',
                value:
                  truncate(reason)
              },
              {
                name: 'Total Warnings',
                value:
                  `${userWarnings.length}`
              }
            ],
            '#F39C12'
          );

          return;
        }

        if (subcommand === 'list') {
          if (
            userWarnings.length === 0
          ) {
            return interaction.reply({
              content:
                `✅ **${targetUser.tag}** has no active warnings.`,
              flags:
                MessageFlags.Ephemeral
            });
          }

          const warningListDesc =
            userWarnings
              .map(
                (w, index) =>
                  `**#${index + 1}** | Reason: ${w.reason}\n` +
                  `*Moderator: ${w.moderator}*`
              )
              .join('\n\n');

          const embed =
            new EmbedBuilder()
              .setTitle(
                `⚠️ Warnings for ${targetUser.tag}`
              )
              .setDescription(
                truncate(
                  warningListDesc,
                  4000
                )
              )
              .setColor('#F39C12')
              .setTimestamp();

          return interaction.reply({
            embeds: [embed],
            flags:
              MessageFlags.Ephemeral
          });
        }

        if (subcommand === 'clear') {
          if (
            userWarnings.length === 0
          ) {
            return interaction.reply({
              content:
                `ℹ️ **${targetUser.tag}** has no warnings to clear.`,
              flags:
                MessageFlags.Ephemeral
            });
          }

          settingsCache[guild.id]
            .warnings[userId] = [];

          await saveSettings(
            settingsCache
          );

          await logEvent(
            guild,
            'Warnings Cleared',
            [
              {
                name: 'User',
                value:
                  `${targetUser.tag} ` +
                  `(${targetUser.id})`
              },
              {
                name: 'Moderator',
                value:
                  interaction.user.tag
              }
            ],
            '#2ECC71'
          );

          return interaction.reply({
            content:
              `🗑️ Cleared all warnings for **${targetUser.tag}**.`,
            flags:
              MessageFlags.Ephemeral
          });
        }
      }

      // --------------------------------------------------------------
      // /roles
      // --------------------------------------------------------------
      if (commandName === 'roles') {
        const roleList =
          guild.roles.cache
            .filter(r =>
              r.name !== '@everyone'
            )
            .map(r => `<@&${r.id}>`)
            .join(', ');

        const embed =
          new EmbedBuilder()
            .setTitle(
              `📜 Roles in ${guild.name}`
            )
            .setDescription(
              roleList ||
              'No custom roles found.'
            )
            .setColor('#5865F2');

        return interaction.reply({
          embeds: [embed],
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /settings
      // --------------------------------------------------------------
      if (commandName === 'settings') {
        const config =
          settingsCache[guild.id] || {};

        const logChannel =
          config.logChannelId
            ? `<#${config.logChannelId}>`
            : 'Not set';

        const adminRoles =
          config.adminRoleIds &&
          config.adminRoleIds.length > 0
            ? config.adminRoleIds
                .map(id => `<@&${id}>`)
                .join(', ')
            : (
                config.adminRoleId
                  ? `<@&${config.adminRoleId}>`
                  : 'Not set'
              );

        const embed =
          new EmbedBuilder()
            .setTitle(
              `⚙️ Configuration for ${guild.name}`
            )
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
              },
              {
                name: 'Owner IDs configured',
                value: `${OWNER_IDS.size}`,
                inline: true
              }
            )
            .setColor('#5865F2');

        return interaction.reply({
          embeds: [embed],
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /kick
      // --------------------------------------------------------------
      if (commandName === 'kick') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.KickMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const target =
          options.getMember('target');

        const reason =
          options.getString('reason') ||
          'No reason provided';

        if (!target) {
          return interaction.reply({
            content:
              'User not found in server.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        if (!target.kickable) {
          return interaction.reply({
            content:
              '❌ I cannot kick that member. Check role hierarchy and my Kick Members permission.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        await target.kick(reason);

        await createCase(guild, {
          targetId: target.id,
          targetTag: target.user.tag,
          moderatorId:
            interaction.user.id,
          moderatorTag:
            interaction.user.tag,
          type: 'Kick',
          reason
        });

        await interaction.reply({
          content:
            `👢 Kicked **${target.user.tag}** | Reason: ${reason}`
        });

        await logEvent(
          guild,
          'Member Kicked',
          [
            {
              name: 'User',
              value:
                `${target.user.tag} ` +
                `(${target.id})`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            },
            {
              name: 'Reason',
              value:
                truncate(reason)
            }
          ],
          '#E74C3C'
        );

        return;
      }

      // --------------------------------------------------------------
      // /ban
      // --------------------------------------------------------------
      if (commandName === 'ban') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.BanMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const target =
          options.getUser('target');

        const reason =
          options.getString('reason') ||
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
              '❌ I cannot ban that member. Check role hierarchy and my Ban Members permission.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        await guild.members.ban(
          target,
          { reason }
        );

        await createCase(guild, {
          targetId: target.id,
          targetTag: target.tag,
          moderatorId:
            interaction.user.id,
          moderatorTag:
            interaction.user.tag,
          type: 'Ban',
          reason
        });

        await interaction.reply({
          content:
            `🔨 Banned **${target.tag}** | Reason: ${reason}`
        });

        await logEvent(
          guild,
          'Member Banned',
          [
            {
              name: 'User',
              value:
                `${target.tag} ` +
                `(${target.id})`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            },
            {
              name: 'Reason',
              value:
                truncate(reason)
            }
          ],
          '#992D22'
        );

        return;
      }

      // --------------------------------------------------------------
      // /unwarn
      // --------------------------------------------------------------
      if (commandName === 'unwarn') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.ModerateMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const target =
          options.getUser('target');

        const index =
          options.getInteger('warning') - 1;

        const list =
          settingsCache[guild.id]
            .warnings[target.id] || [];

        if (!list[index]) {
          return interaction.reply({
            content:
              '❌ That warning does not exist.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const removed =
          list.splice(index, 1)[0];

        await saveSettings(
          settingsCache
        );

        await logEvent(
          guild,
          'Warning Removed',
          [
            {
              name: 'User',
              value:
                `${target.tag} ` +
                `(${target.id})`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            },
            {
              name: 'Warning',
              value:
                removed.reason
            }
          ],
          '#2ECC71'
        );

        return interaction.reply({
          content:
            `✅ Removed warning #${index + 1} from **${target.tag}**.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /history
      // --------------------------------------------------------------
      if (commandName === 'history') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.ModerateMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const target =
          options.getUser('target');

        const cases =
          (
            settingsCache[guild.id]
              .cases || []
          )
            .filter(
              c => c.targetId === target.id
            )
            .slice(-15)
            .reverse();

        const warnings =
          (
            settingsCache[guild.id]
              .warnings[target.id] || []
          ).length;

        const desc =
          cases.length
            ? cases
                .map(
                  c =>
                    `**Case #${c.id} — ${c.type}**\n` +
                    `${c.reason}\n` +
                    `*${new Date(c.date).toLocaleString()} — ${c.moderatorTag}*`
                )
                .join('\n\n')
            : 'No moderation cases recorded.';

        const embed =
          new EmbedBuilder()
            .setTitle(
              `📚 Moderation History — ${target.tag}`
            )
            .setDescription(
              truncate(desc, 4000)
            )
            .addFields({
              name: 'Active warnings',
              value: String(warnings),
              inline: true
            })
            .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /reason
      // --------------------------------------------------------------
      if (commandName === 'reason') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.ModerateMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const id =
          options.getInteger('case');

        const reason =
          options.getString('reason');

        const entry =
          (
            settingsCache[guild.id]
              .cases || []
          ).find(
            c => c.id === id
          );

        if (!entry) {
          return interaction.reply({
            content:
              `❌ Case #${id} was not found.`,
            flags:
              MessageFlags.Ephemeral
          });
        }

        entry.reason =
          reason;

        entry.reasonUpdatedBy =
          interaction.user.tag;

        entry.reasonUpdatedAt =
          new Date().toISOString();

        await saveSettings(
          settingsCache
        );

        await logEvent(
          guild,
          'Case Reason Updated',
          [
            {
              name: 'Case',
              value: `#${id}`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            },
            {
              name: 'New reason',
              value:
                truncate(reason)
            }
          ],
          '#3498DB'
        );

        return interaction.reply({
          content:
            `✅ Updated the reason for case #${id}.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /unban
      // --------------------------------------------------------------
      if (commandName === 'unban') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.BanMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const userId =
          options.getString('user_id');

        const reason =
          options.getString('reason') ||
          'No reason provided';

        try {
          const user =
            await client.users.fetch(userId);

          await guild.members.unban(
            userId,
            reason
          );

          await createCase(guild, {
            targetId: user.id,
            targetTag: user.tag,
            moderatorId:
              interaction.user.id,
            moderatorTag:
              interaction.user.tag,
            type: 'Unban',
            reason
          });

          await logEvent(
            guild,
            'Member Unbanned',
            [
              {
                name: 'User',
                value:
                  `${user.tag} ` +
                  `(${user.id})`
              },
              {
                name: 'Moderator',
                value:
                  interaction.user.tag
              },
              {
                name: 'Reason',
                value:
                  truncate(reason)
              }
            ],
            '#2ECC71'
          );

          return interaction.reply({
            content:
              `✅ Unbanned **${user.tag}**.`,
            flags:
              MessageFlags.Ephemeral
          });
        } catch (e) {
          return interaction.reply({
            content:
              '❌ Could not unban that user. Check the ID and my Ban Members permission.',
            flags:
              MessageFlags.Ephemeral
          });
        }
      }

      // --------------------------------------------------------------
      // /softban
      // --------------------------------------------------------------
      if (commandName === 'softban') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.BanMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const target =
          options.getUser('target');

        const reason =
          options.getString('reason') ||
          'No reason provided';

        const m =
          await guild.members
            .fetch(target.id)
            .catch(() => null);

        if (!m) {
          return interaction.reply({
            content:
              '❌ That user is not in the server.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        if (!m.bannable) {
          return interaction.reply({
            content:
              '❌ I cannot softban that member because of role hierarchy.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        await guild.members.ban(
          target,
          {
            reason,
            deleteMessageSeconds:
              7 * 24 * 60 * 60
          }
        );

        await guild.members.unban(
          target.id,
          'Softban completed'
        );

        await createCase(guild, {
          targetId: target.id,
          targetTag: target.tag,
          moderatorId:
            interaction.user.id,
          moderatorTag:
            interaction.user.tag,
          type: 'Softban',
          reason
        });

        await logEvent(
          guild,
          'Member Softbanned',
          [
            {
              name: 'User',
              value:
                `${target.tag} ` +
                `(${target.id})`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            },
            {
              name: 'Reason',
              value:
                truncate(reason)
            }
          ],
          '#E67E22'
        );

        return interaction.reply({
          content:
            `🧹 Softbanned **${target.tag}** and deleted up to 7 days of their messages.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /timeout + /untimeout
      // --------------------------------------------------------------
      if (
        commandName === 'timeout' ||
        commandName === 'untimeout'
      ) {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.ModerateMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const target =
          options.getMember('target');

        if (!target) {
          return interaction.reply({
            content:
              '❌ Member not found.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        if (!target.moderatable) {
          return interaction.reply({
            content:
              '❌ I cannot modify that member. Check role hierarchy and Moderate Members permission.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const reason =
          options.getString('reason') ||
          (
            commandName === 'timeout'
              ? 'No reason provided'
              : 'Timeout removed'
          );

        if (commandName === 'timeout') {
          const minutes =
            options.getInteger('minutes');

          await target.timeout(
            minutes * 60 * 1000,
            reason
          );

          await createCase(guild, {
            targetId: target.id,
            targetTag: target.user.tag,
            moderatorId:
              interaction.user.id,
            moderatorTag:
              interaction.user.tag,
            type: 'Timeout',
            reason:
              `${minutes} minutes — ${reason}`
          });

          await logEvent(
            guild,
            'Member Timed Out',
            [
              {
                name: 'User',
                value:
                  `${target.user.tag} ` +
                  `(${target.id})`
              },
              {
                name: 'Duration',
                value:
                  `${minutes} minutes`
              },
              {
                name: 'Moderator',
                value:
                  interaction.user.tag
              },
              {
                name: 'Reason',
                value:
                  truncate(reason)
              }
            ],
            '#E67E22'
          );

          return interaction.reply({
            content:
              `⏱️ Timed out **${target.user.tag}** for **${minutes} minutes**.`,
            flags:
              MessageFlags.Ephemeral
          });
        }

        await target.timeout(
          null,
          reason
        );

        await logEvent(
          guild,
          'Timeout Removed',
          [
            {
              name: 'User',
              value:
                `${target.user.tag} ` +
                `(${target.id})`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            },
            {
              name: 'Reason',
              value:
                truncate(reason)
            }
          ],
          '#2ECC71'
        );

        return interaction.reply({
          content:
            `✅ Removed the timeout from **${target.user.tag}**.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /lock + /unlock
      // --------------------------------------------------------------
      if (
        commandName === 'lock' ||
        commandName === 'unlock'
      ) {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.ManageChannels
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const channel =
          options.getChannel('channel') ||
          interaction.channel;

        if (
          !channel?.permissionOverwrites?.edit
        ) {
          return interaction.reply({
            content:
              '❌ That channel cannot have permissions changed.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const everyone =
          guild.roles.everyone;

        if (commandName === 'lock') {
          await channel.permissionOverwrites.edit(
            everyone,
            {
              SendMessages: false,
              AddReactions: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false,
              SendMessagesInThreads: false
            }
          );

          await logEvent(
            guild,
            'Channel Locked',
            [
              {
                name: 'Channel',
                value: `${channel}`
              },
              {
                name: 'Moderator',
                value:
                  interaction.user.tag
              }
            ],
            '#E67E22'
          );

          return interaction.reply({
            content:
              `🔒 Locked ${channel}.`,
            flags:
              MessageFlags.Ephemeral
          });
        }

        await channel.permissionOverwrites.edit(
          everyone,
          {
            SendMessages: null,
            AddReactions: null,
            CreatePublicThreads: null,
            CreatePrivateThreads: null,
            SendMessagesInThreads: null
          }
        );

        await logEvent(
          guild,
          'Channel Unlocked',
          [
            {
              name: 'Channel',
              value: `${channel}`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            }
          ],
          '#2ECC71'
        );

        return interaction.reply({
          content:
            `🔓 Unlocked ${channel}.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /slowmode
      // --------------------------------------------------------------
      if (commandName === 'slowmode') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.ManageChannels
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const channel =
          options.getChannel('channel') ||
          interaction.channel;

        if (
          !channel?.setRateLimitPerUser
        ) {
          return interaction.reply({
            content:
              '❌ That channel does not support slowmode.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const seconds =
          options.getInteger('seconds');

        await channel.setRateLimitPerUser(
          seconds,
          `Changed by ${interaction.user.tag}`
        );

        await logEvent(
          guild,
          'Slowmode Changed',
          [
            {
              name: 'Channel',
              value: `${channel}`
            },
            {
              name: 'Seconds',
              value: String(seconds)
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            }
          ],
          '#3498DB'
        );

        return interaction.reply({
          content:
            `🐢 Set slowmode in ${channel} to **${seconds}s**.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /nick
      // --------------------------------------------------------------
      if (commandName === 'nick') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.ManageNicknames
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const target =
          options.getMember('target');

        if (!target) {
          return interaction.reply({
            content:
              '❌ Member not found.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        if (!target.manageable) {
          return interaction.reply({
            content:
              '❌ I cannot change that member because of role hierarchy.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const nickname =
          options.getString('nickname');

        await target.setNickname(
          nickname || null,
          `Changed by ${interaction.user.tag}`
        );

        await logEvent(
          guild,
          'Nickname Changed',
          [
            {
              name: 'User',
              value:
                `${target.user.tag} ` +
                `(${target.id})`
            },
            {
              name: 'Nickname',
              value:
                nickname || 'Removed'
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            }
          ],
          '#3498DB'
        );

        return interaction.reply({
          content:
            `✅ Nickname updated for **${target.user.tag}**.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /deafen + /undeafen + /move
      // --------------------------------------------------------------
      if (
        commandName === 'deafen' ||
        commandName === 'undeafen' ||
        commandName === 'move'
      ) {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.MoveMembers
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const target =
          options.getMember('target');

        if (
          !target?.voice?.channel
        ) {
          return interaction.reply({
            content:
              '❌ That member is not in a voice channel.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        if (commandName === 'deafen') {
          await target.voice.setDeaf(
            true,
            `Deafened by ${interaction.user.tag}`
          );

          await logEvent(
            guild,
            'Member Server Deafened',
            [
              {
                name: 'User',
                value:
                  `${target.user.tag} ` +
                  `(${target.id})`
              },
              {
                name: 'Moderator',
                value:
                  interaction.user.tag
              }
            ],
            '#E67E22'
          );

          return interaction.reply({
            content:
              `🔇 Server-deafened **${target.user.tag}**.`,
            flags:
              MessageFlags.Ephemeral
          });
        }

        if (commandName === 'undeafen') {
          await target.voice.setDeaf(
            false,
            `Undeafened by ${interaction.user.tag}`
          );

          await logEvent(
            guild,
            'Member Server Undeafened',
            [
              {
                name: 'User',
                value:
                  `${target.user.tag} ` +
                  `(${target.id})`
              },
              {
                name: 'Moderator',
                value:
                  interaction.user.tag
              }
            ],
            '#2ECC71'
          );

          return interaction.reply({
            content:
              `🔊 Removed server-deafen from **${target.user.tag}**.`,
            flags:
              MessageFlags.Ephemeral
          });
        }

        const channel =
          options.getChannel('channel');

        if (!channel.isVoiceBased()) {
          return interaction.reply({
            content:
              '❌ Choose a voice or stage channel.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        await target.voice.setChannel(
          channel,
          `Moved by ${interaction.user.tag}`
        );

        await logEvent(
          guild,
          'Member Moved',
          [
            {
              name: 'User',
              value:
                `${target.user.tag} ` +
                `(${target.id})`
            },
            {
              name: 'Channel',
              value:
                `${channel}`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            }
          ],
          '#3498DB'
        );

        return interaction.reply({
          content:
            `🔊 Moved **${target.user.tag}** to ${channel}.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // Member information commands
      // --------------------------------------------------------------
      if (commandName === 'userinfo') {
        const target =
          options.getMember('target') ||
          await guild.members
            .fetch(
              options.getUser('target').id
            )
            .catch(() => null);

        if (!target) {
          return interaction.reply({
            content:
              '❌ Member not found.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const embed =
          new EmbedBuilder()
            .setTitle(
              `👤 ${target.user.tag}`
            )
            .setThumbnail(
              target.displayAvatarURL({
                size: 256
              })
            )
            .addFields(
              {
                name: 'User ID',
                value: target.id,
                inline: true
              },
              {
                name: 'Joined server',
                value:
                  target.joinedAt
                    ? `<t:${Math.floor(
                        target.joinedTimestamp / 1000
                      )}:F>`
                    : 'Unknown',
                inline: true
              },
              {
                name: 'Account created',
                value:
                  `<t:${Math.floor(
                    target.user.createdTimestamp / 1000
                  )}:F>`,
                inline: true
              },
              {
                name: 'Nickname',
                value:
                  target.nickname || 'None',
                inline: true
              },
              {
                name: 'Roles',
                value:
                  target.roles.cache
                    .filter(
                      r => r.id !== guild.id
                    )
                    .map(r => `${r}`)
                    .join(', ') ||
                  'None'
              }
            )
            .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          flags:
            MessageFlags.Ephemeral
        });
      }

      if (
        commandName === 'avatar' ||
        commandName === 'serveravatar' ||
        commandName === 'banner'
      ) {
        const user =
          options.getUser('target') ||
          interaction.user;

        if (commandName === 'banner') {
          const fetched =
            await client.users.fetch(
              user.id,
              { force: true }
            );

          const url =
            fetched.bannerURL({
              size: 1024,
              extension: 'png'
            });

          return interaction.reply({
            content:
              url
                ? `🖼️ **${fetched.tag}**\n${url}`
                : `❌ **${fetched.tag}** does not have a banner.`,
            flags:
              MessageFlags.Ephemeral
          });
        }

        const member =
          await guild.members
            .fetch(user.id)
            .catch(() => null);

        const url =
          commandName === 'serveravatar'
            ? member?.avatarURL({
                size: 1024
              })
            : user.displayAvatarURL({
                size: 1024
              });

        return interaction.reply({
          content:
            url
              ? `🖼️ **${user.tag}**\n${url}`
              : `❌ No server avatar is set for **${user.tag}**.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      if (commandName === 'membercount') {
        return interaction.reply({
          content:
            `👥 **${guild.name}** has **${guild.memberCount.toLocaleString()}** members.`,
          flags:
            MessageFlags.Ephemeral
        });
      }

      if (commandName === 'roleinfo') {
        const role =
          options.getRole('role');

        const embed =
          new EmbedBuilder()
            .setTitle(
              `🎭 ${role.name}`
            )
            .addFields(
              {
                name: 'Role ID',
                value: role.id,
                inline: true
              },
              {
                name: 'Members',
                value:
                  String(role.members.size),
                inline: true
              },
              {
                name: 'Position',
                value:
                  String(role.position),
                inline: true
              },
              {
                name: 'Mentionable',
                value:
                  role.mentionable
                    ? 'Yes'
                    : 'No',
                inline: true
              },
              {
                name: 'Managed',
                value:
                  role.managed
                    ? 'Yes'
                    : 'No',
                inline: true
              }
            )
            .setColor(
              role.color || null
            );

        return interaction.reply({
          embeds: [embed],
          flags:
            MessageFlags.Ephemeral
        });
      }
            if (commandName === 'channelinfo') {
        const channel =
          options.getChannel('channel') ||
          interaction.channel;

        const embed =
          new EmbedBuilder()
            .setTitle(
              `📺 ${channel.name}`
            )
            .addFields(
              {
                name: 'Channel ID',
                value: channel.id,
                inline: true
              },
              {
                name: 'Type',
                value:
                  String(channel.type),
                inline: true
              },
              {
                name: 'Category',
                value:
                  channel.parent
                    ? `${channel.parent}`
                    : 'None',
                inline: true
              },
              {
                name: 'Position',
                value:
                  String(channel.position),
                inline: true
              }
            )
            .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          flags:
            MessageFlags.Ephemeral
        });
      }

      // --------------------------------------------------------------
      // /purge — up to 1000 using batches of 100
      // --------------------------------------------------------------
      if (commandName === 'purge') {
        if (
          !hasPermission(
            interaction,
            PermissionFlagsBits.ManageMessages
          )
        ) {
          return interaction.reply({
            content:
              '❌ Permission denied.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        const amount =
          options.getInteger('amount');

        if (
          amount < 1 ||
          amount > 1000
        ) {
          return interaction.reply({
            content:
              'Please specify an amount between 1 and 1000.',
            flags:
              MessageFlags.Ephemeral
          });
        }

        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral
        });

        let remaining = amount;
        let totalDeleted = 0;

        while (remaining > 0) {
          const batch =
            Math.min(remaining, 100);

          const deleted =
            await interaction.channel
              .bulkDelete(
                batch,
                true
              );

          totalDeleted +=
            deleted.size;

          remaining -= batch;

          if (
            deleted.size < batch
          ) {
            break;
          }
        }

        await interaction.editReply({
          content:
            `🧹 Deleted ${totalDeleted} messages.`
        });

        await createCase(guild, {
          targetId:
            interaction.user.id,
          targetTag:
            interaction.user.tag,
          moderatorId:
            interaction.user.id,
          moderatorTag:
            interaction.user.tag,
          type: 'Purge',
          reason:
            `${totalDeleted} messages in ${interaction.channel}`
        });

        await logEvent(
          guild,
          'Messages Purged',
          [
            {
              name: 'Channel',
              value:
                `${interaction.channel}`
            },
            {
              name: 'Amount',
              value:
                `${totalDeleted}`
            },
            {
              name: 'Moderator',
              value:
                interaction.user.tag
            }
          ],
          '#F1C40F'
        );

        return;
      }

    } catch (err) {
      console.error(
        `[Command Error] /${commandName}:`,
        err
      );

      const msg =
        '⚠️ An error occurred while executing this command.';

      if (
        interaction.replied ||
        interaction.deferred
      ) {
        await interaction.followUp({
          content: msg,
          flags:
            MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: msg,
          flags:
            MessageFlags.Ephemeral
        });
      }
    }
  }
);

// ------------------------------------------------------------------
// 10. MESSAGE LOGGING
// ------------------------------------------------------------------

// New messages.
client.on(
  Events.MessageCreate,
  async message => {
    if (
      !message.guild ||
      message.author.bot
    ) return;

    const config =
      settingsCache[message.guild.id] ||
      {};

    if (
      config.logChannelId ===
      message.channel.id
    ) return;

    await logEvent(
      message.guild,
      'Message Sent',
      [
        {
          name: 'Author',
          value:
            `${message.author.tag} ` +
            `(${message.author.id})`
        },
        {
          name: 'Channel',
          value:
            `${message.channel}`
        },
        {
          name: 'Content',
          value:
            truncate(
              message.content,
              1000
            )
        }
      ],
      '#3498DB'
    );
  }
);

// Edited messages.
client.on(
  Events.MessageUpdate,
  async (
    oldMessage,
    newMessage
  ) => {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    const config =
      settingsCache[
        newMessage.guild.id
      ] || {};

    if (
      config.logChannelId ===
      newMessage.channel?.id
    ) return;

    const oldContent =
      oldMessage.content ||
      '*Unavailable*';

    const newContent =
      newMessage.content ||
      '*No text content*';

    if (
      oldContent === newContent
    ) return;

    await logEvent(
      newMessage.guild,
      'Message Edited',
      [
        {
          name: 'Author',
          value:
            `${newMessage.author?.tag || 'Unknown'} ` +
            `(${newMessage.author?.id || 'Unknown'})`
        },
        {
          name: 'Channel',
          value:
            `${newMessage.channel}`
        },
        {
          name: 'Before',
          value:
            truncate(
              oldContent,
              900
            )
        },
        {
          name: 'After',
          value:
            truncate(
              newContent,
              900
            )
        }
      ],
      '#F1C40F'
    );
  }
);

// Deleted messages.
client.on(
  Events.MessageDelete,
  async message => {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const config =
      settingsCache[
        message.guild.id
      ] || {};

    if (
      config.logChannelId ===
      message.channel?.id
    ) return;

    await logEvent(
      message.guild,
      'Message Deleted',
      [
        {
          name: 'Author',
          value:
            `${message.author?.tag || 'Unknown'} ` +
            `(${message.author?.id || 'Unknown'})`
        },
        {
          name: 'Channel',
          value:
            `${message.channel}`
        },
        {
          name: 'Content',
          value:
            truncate(
              message.content,
              1000
            )
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

// Bulk deletes.
client.on(
  Events.MessageBulkDelete,
  async messages => {
    const first =
      messages.first();

    if (!first?.guild) return;

    const config =
      settingsCache[
        first.guild.id
      ] || {};

    if (
      config.logChannelId ===
      first.channel?.id
    ) return;

    await logEvent(
      first.guild,
      'Bulk Message Delete',
      [
        {
          name: 'Channel',
          value:
            `${first.channel}`
        },
        {
          name: 'Messages Deleted',
          value:
            `${messages.size}`
        },
        {
          name: 'Moderator',
          value:
            'See audit log / purge command log'
        }
      ],
      '#E67E22'
    );
  }
);

// ------------------------------------------------------------------
// 11. SERVER / CHANNEL / ROLE / MEMBER / MODERATION LOGGING
// ------------------------------------------------------------------

client.on(
  Events.GuildCreate,
  async guild => {
    await logEvent(
      guild,
      'Bot Added to Server',
      [
        {
          name: 'Server',
          value:
            `${guild.name} (${guild.id})`
        }
      ],
      '#2ECC71'
    );
  }
);

client.on(
  Events.GuildDelete,
  async guild => {
    console.log(
      `[Guild] Removed from ${guild.name} (${guild.id})`
    );
  }
);

client.on(
  Events.GuildUpdate,
  async (
    oldGuild,
    newGuild
  ) => {
    const changes = [];

    if (
      oldGuild.name !==
      newGuild.name
    ) {
      changes.push({
        name: 'Name',
        value:
          `${truncate(oldGuild.name)} → ${truncate(newGuild.name)}`
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

    if (changes.length) {
      await logEvent(
        newGuild,
        'Server Updated',
        changes,
        '#9B59B6'
      );
    }
  }
);

client.on(
  Events.ChannelCreate,
  async channel => {
    if (!channel.guild) return;

    await logEvent(
      channel.guild,
      'Channel Created',
      [
        {
          name: 'Channel',
          value:
            `${channel}`
        },
        {
          name: 'Name',
          value:
            channel.name
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

client.on(
  Events.ChannelDelete,
  async channel => {
    if (!channel.guild) return;

    await logEvent(
      channel.guild,
      'Channel Deleted',
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

client.on(
  Events.ChannelUpdate,
  async (
    oldChannel,
    newChannel
  ) => {
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

    if (changes.length) {
      await logEvent(
        newChannel.guild,
        'Channel Updated',
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
  }
);

client.on(
  Events.RoleCreate,
  async role => {
    await logEvent(
      role.guild,
      'Role Created',
      [
        {
          name: 'Role',
          value:
            `${role} (${role.id})`
        },
        {
          name: 'Name',
          value:
            role.name
        }
      ],
      '#2ECC71'
    );
  }
);

client.on(
  Events.RoleDelete,
  async role => {
    await logEvent(
      role.guild,
      'Role Deleted',
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

client.on(
  Events.RoleUpdate,
  async (
    oldRole,
    newRole
  ) => {
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

    if (changes.length) {
      await logEvent(
        newRole.guild,
        'Role Updated',
        [
          {
            name: 'Role',
            value:
              `${newRole} (${newRole.id})`
          },
          ...changes
        ],
        '#9B59B6'
      );
    }
  }
);

client.on(
  Events.GuildMemberAdd,
  async member => {
    await logEvent(
      member.guild,
      'Member Joined',
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

client.on(
  Events.GuildMemberRemove,
  async member => {
    await logEvent(
      member.guild,
      'Member Left / Removed',
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

client.on(
  Events.GuildMemberUpdate,
  async (
    oldMember,
    newMember
  ) => {
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
        .map(r => r.id)
        .sort()
        .join(',');

    const newRoles =
      newMember.roles.cache
        .map(r => r.id)
        .sort()
        .join(',');

    if (
      oldRoles !== newRoles
    ) {
      changes.push({
        name: 'Roles',
        value:
          'Member roles changed.'
      });
    }

    if (changes.length) {
      await logEvent(
        newMember.guild,
        'Member Updated',
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
  }
);

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
      'Member Banned',
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
            ban.reason ||
            'No reason provided'
        }
      ],
      '#992D22'
    );
  }
);

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
      'Member Unbanned',
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

client.on(
  Events.VoiceStateUpdate,
  async (
    oldState,
    newState
  ) => {
    if (!newState.guild) return;

    if (
      !oldState.channelId &&
      newState.channelId
    ) {
      await logEvent(
        newState.guild,
        'Voice Channel Joined',
        [
          {
            name: 'Member',
            value:
              `${newState.member?.user.tag || newState.id} (${newState.id})`
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

    if (
      oldState.channelId &&
      !newState.channelId
    ) {
      await logEvent(
        newState.guild,
        'Voice Channel Left',
        [
          {
            name: 'Member',
            value:
              `${newState.member?.user.tag || newState.id} (${newState.id})`
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

    if (
      oldState.channelId !==
      newState.channelId
    ) {
      await logEvent(
        newState.guild,
        'Voice Channel Moved',
        [
          {
            name: 'Member',
            value:
              `${newState.member?.user.tag || newState.id} (${newState.id})`
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

// ------------------------------------------------------------------
// 12. LOGIN
// ------------------------------------------------------------------
client.login(
  process.env.DISCORD_TOKEN ||
  process.env.TOKEN
);
