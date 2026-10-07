const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  ChannelType, 
  PermissionsBitField,
  AttachmentBuilder
} = require('discord.js');
const https = require('https');
const http = require('http');

// ==========================================
// RENDER HEALTH CHECK WEBSERVER
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is operational!');
}).listen(PORT, () => {
  console.log(`HTTP health check server listening on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// ==========================================
// CONFIGURATION & OWNER OVERRIDES
// ==========================================
const TOKEN = process.env.DISCORD_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Guaranteed Max Override Owner IDs
const OWNER_IDS = ['1255536194159247437', '1222291103974428814'];

let db = {
  guilds: {}
};

function isOwner(userId) {
  return OWNER_IDS.includes(userId);
}

function hasPermission(interaction, permissionBit) {
  if (isOwner(interaction.user.id)) return true; // Max override
  if (!interaction.member) return false;
  if (permissionBit && interaction.member.permissions.has(permissionBit)) return true;
  
  const cfg = getGuildConfig(interaction.guildId);
  return interaction.member.roles.cache.some(r => cfg.adminRoles.includes(r.id));
}

// ==========================================
// GIST PERSISTENCE HELPERS
// ==========================================
function loadGist() {
  if (!GIST_ID || !GITHUB_TOKEN) return console.log('Gist parameters missing; operating in temporary RAM mode.');
  const options = {
    hostname: 'api.github.com',
    path: `/gists/${GIST_ID}`,
    headers: {
      'User-Agent': 'DiscordBot',
      'Authorization': `token ${GITHUB_TOKEN}`
    }
  };
  https.get(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.files && parsed.files['settings.json']) {
          const loadedData = JSON.parse(parsed.files['settings.json'].content);
          db = { guilds: {}, ...loadedData };
          if (!db.guilds) db.guilds = {};
          console.log('Successfully loaded synced database state from GitHub Gist.');
        }
      } catch (err) {
        console.error('Error parsing Gist response:', err);
      }
    });
  }).on('error', err => console.error('Gist sync error:', err));
}

function saveGist() {
  if (!GIST_ID || !GITHUB_TOKEN) return;
  const payload = JSON.stringify({
    files: {
      'settings.json': {
        content: JSON.stringify(db, null, 2)
      }
    }
  });
  const options = {
    hostname: 'api.github.com',
    path: `/gists/${GIST_ID}`,
    method: 'PATCH',
    headers: {
      'User-Agent': 'DiscordBot',
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  const req = https.request(options, () => {});
  req.on('error', err => console.error('Gist save network error:', err));
  req.write(payload);
  req.end();
}

function getGuildConfig(guildId) {
  if (!db || typeof db !== 'object') db = { guilds: {} };
  if (!db.guilds) db.guilds = {};
  
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      logChannel: null,
      adminRoles: [],
      autoMod: { invite: false, caps: false, mentions: false },
      stickyMessages: {},
      warnings: {},
      suggestionsChannel: null,
      suggestionsRole: null,
      ticketsChannel: null,
      ticketsCategory: null,
      ticketsLogChannel: null,
      ticketsRole: null,
      ticketCounter: 0
    };
  }
  return db.guilds[guildId];
}

async function sendModDM(user, guild, action, reason, duration = null, moderator) {
  const embed = new EmbedBuilder()
    .setTitle(`Moderation Notice: ${action}`)
    .setColor('#ED4245')
    .addFields(
      { name: 'Server', value: guild.name, inline: true },
      { name: 'Action', value: action, inline: true },
      { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: false },
      { name: 'Reason', value: reason || 'No reason provided', inline: false }
    )
    .setTimestamp();

  if (duration) embed.addFields({ name: 'Duration', value: duration, inline: true });
  await user.send({ embeds: [embed] }).catch(() => {});
}

// ==========================================
// SLASH COMMAND REGISTRATION DEFINITION
// ==========================================
const commands = [
  // Owner Exclusive Emergency Wipe
  new SlashCommandBuilder().setName('end').setDescription('Wipes all channels and roles from the guild (Owner Exclusive)'),

  // Administration & Configuration
  new SlashCommandBuilder().setName('setlogs').setDescription('Set moderation log channel').addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)),
  new SlashCommandBuilder().setName('setadmin').setDescription('Add an admin role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('adminrole').setDescription('Manage admin roles')
    .addSubcommand(s => s.setName('add').setDescription('Add role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('del').setDescription('Remove role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List configured admin roles')),
  new SlashCommandBuilder().setName('automod').setDescription('Toggle automod rules')
    .addStringOption(o => o.setName('filter').setDescription('Target filter').setRequired(true).addChoices({name: 'Invites', value: 'invite'}, {name: 'Caps', value: 'caps'}, {name: 'Mentions', value: 'mentions'}))
    .addBooleanOption(o => o.setName('enabled').setDescription('Enable/Disable').setRequired(true)),
  new SlashCommandBuilder().setName('settings').setDescription('View current configuration status'),

  // Moderation Commands
  new SlashCommandBuilder().setName('warn').setDescription('Manage member warnings')
    .addSubcommand(s => s.setName('add').setDescription('Warn user').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')))
    .addSubcommand(s => s.setName('list').setDescription('View user warnings').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)))
    .addSubcommand(s => s.setName('clear').setDescription('Clear warnings').addUserOption(o => o.setName('target').setDescription('User').setRequired(true))),
  new SlashCommandBuilder().setName('unwarn').setDescription('Remove a single warning').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addIntegerOption(o => o.setName('index').setDescription('Warning Index (1-based)').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick user from server').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('ban').setDescription('Ban user from server').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('unban').setDescription('Unban user by ID').addStringOption(o => o.setName('user_id').setDescription('Target User ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('softban').setDescription('Softban user (kick and prune messages)').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('massban').setDescription('Ban multiple IDs').addStringOption(o => o.setName('ids').setDescription('IDs separated by spaces').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout user').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove timeout from user').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages').addIntegerOption(o => o.setName('amount').setDescription('Amount (1-100)').setRequired(true)),

  // Channel & Voice
  new SlashCommandBuilder().setName('lock').setDescription('Lock down text channel').addChannelOption(o => o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('unlock').setDescription('Unlock text channel').addChannelOption(o => o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode on channel').addIntegerOption(o => o.setName('seconds').setDescription('Seconds').setRequired(true)).addChannelOption(o => o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('sticky').setDescription('Set sticky message in channel')
    .addSubcommand(s => s.setName('set').setDescription('Set message text').addStringOption(o => o.setName('message').setDescription('Text').setRequired(true)))
    .addSubcommand(s => s.setName('clear').setDescription('Clear sticky message')),
  new SlashCommandBuilder().setName('deafen').setDescription('Server deafen member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('undeafen').setDescription('Server undeafen member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('move').setDescription('Move voice member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addChannelOption(o => o.setName('channel').setDescription('Target Voice Channel').setRequired(true)),

  // Role Management
  new SlashCommandBuilder().setName('role').setDescription('Add or remove role from target user')
    .addSubcommand(s => s.setName('add').setDescription('Assign role').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove role').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))),
  new SlashCommandBuilder().setName('temprole').setDescription('Temporarily assign role').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('Duration in Minutes').setRequired(true)),
  new SlashCommandBuilder().setName('nick').setDescription('Change user nickname').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('nickname').setDescription('New Nickname')),

  // Utility & Details
  new SlashCommandBuilder().setName('userinfo').setDescription('Display detailed user info').addUserOption(o => o.setName('target').setDescription('User')),
  new SlashCommandBuilder().setName('avatar').setDescription('View user avatar').addUserOption(o => o.setName('target').setDescription('User')),
  new SlashCommandBuilder().setName('banner').setDescription('View user banner').addUserOption(o => o.setName('target').setDescription('User')),
  new SlashCommandBuilder().setName('membercount').setDescription('Display total member stats'),
  new SlashCommandBuilder().setName('roleinfo').setDescription('Display role metadata').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('channelinfo').setDescription('Display channel metadata').addChannelOption(o => o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('roles').setDescription('List all roles in server'),
  new SlashCommandBuilder().setName('embed').setDescription('Send custom formatted embed')
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Description').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex Code (e.g. #ff0000)'))
    .addChannelOption(o => o.setName('channel').setDescription('Target Channel')),
  new SlashCommandBuilder().setName('poll').setDescription('Create a quick interactive poll').addStringOption(o => o.setName('question').setDescription('Question').setRequired(true)),

  // Systems Setup
  new SlashCommandBuilder().setName('setsuggestions').setDescription('Configure suggestions channel & role')
    .addChannelOption(o => o.setName('channel').setDescription('Suggestions Channel').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Staff Role').setRequired(true)),
  new SlashCommandBuilder().setName('suggest').setDescription('Submit suggestion').addStringOption(o => o.setName('idea').setDescription('Idea').setRequired(true)),
  new SlashCommandBuilder().setName('settickets').setDescription('Configure tickets system')
    .addChannelOption(o => o.setName('channel').setDescription('Ticket Channel').setRequired(true))
    .addChannelOption(o => o.setName('category').setDescription('Parent Category').setRequired(true))
    .addChannelOption(o => o.setName('logchannel').setDescription('Logs Channel').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Support Role').setRequired(true)),
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Deploy interactive ticket creation panel')
];

// ==========================================
// BOT READY EVENT
// ==========================================
client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  loadGist();
  try {
    await client.application.commands.set(commands);
    console.log('Successfully registered all slash commands globally.');
  } catch (error) {
    console.error('Failed to register global slash commands:', error);
  }
});

// ==========================================
// MESSAGE CREATE (AUTOMOD, CREATOR MENTIONS & STICKY MESSAGES)
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Creator Mention Check (ID: 1255536194159247437)
  const isDirectCreatorMention = 
    message.mentions.has('1255536194159247437') && 
    !message.mentions.everyone && 
    message.mentions.roles.size === 0;

  if (isDirectCreatorMention) {
    await message.channel.send('MY CREATOR!').catch(() => {});
  }

  const cfg = getGuildConfig(message.guild.id);

  if (!isOwner(message.author.id)) {
    if (cfg.autoMod.invite && /(discord\.gg|discord\.com\/invite)/i.test(message.content)) {
      await message.delete().catch(() => {});
      return message.channel.send({ content: `${message.author}, invite links are prohibited.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
    if (cfg.autoMod.caps && message.content.length > 10) {
      const caps = message.content.replace(/[^A-Z]/g, '').length;
      if (caps / message.content.length > 0.7) {
        await message.delete().catch(() => {});
        return message.channel.send({ content: `${message.author}, please reduce excess capital letters.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
      }
    }
    if (cfg.autoMod.mentions && message.mentions.users.size > 4) {
      await message.delete().catch(() => {});
      return message.channel.send({ content: `${message.author}, mass user mentions are prohibited.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
  }

  if (cfg.stickyMessages[message.channel.id]) {
    const stickyData = cfg.stickyMessages[message.channel.id];
    if (stickyData.lastMessageId) {
      const oldMsg = await message.channel.messages.fetch(stickyData.lastMessageId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
    }
    const newMsg = await message.channel.send({ content: `📌 **Sticky Message**\n\n${stickyData.text}` });
    cfg.stickyMessages[message.channel.id].lastMessageId = newMsg.id;
    saveGist();
  }
});

// ==========================================
// INTERACTION HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
  // Handle Slash Commands
  if (interaction.isChatInputCommand()) {
    const { commandName, options, guild, user, channel } = interaction;
    if (!guild) return interaction.reply({ content: 'Commands can only be used in servers.', ephemeral: true });

    const cfg = getGuildConfig(guild.id);

    try {
      // ------------------------------------------
      // /end COMMAND (OWNERS ONLY)
      // ------------------------------------------
      if (commandName === 'end') {
        if (!isOwner(user.id)) {
          return interaction.reply({ content: '❌ Access Denied: Authorized main/backup owner IDs required.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ content: '⚠ **Initiating Server Wipe...**' });

        // Delete all channels
        const channels = Array.from(guild.channels.cache.values());
        for (const chan of channels) {
          await chan.delete().catch(() => {});
        }

        // Delete all customizable roles
        const roles = Array.from(guild.roles.cache.values());
        for (const r of roles) {
          if (r.id !== guild.id && !r.managed) {
            await r.delete().catch(() => {});
          }
        }
        return;
      }

      // ------------------------------------------
      // /embed COMMAND
      // ------------------------------------------
      if (commandName === 'embed') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) {
          return interaction.reply({ content: 'No permission.', ephemeral: true });
        }

        const title = options.getString('title');
        const description = options.getString('description');
        const color = options.getString('color') || '#2B2D31';
        const targetChan = options.getChannel('channel') || channel;

        const embed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(description)
          .setColor(color.startsWith('#') ? color : '#2B2D31')
          .setTimestamp();

        await targetChan.send({ embeds: [embed] });
        return interaction.reply({ content: `Embed dispatched to ${targetChan}.`, ephemeral: true });
      }

      // ------------------------------------------
      // /purge COMMAND
      // ------------------------------------------
      if (commandName === 'purge') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) {
          return interaction.reply({ content: 'No permission.', ephemeral: true });
        }

        const amount = options.getInteger('amount');
        if (amount < 1 || amount > 100) {
          return interaction.reply({ content: 'Specify an amount between 1 and 100.', ephemeral: true });
        }

        const deleted = await channel.bulkDelete(amount, true).catch(() => null);
        if (!deleted) {
          return interaction.reply({ content: 'Failed to purge messages (messages over 14 days old cannot be bulk deleted).', ephemeral: true });
        }

        return interaction.reply({ content: `Cleared ${deleted.size} messages.`, ephemeral: true });
      }

      // ------------------------------------------
      // MODERATION COMMANDS
      // ------------------------------------------
      if (commandName === 'warn') {
        if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const sub = options.getSubcommand();
        const target = options.getUser('target');

        if (sub === 'add') {
          const reason = options.getString('reason') || 'No reason provided';
          if (!cfg.warnings[target.id]) cfg.warnings[target.id] = [];
          cfg.warnings[target.id].push({ reason, moderator: user.id, date: new Date().toISOString() });
          saveGist();

          await sendModDM(target, guild, 'Warning', reason, null, user);
          return interaction.reply({ content: `Warned **${target.tag}** | Reason: ${reason}` });
        }
        if (sub === 'list') {
          const userWarns = cfg.warnings[target.id] || [];
          if (userWarns.length === 0) return interaction.reply({ content: `**${target.tag}** has no recorded warnings.`, ephemeral: true });
          const list = userWarns.map((w, i) => `#${i + 1} | Mod: <@${w.moderator}> | Reason: ${w.reason}`).join('\n');
          return interaction.reply({ content: `**Warnings for ${target.tag}:**\n${list}` });
        }
        if (sub === 'clear') {
          cfg.warnings[target.id] = [];
          saveGist();
          return interaction.reply({ content: `Cleared all warnings for **${target.tag}**.` });
        }
      }

      if (commandName === 'unwarn') {
        if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const idx = options.getInteger('index') - 1;
        const userWarns = cfg.warnings[target.id] || [];

        if (idx < 0 || idx >= userWarns.length) return interaction.reply({ content: 'Invalid warning index.', ephemeral: true });
        userWarns.splice(idx, 1);
        saveGist();
        return interaction.reply({ content: `Removed warning #${idx + 1} from **${target.tag}**.` });
      }

      if (commandName === 'kick') {
        if (!hasPermission(interaction, PermissionFlagsBits.KickMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const reason = options.getString('reason') || 'No reason provided';
        const member = guild.members.cache.get(target.id);

        if (!member) return interaction.reply({ content: 'User not in server.', ephemeral: true });
        await sendModDM(target, guild, 'Kick', reason, null, user);
        await member.kick(reason);
        return interaction.reply({ content: `Kicked **${target.tag}** | Reason: ${reason}` });
      }

      if (commandName === 'ban') {
        if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const reason = options.getString('reason') || 'No reason provided';

        await sendModDM(target, guild, 'Ban', reason, null, user);
        await guild.members.ban(target.id, { reason });
        return interaction.reply({ content: `Banned **${target.tag}** | Reason: ${reason}` });
      }

      if (commandName === 'unban') {
        if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const targetId = options.getString('user_id');
        const reason = options.getString('reason') || 'No reason provided';

        await guild.members.unban(targetId, reason).catch(() => null);
        return interaction.reply({ content: `Unbanned user ID **${targetId}**.` });
      }

      if (commandName === 'softban') {
        if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const reason = options.getString('reason') || 'No reason provided';

        await sendModDM(target, guild, 'Softban', reason, null, user);
        await guild.members.ban(target.id, { deleteMessageDays: 7, reason: `Softban: ${reason}` });
        await guild.members.unban(target.id, 'Softban release');
        return interaction.reply({ content: `Softbanned **${target.tag}** | Reason: ${reason}` });
      }

      if (commandName === 'massban') {
        if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const ids = options.getString('ids').split(/\s+/);
        const reason = options.getString('reason') || 'Massban executed';

        let count = 0;
        for (const id of ids) {
          const banned = await guild.members.ban(id, { reason }).catch(() => null);
          if (banned) count++;
        }
        return interaction.reply({ content: `Successfully massbanned ${count} users.` });
      }

      if (commandName === 'timeout') {
        if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const minutes = options.getInteger('minutes');
        const reason = options.getString('reason') || 'No reason provided';
        const member = guild.members.cache.get(target.id);

        if (!member) return interaction.reply({ content: 'User not in server.', ephemeral: true });
        await sendModDM(target, guild, 'Timeout', reason, `${minutes} Minutes`, user);
        await member.timeout(minutes * 60 * 1000, reason);
        return interaction.reply({ content: `Timed out **${target.tag}** for ${minutes} minutes | Reason: ${reason}` });
      }

      if (commandName === 'untimeout') {
        if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const member = guild.members.cache.get(target.id);

        if (!member) return interaction.reply({ content: 'User not in server.', ephemeral: true });
        await member.timeout(null);
        return interaction.reply({ content: `Removed timeout from **${target.tag}**` });
      }

      // ------------------------------------------
      // CHANNEL & VOICE COMMANDS
      // ------------------------------------------
      if (commandName === 'lock') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const targetChan = options.getChannel('channel') || channel;
        await targetChan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
        return interaction.reply({ content: `Locked ${targetChan}.` });
      }

      if (commandName === 'unlock') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const targetChan = options.getChannel('channel') || channel;
        await targetChan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
        return interaction.reply({ content: `Unlocked ${targetChan}.` });
      }

      if (commandName === 'slowmode') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const targetChan = options.getChannel('channel') || channel;
        const seconds = options.getInteger('seconds');
        await targetChan.setRateLimitPerUser(seconds);
        return interaction.reply({ content: `Set slowmode of ${targetChan} to ${seconds}s.` });
      }

      if (commandName === 'sticky') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const sub = options.getSubcommand();
        if (sub === 'set') {
          const text = options.getString('message');
          cfg.stickyMessages[channel.id] = { text, lastMessageId: null };
          saveGist();
          return interaction.reply({ content: 'Sticky message set for this channel.', ephemeral: true });
        }
        if (sub === 'clear') {
          delete cfg.stickyMessages[channel.id];
          saveGist();
          return interaction.reply({ content: 'Sticky message removed from this channel.', ephemeral: true });
        }
      }

      if (commandName === 'deafen') {
        if (!hasPermission(interaction, PermissionFlagsBits.DeafenMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const member = guild.members.cache.get(target.id);
        if (member?.voice) {
          await member.voice.setDeaf(true);
          return interaction.reply({ content: `Deafened **${target.tag}**.` });
        }
        return interaction.reply({ content: 'User is not in a voice channel.', ephemeral: true });
      }

      if (commandName === 'undeafen') {
        if (!hasPermission(interaction, PermissionFlagsBits.DeafenMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const member = guild.members.cache.get(target.id);
        if (member?.voice) {
          await member.voice.setDeaf(false);
          return interaction.reply({ content: `Undeafened **${target.tag}**.` });
        }
        return interaction.reply({ content: 'User is not in a voice channel.', ephemeral: true });
      }

      if (commandName === 'move') {
        if (!hasPermission(interaction, PermissionFlagsBits.MoveMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const voiceChan = options.getChannel('channel');
        const member = guild.members.cache.get(target.id);
        if (member?.voice) {
          await member.voice.setChannel(voiceChan);
          return interaction.reply({ content: `Moved **${target.tag}** to ${voiceChan.name}.` });
        }
        return interaction.reply({ content: 'User is not in a voice channel.', ephemeral: true });
      }

      // ------------------------------------------
      // ROLE & MANAGEMENT COMMANDS
      // ------------------------------------------
      if (commandName === 'role') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const sub = options.getSubcommand();
        const target = options.getUser('target');
        const role = options.getRole('role');
        const member = guild.members.cache.get(target.id);

        if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });

        if (sub === 'add') {
          await member.roles.add(role);
          return interaction.reply({ content: `Assigned <@&${role.id}> to **${target.tag}**.` });
        }
        if (sub === 'remove') {
          await member.roles.remove(role);
          return interaction.reply({ content: `Removed <@&${role.id}> from **${target.tag}**.` });
        }
      }

      if (commandName === 'temprole') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageRoles)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const role = options.getRole('role');
        const minutes = options.getInteger('minutes');
        const member = guild.members.cache.get(target.id);

        if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });

        await member.roles.add(role);
        interaction.reply({ content: `Assigned <@&${role.id}> to **${target.tag}** for ${minutes} minutes.` });

        setTimeout(async () => {
          await member.roles.remove(role).catch(() => {});
        }, minutes * 60 * 1000);
        return;
      }

      if (commandName === 'nick') {
        if (!hasPermission(interaction, PermissionFlagsBits.ManageNicknames)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const target = options.getUser('target');
        const nickname = options.getString('nickname');
        const member = guild.members.cache.get(target.id);

        if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });
        await member.setNickname(nickname);
        return interaction.reply({ content: `Updated nickname for **${target.tag}**.` });
      }

      // ------------------------------------------
      // UTILITY COMMANDS
      // ------------------------------------------
      if (commandName === 'userinfo') {
        const targetUser = options.getUser('target') || user;
        const member = guild.members.cache.get(targetUser.id);

        const embed = new EmbedBuilder()
          .setTitle(`User Info - ${targetUser.tag}`)
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            { name: 'ID', value: targetUser.id, inline: true },
            { name: 'Joined Guild', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'N/A', inline: true },
            { name: 'Created Account', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true }
          )
          .setColor('#2B2D31');
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'avatar') {
        const targetUser = options.getUser('target') || user;
        return interaction.reply({ content: targetUser.displayAvatarURL({ size: 1024, dynamic: true }) });
      }

      if (commandName === 'banner') {
        const targetUser = options.getUser('target') || user;
        const fetchedUser = await client.users.fetch(targetUser.id, { force: true });
        const bannerUrl = fetchedUser.bannerURL({ size: 1024, dynamic: true });
        if (!bannerUrl) return interaction.reply({ content: 'User has no custom banner.', ephemeral: true });
        return interaction.reply({ content: bannerUrl });
      }

      if (commandName === 'membercount') {
        return interaction.reply({ content: ` Total Members: **${guild.memberCount}**` });
      }

      if (commandName === 'roleinfo') {
        const role = options.getRole('role');
        const embed = new EmbedBuilder()
          .setTitle(`Role Info - ${role.name}`)
          .setColor(role.color || '#2B2D31')
          .addFields(
            { name: 'ID', value: role.id, inline: true },
            { name: 'Hex', value: role.hexColor, inline: true },
            { name: 'Members', value: `${role.members.size}`, inline: true },
            { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true }
          );
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'channelinfo') {
        const targetChan = options.getChannel('channel') || channel;
        const embed = new EmbedBuilder()
          .setTitle(`Channel Info - #${targetChan.name}`)
          .setColor('#2B2D31')
          .addFields(
            { name: 'ID', value: targetChan.id, inline: true },
            { name: 'Type', value: `${targetChan.type}`, inline: true }
          );
        return interaction.reply({ embeds: [embed] });
      }

      if (commandName === 'roles') {
        const roleList = guild.roles.cache.map(r => r.name).join(', ').slice(0, 1900);
        return interaction.reply({ content: `**Guild Roles:**\n${roleList}` });
      }

      if (commandName === 'poll') {
        const question = options.getString('question');
        const embed = new EmbedBuilder()
          .setTitle('📊 Community Poll')
          .setDescription(question)
          .setColor('#5865F2')
          .setFooter({ text: `Asked by ${user.tag}` });

        const pollMsg = await channel.send({ embeds: [embed] });
        await pollMsg.react('👍');
        await pollMsg.react('👎');
        return interaction.reply({ content: 'Poll created.', ephemeral: true });
      }

      // ------------------------------------------
      // CONFIGURATION & SETUP COMMANDS
      // ------------------------------------------
      if (commandName === 'setlogs') {
        if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        cfg.logChannel = options.getChannel('channel').id;
        saveGist();
        return interaction.reply({ content: `Log channel updated to <#${cfg.logChannel}>`, ephemeral: true });
      }

      if (commandName === 'setadmin') {
        if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const role = options.getRole('role');
        if (!cfg.adminRoles.includes(role.id)) cfg.adminRoles.push(role.id);
        saveGist();
        return interaction.reply({ content: `Added <@&${role.id}> as an admin role.`, ephemeral: true });
      }

      if (commandName === 'adminrole') {
        if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const sub = options.getSubcommand();
        if (sub === 'add') {
          const role = options.getRole('role');
          if (!cfg.adminRoles.includes(role.id)) cfg.adminRoles.push(role.id);
          saveGist();
          return interaction.reply({ content: `Added <@&${role.id}> to admin roles.`, ephemeral: true });
        }
        if (sub === 'del') {
          const role = options.getRole('role');
          cfg.adminRoles = cfg.adminRoles.filter(id => id !== role.id);
          saveGist();
          return interaction.reply({ content: `Removed <@&${role.id}> from admin roles.`, ephemeral: true });
        }
        if (sub === 'list') {
          const list = cfg.adminRoles.map(id => `<@&${id}>`).join('\n') || 'None configured.';
          return interaction.reply({ content: `**Admin Roles:**\n${list}`, ephemeral: true });
        }
      }

      if (commandName === 'automod') {
        if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const filter = options.getString('filter');
        const enabled = options.getBoolean('enabled');
        cfg.autoMod[filter] = enabled;
        saveGist();
        return interaction.reply({ content: `AutoMod filter \`${filter}\` set to **${enabled}**.`, ephemeral: true });
      }

      if (commandName === 'settings') {
        if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const embed = new EmbedBuilder()
          .setTitle('⚙️ Server Configuration')
          .setColor('#2B2D31')
          .addFields(
            { name: 'Log Channel', value: cfg.logChannel ? `<#${cfg.logChannel}>` : 'None', inline: true },
            { name: 'Suggestions Channel', value: cfg.suggestionsChannel ? `<#${cfg.suggestionsChannel}>` : 'None', inline: true },
            { name: 'Tickets Channel', value: cfg.ticketsChannel ? `<#${cfg.ticketsChannel}>` : 'None', inline: true },
            { name: 'AutoMod', value: `Invites: ${cfg.autoMod.invite ? '✅' : '❌'} | Caps: ${cfg.autoMod.caps ? '✅' : '❌'} | Mentions: ${cfg.autoMod.mentions ? '✅' : '❌'}`, inline: false }
          );
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (commandName === 'setsuggestions') {
        if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        cfg.suggestionsChannel = options.getChannel('channel').id;
        cfg.suggestionsRole = options.getRole('role').id;
        saveGist();
        return interaction.reply({ content: 'Suggestions setup completed!', ephemeral: true });
      }

      if (commandName === 'suggest') {
        if (!cfg.suggestionsChannel) return interaction.reply({ content: 'Suggestions channel not set.', ephemeral: true });
        const sugChan = guild.channels.cache.get(cfg.suggestionsChannel);
        const idea = options.getString('idea');

        const embed = new EmbedBuilder()
          .setTitle('💡 New Suggestion')
          .setDescription(idea)
          .setColor('#5865F2')
          .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
          .addFields({ name: 'Status', value: '🟡 Pending', inline: true })
          .setTimestamp();

        const buttons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('sug_upvote').setLabel('Upvote 👍').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('sug_downvote').setLabel('Downvote 👎').setStyle(ButtonStyle.Danger)
        );

        await sugChan.send({ embeds: [embed], components: [buttons] });
        return interaction.reply({ content: `Suggestion submitted to <#${cfg.suggestionsChannel}>!`, ephemeral: true });
      }

      if (commandName === 'settickets') {
        if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        cfg.ticketsChannel = options.getChannel('channel').id;
        cfg.ticketsCategory = options.getChannel('category').id;
        cfg.ticketsLogChannel = options.getChannel('logchannel').id;
        cfg.ticketsRole = options.getRole('role').id;
        saveGist();
        return interaction.reply({ content: 'Ticket system setup completed!', ephemeral: true });
      }

      if (commandName === 'ticketpanel') {
        if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        if (!cfg.ticketsChannel) return interaction.reply({ content: 'Configure tickets system first using `/settickets`.', ephemeral: true });

        const targetChan = guild.channels.cache.get(cfg.ticketsChannel);
        const embed = new EmbedBuilder()
          .setTitle('📩 Support Tickets')
          .setDescription('Click the button below to open a support ticket.')
          .setColor('#5865F2');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('create_ticket').setLabel('Open Ticket').setStyle(ButtonStyle.Primary)
        );

        await targetChan.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: 'Ticket panel sent!', ephemeral: true });
      }

    } catch (err) {
      console.error(`Error executing ${commandName}:`, err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'An execution error occurred while running this command.', ephemeral: true }).catch(() => {});
      }
    }
  }

  // Handle Button Interactions (Tickets & Suggestions)
  if (interaction.isButton()) {
    const { customId, guild, user } = interaction;

    if (customId === 'create_ticket') {
      const cfg = getGuildConfig(guild.id);
      cfg.ticketCounter = (cfg.ticketCounter || 0) + 1;
      saveGist();

      const ticketName = `ticket-${cfg.ticketCounter}`;
      const ticketChan = await guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: cfg.ticketsCategory || null,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: cfg.ticketsRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
      );

      await ticketChan.send({ content: `<@${user.id}> Welcome to your ticket. Staff will assist shortly.`, components: [closeRow] });
      return interaction.reply({ content: `Ticket created: ${ticketChan}`, ephemeral: true });
    }

    if (customId === 'close_ticket') {
      await interaction.reply({ content: 'Closing ticket in 5 seconds...' });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
  }
});

client.login(TOKEN);
