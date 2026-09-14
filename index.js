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
const fs = require('fs');
const https = require('https');
const http = require('http');

// Simple Web Server to satisfy Render Health Checks
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!');
}).listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
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
// CONFIGURATION & CONSTANTS
// ==========================================
const TOKEN = process.env.DISCORD_TOKEN;
const GIST_ID = process.env.GIST_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const OWNER_IDS = ['1255536194159247437', '1222293971104428814'];

let db = {
  guilds: {}
};

// ==========================================
// GIST PERSISTENCE HELPERS
// ==========================================
function loadGist() {
  if (!GIST_ID || !GITHUB_TOKEN) return console.log('Gist configuration missing; using local memory.');
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
          db = JSON.parse(parsed.files['settings.json'].content);
          console.log('Successfully synced settings from GitHub Gist.');
        }
      } catch (err) {
        console.error('Error parsing Gist data:', err);
      }
    });
  }).on('error', err => console.error('Gist fetch error:', err));
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
  const req = https.request(options, res => {});
  req.on('error', err => console.error('Gist save error:', err));
  req.write(payload);
  req.end();
}

function getGuildConfig(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      logChannel: null,
      adminRoles: [],
      autoMod: { invite: false, caps: false, mentions: false },
      stickyMessages: {},
      cases: [],
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

function isOwner(userId) {
  return OWNER_IDS.includes(userId);
}

function hasPermission(interaction, permissionBit) {
  if (isOwner(interaction.user.id)) return true;
  if (interaction.member.permissions.has(permissionBit)) return true;
  const cfg = getGuildConfig(interaction.guildId);
  return interaction.member.roles.cache.some(r => cfg.adminRoles.includes(r.id));
}

// DM Helper Function
async function sendModDM(user, guild, action, reason, duration = null, moderator) {
  const embed = new EmbedBuilder()
    .setTitle(`Moderation Notice: ${action}`)
    .setColor('#ED4245')
    .setThumbnail(guild.iconURL())
    .addFields(
      { name: 'Server', value: guild.name, inline: true },
      { name: 'Action', value: action, inline: true },
      { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: false },
      { name: 'Reason', value: reason || 'No reason provided', inline: false }
    )
    .setTimestamp();

  if (duration) {
    embed.addFields({ name: 'Duration', value: duration, inline: true });
  }

  await user.send({ embeds: [embed] }).catch(() => {
    // Fails silently if user has DMs disabled
  });
}

// Log Helper Function
async function sendModLog(guild, embed) {
  const cfg = getGuildConfig(guild.id);
  if (!cfg.logChannel) return;
  const chan = guild.channels.cache.get(cfg.logChannel);
  if (chan) await chan.send({ embeds: [embed] }).catch(() => {});
}

// ==========================================
// SLASH COMMANDS DEFINITION
// ==========================================
const commands = [
  // Configuration
  new SlashCommandBuilder().setName('setlogs').setDescription('Set moderation log channel').addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),
  new SlashCommandBuilder().setName('setadmin').setDescription('Set primary bot admin role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('adminrole').setDescription('Manage admin roles')
    .addSubcommand(s => s.setName('add').setDescription('Add role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('del').setDescription('Remove role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List admin roles')),
  new SlashCommandBuilder().setName('automod').setDescription('Configure AutoMod filters')
    .addStringOption(o => o.setName('filter').setDescription('Filter').setRequired(true).addChoices({name: 'Invites', value: 'invite'}, {name: 'Caps', value: 'caps'}, {name: 'Mentions', value: 'mentions'}))
    .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable').setRequired(true)),
  new SlashCommandBuilder().setName('settings').setDescription('View server bot settings'),

  // Moderation
  new SlashCommandBuilder().setName('warn').setDescription('Manage user warnings')
    .addSubcommand(s => s.setName('add').setDescription('Warn user').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')))
    .addSubcommand(s => s.setName('list').setDescription('View warnings').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)))
    .addSubcommand(s => s.setName('clear').setDescription('Clear warnings').addUserOption(o => o.setName('target').setDescription('User').setRequired(true))),
  new SlashCommandBuilder().setName('unwarn').setDescription('Remove a specific warning').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addIntegerOption(o => o.setName('warning').setDescription('Warning Index').setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID').addStringOption(o => o.setName('user_id').setDescription('User ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('softban').setDescription('Softban a member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('massban').setDescription('Massban user IDs').addStringOption(o => o.setName('ids').setDescription('Space separated IDs').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove timeout').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages').addIntegerOption(o => o.setName('amount').setDescription('Amount (1-1000)').setRequired(true)),
  new SlashCommandBuilder().setName('history').setDescription('View mod history of user').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('case').setDescription('Lookup mod case').addIntegerOption(o => o.setName('id').setDescription('Case ID').setRequired(true)),
  new SlashCommandBuilder().setName('reason').setDescription('Update case reason').addIntegerOption(o => o.setName('case').setDescription('Case ID').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('New Reason').setRequired(true)),
  new SlashCommandBuilder().setName('modstats').setDescription('View mod action counts').addUserOption(o => o.setName('target').setDescription('Staff Member')),

  // Channel & Voice
  new SlashCommandBuilder().setName('lock').setDescription('Lock channel').addChannelOption(o => o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('unlock').setDescription('Unlock channel').addChannelOption(o => o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set slowmode rate').addIntegerOption(o => o.setName('seconds').setDescription('Seconds').setRequired(true)).addChannelOption(o => o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('sticky').setDescription('Manage sticky message')
    .addSubcommand(s => s.setName('set').setDescription('Set sticky text').addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)))
    .addSubcommand(s => s.setName('clear').setDescription('Clear sticky text')),
  new SlashCommandBuilder().setName('deafen').setDescription('Server deafen member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('undeafen').setDescription('Server undeafen member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)),
  new SlashCommandBuilder().setName('move').setDescription('Move voice member').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addChannelOption(o => o.setName('channel').setDescription('Voice Channel').setRequired(true)),

  // Roles & Management
  new SlashCommandBuilder().setName('role').setDescription('Add or remove role')
    .addSubcommand(s => s.setName('add').setDescription('Add role').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove role').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))),
  new SlashCommandBuilder().setName('temprole').setDescription('Give temporary role').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)).addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setRequired(true)),
  new SlashCommandBuilder().setName('nick').setDescription('Change user nickname').addUserOption(o => o.setName('target').setDescription('User').setRequired(true)).addStringOption(o => o.setName('nickname').setDescription('New Nickname')),

  // Utility & Tools
  new SlashCommandBuilder().setName('userinfo').setDescription('Get member details').addUserOption(o => o.setName('target').setDescription('User')),
  new SlashCommandBuilder().setName('avatar').setDescription('Display profile picture').addUserOption(o => o.setName('target').setDescription('User')),
  new SlashCommandBuilder().setName('serveravatar').setDescription('Display server avatar').addUserOption(o => o.setName('target').setDescription('User')),
  new SlashCommandBuilder().setName('banner').setDescription('Display user banner').addUserOption(o => o.setName('target').setDescription('User')),
  new SlashCommandBuilder().setName('membercount').setDescription('Display total member count'),
  new SlashCommandBuilder().setName('roleinfo').setDescription('Display role details').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('channelinfo').setDescription('Display channel details').addChannelOption(o => o.setName('channel').setDescription('Channel')),
  new SlashCommandBuilder().setName('roles').setDescription('List server roles in hierarchy'),
  new SlashCommandBuilder().setName('embed').setDescription('Send custom embed')
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Description').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex Color (e.g. #2B2D31)'))
    .addChannelOption(o => o.setName('channel').setDescription('Target Channel')),
  new SlashCommandBuilder().setName('poll').setDescription('Create yes/no poll').addStringOption(o => o.setName('question').setDescription('Question').setRequired(true)),
  new SlashCommandBuilder().setName('end').setDescription('Emergency lockdown protocol').addIntegerOption(o => o.setName('code').setDescription('Security Code').setRequired(true)),

  // Suggestion & Ticket Commands
  new SlashCommandBuilder().setName('setsuggestions').setDescription('Configure suggestion channel & staff role')
    .addChannelOption(o => o.setName('channel').setDescription('Suggestions Channel').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Suggestion Staff Role').setRequired(true)),
  new SlashCommandBuilder().setName('suggest').setDescription('Submit a suggestion to the community')
    .addStringOption(o => o.setName('idea').setDescription('Your suggestion idea').setRequired(true)),
  new SlashCommandBuilder().setName('settickets').setDescription('Configure ticket support system')
    .addChannelOption(o => o.setName('channel').setDescription('Ticket Panel Channel').setRequired(true))
    .addChannelOption(o => o.setName('category').setDescription('Parent Category for Tickets').setRequired(true))
    .addChannelOption(o => o.setName('logchannel').setDescription('Ticket Logs Channel').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Support Staff Role').setRequired(true)),
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Send the interactive ticket creation panel')
];

// ==========================================
// BOT READY & INITIALIZATION
// ==========================================
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadGist();
  try {
    await client.application.commands.set(commands);
    console.log('Successfully registered all application commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

// ==========================================
// AUTOMOD & STICKY MESSAGES EVENT
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const cfg = getGuildConfig(message.guild.id);

  if (!isOwner(message.author.id)) {
    if (cfg.autoMod.invite && /(discord\.gg|discord\.com\/invite)/i.test(message.content)) {
      await message.delete().catch(() => {});
      return message.channel.send({ content: `${message.author}, invite links are prohibited here.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    }
    if (cfg.autoMod.caps && message.content.length > 10) {
      const caps = message.content.replace(/[^A-Z]/g, '').length;
      if (caps / message.content.length > 0.7) {
        await message.delete().catch(() => {});
        return message.channel.send({ content: `${message.author}, please avoid using excessive caps.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
      }
    }
    if (cfg.autoMod.mentions && message.mentions.users.size > 4) {
      await message.delete().catch(() => {});
      return message.channel.send({ content: `${message.author}, mass mentions are not allowed.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
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
  const cfg = getGuildConfig(interaction.guildId);

  // ----------------------------------------
  // 1. SLASH COMMANDS HANDLER
  // ----------------------------------------
  if (interaction.isChatInputCommand()) {
    const { commandName, options, guild, user } = interaction;

    if (commandName === 'end') {
      const code = options.getInteger('code');
      if (!isOwner(user.id)) return interaction.reply({ content: 'Unauthorized access attempt logged.', ephemeral: true });
      if (code !== 5677) return interaction.reply({ content: 'Invalid override code.', ephemeral: true });
      return interaction.reply({ content: 'Lockdown initiated. Restricting guild operations...', ephemeral: true });
    }

    // --- MODERATION COMMANDS WITH DM & LOGS ---
    if (commandName === 'warn') {
      if (!hasPermission(interaction, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const sub = options.getSubcommand();
      const target = options.getUser('target');
      const reason = options.getString('reason') || 'No reason provided';

      if (sub === 'add') {
        if (!cfg.warnings[target.id]) cfg.warnings[target.id] = [];
        cfg.warnings[target.id].push({ reason, moderator: user.id, date: new Date().toISOString() });
        saveGist();

        await sendModDM(target, guild, 'Warning', reason, null, user);
        return interaction.reply({ content: `Warned **${target.tag}** | Reason: ${reason}` });
      }
      if (sub === 'list') {
        const userWarns = cfg.warnings[target.id] || [];
        if (userWarns.length === 0) return interaction.reply({ content: `**${target.tag}** has no warnings.`, ephemeral: true });
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
      const warningIdx = options.getInteger('warning') - 1;
      const userWarns = cfg.warnings[target.id] || [];

      if (warningIdx < 0 || warningIdx >= userWarns.length) return interaction.reply({ content: 'Invalid warning index.', ephemeral: true });
      userWarns.splice(warningIdx, 1);
      saveGist();
      return interaction.reply({ content: `Removed warning #${warningIdx + 1} from **${target.tag}**.` });
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
      const userId = options.getString('user_id');
      const reason = options.getString('reason') || 'No reason provided';

      await guild.members.unban(userId, reason).catch(() => null);
      return interaction.reply({ content: `Unbanned user ID **${userId}**.` });
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
      return interaction.reply({ content: `Successfully banned ${count} users.` });
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
      const reason = options.getString('reason') || 'No reason provided';
      const member = guild.members.cache.get(target.id);

      if (!member) return interaction.reply({ content: 'User not in server.', ephemeral: true });
      await sendModDM(target, guild, 'Untimeout', reason, null, user);
      await member.timeout(null, reason);
      return interaction.reply({ content: `Removed timeout from **${target.tag}**` });
    }

    // Config Commands
    if (commandName === 'setlogs') {
      if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      cfg.logChannel = options.getChannel('channel').id;
      saveGist();
      return interaction.reply({ content: `Log channel set to <#${cfg.logChannel}>`, ephemeral: true });
    }

    if (commandName === 'setadmin') {
      if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const role = options.getRole('role');
      if (!cfg.adminRoles.includes(role.id)) cfg.adminRoles.push(role.id);
      saveGist();
      return interaction.reply({ content: `Added <@&${role.id}> as admin role.`, ephemeral: true });
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
        .setTitle('⚙️ Server Bot Configuration')
        .setColor('#2B2D31')
        .addFields(
          { name: 'Log Channel', value: cfg.logChannel ? `<#${cfg.logChannel}>` : 'None', inline: true },
          { name: 'Suggestions Channel', value: cfg.suggestionsChannel ? `<#${cfg.suggestionsChannel}>` : 'None', inline: true },
          { name: 'Tickets Panel Channel', value: cfg.ticketsChannel ? `<#${cfg.ticketsChannel}>` : 'None', inline: true },
          { name: 'AutoMod Filters', value: `Invites: ${cfg.autoMod.invite ? '✅' : '❌'}\nCaps: ${cfg.autoMod.caps ? '✅' : '❌'}\nMentions: ${cfg.autoMod.mentions ? '✅' : '❌'}`, inline: false }
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'setsuggestions') {
      if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      cfg.suggestionsChannel = options.getChannel('channel').id;
      cfg.suggestionsRole = options.getRole('role').id;
      saveGist();
      return interaction.reply({ content: `Suggestions configured!`, ephemeral: true });
    }

    if (commandName === 'suggest') {
      if (!cfg.suggestionsChannel) return interaction.reply({ content: 'Suggestions channel not set.', ephemeral: true });
      const sugChannel = guild.channels.cache.get(cfg.suggestionsChannel);

      const idea = options.getString('idea');
      const embed = new EmbedBuilder()
        .setTitle('💡 New Suggestion')
        .setDescription(idea)
        .setColor('#5865F2')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .addFields(
          { name: 'Status', value: '🟡 Pending Community Feedback', inline: true },
          { name: 'Votes', value: '👍 Upvotes: 0 | 👎 Downvotes: 0', inline: true }
        )
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sug_upvote').setLabel('Upvote 👍').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('sug_downvote').setLabel('Downvote 👎').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('sug_approve').setLabel('Approve').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('sug_deny').setLabel('Deny').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('sug_pending').setLabel('Reset Pending').setStyle(ButtonStyle.Secondary)
      );

      await sugChannel.send({ embeds: [embed], components: [buttons] });
      return interaction.reply({ content: `Suggestion submitted to <#${cfg.suggestionsChannel}>!`, ephemeral: true });
    }

    if (commandName === 'settickets') {
      if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      cfg.ticketsChannel = options.getChannel('channel').id;
      cfg.ticketsCategory = options.getChannel('category').id;
      cfg.ticketsLogChannel = options.getChannel('logchannel').id;
      cfg.ticketsRole = options.getRole('role').id;
      saveGist();
      return interaction.reply({ content: `Ticket system configured!`, ephemeral: true });
    }

    if (commandName === 'ticketpanel') {
      if (!hasPermission(interaction, PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const channel = cfg.ticketsChannel ? guild.channels.cache.get(cfg.ticketsChannel) : interaction.channel;
      
      const embed = new EmbedBuilder()
        .setTitle('🎫 Community Support & Tickets')
        .setDescription('Need help, want to report a player, or submit a bug report? Click the button below to open a private ticket with our support team.')
        .setColor('#2B2D31');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_ticket').setLabel('📩 Open Ticket').setStyle(ButtonStyle.Primary)
      );

      await channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: 'Ticket panel posted!', ephemeral: true });
    }

    if (commandName === 'lock') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const chan = options.getChannel('channel') || interaction.channel;
      await chan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      return interaction.reply({ content: `Locked <#${chan.id}>.` });
    }

    if (commandName === 'unlock') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const chan = options.getChannel('channel') || interaction.channel;
      await chan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true });
      return interaction.reply({ content: `Unlocked <#${chan.id}>.` });
    }

    if (commandName === 'sticky') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const sub = options.getSubcommand();
      if (sub === 'set') {
        const text = options.getString('message');
        cfg.stickyMessages[interaction.channelId] = { text, lastMessageId: null };
        saveGist();
        return interaction.reply({ content: 'Sticky message enabled for this channel.', ephemeral: true });
      }
      if (sub === 'clear') {
        delete cfg.stickyMessages[interaction.channelId];
        saveGist();
        return interaction.reply({ content: 'Sticky message cleared from this channel.', ephemeral: true });
      }
    }

    if (commandName === 'purge') {
      if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      let amount = options.getInteger('amount');
      if (amount > 1000) amount = 1000;
      await interaction.deferReply({ ephemeral: true });
      let deletedTotal = 0;
      while (amount > 0) {
        const fetchSize = amount > 100 ? 100 : amount;
        const deleted = await interaction.channel.bulkDelete(fetchSize, true).catch(() => null);
        if (!deleted || deleted.size === 0) break;
        deletedTotal += deleted.size;
        amount -= fetchSize;
      }
      return interaction.editReply({ content: `Purged ${deletedTotal} messages.` });
    }

    if (commandName === 'embed') {
      const title = options.getString('title');
      const desc = options.getString('description');
      const color = options.getString('color') || '#2B2D31';
      const targetChan = options.getChannel('channel') || interaction.channel;

      const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
      await targetChan.send({ embeds: [embed] });
      return interaction.reply({ content: 'Embed sent!', ephemeral: true });
    }

    if (commandName === 'poll') {
      const question = options.getString('question');
      const embed = new EmbedBuilder()
        .setTitle('📊 Poll')
        .setDescription(question)
        .setColor('#5865F2')
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() });

      const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
      await msg.react('👍');
      await msg.react('👎');
      return;
    }

    if (commandName === 'userinfo') {
      const target = options.getUser('target') || user;
      const member = guild.members.cache.get(target.id);
      const embed = new EmbedBuilder()
        .setTitle(`User Info: ${target.tag}`)
        .setThumbnail(target.displayAvatarURL())
        .setColor('#2B2D31')
        .addFields(
          { name: 'User ID', value: target.id, inline: true },
          { name: 'Created At', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true }
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'avatar') {
      const target = options.getUser('target') || user;
      return interaction.reply({ content: target.displayAvatarURL({ size: 1024, dynamic: true }) });
    }

    if (commandName === 'membercount') {
      return interaction.reply({ content: `Total Server Members: **${guild.memberCount}**` });
    }
  }

  // ----------------------------------------
  // 2. INTERACTIVE BUTTON HANDLER
  // ----------------------------------------
  if (interaction.isButton()) {
    const { customId, guild, member, message } = interaction;

    if (customId.startsWith('sug_')) {
      const embed = EmbedBuilder.from(message.embeds[0]);
      const action = customId.replace('sug_', '');

      if (['upvote', 'downvote'].includes(action)) {
        let fieldText = embed.data.fields[1].value;
        let upMatch = fieldText.match(/Upvotes: (\d+)/);
        let downMatch = fieldText.match(/Downvotes: (\d+)/);
        let up = upMatch ? parseInt(upMatch[1]) : 0;
        let down = downMatch ? parseInt(downMatch[1]) : 0;

        if (action === 'upvote') up += 1;
        if (action === 'downvote') down += 1;

        embed.spliceFields(1, 1, { name: 'Votes', value: `👍 Upvotes: ${up} | 👎 Downvotes: ${down}`, inline: true });
        await message.edit({ embeds: [embed] });
        return interaction.reply({ content: 'Vote recorded!', ephemeral: true });
      }

      const isStaff = isOwner(member.id) || (cfg.suggestionsRole && member.roles.cache.has(cfg.suggestionsRole));
      if (!isStaff) return interaction.reply({ content: 'You do not have the Suggestion Staff Role to manage status.', ephemeral: true });

      if (action === 'approve') {
        embed.setColor('#2ECC71').spliceFields(0, 1, { name: 'Status', value: `🟢 Approved by ${member.user.tag}`, inline: true });
      } else if (action === 'deny') {
        embed.setColor('#ED4245').spliceFields(0, 1, { name: 'Status', value: `🔴 Denied by ${member.user.tag}`, inline: true });
      } else if (action === 'pending') {
        embed.setColor('#5865F2').spliceFields(0, 1, { name: 'Status', value: `🟡 Pending Community Feedback`, inline: true });
      }

      await message.edit({ embeds: [embed] });
      return interaction.reply({ content: `Status updated to **${action}**.`, ephemeral: true });
    }

    if (customId === 'open_ticket') {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ticket_select_type')
        .setPlaceholder('Select ticket reason...')
        .addOptions([
          { label: 'Bug Report', description: 'Report an in-game or server bug', value: 'bug', emoji: '🐛' },
          { label: 'Player Report', description: 'Report a user breaking server rules', value: 'report', emoji: '🛡️' },
          { label: 'General Support', description: 'General questions or assistance', value: 'support', emoji: '❓' }
        ]);

      const row = new ActionRowBuilder().addComponents(selectMenu);
      return interaction.reply({ content: 'Please select a category for your ticket:', components: [row], ephemeral: true });
    }

    if (customId === 'ticket_close') {
      const isStaff = isOwner(member.id) || (cfg.ticketsRole && member.roles.cache.has(cfg.ticketsRole));
      if (!isStaff) return interaction.reply({ content: 'Only support staff can close tickets.', ephemeral: true });

      await interaction.reply({ content: 'Ticket will be closed in 5 seconds...' });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      return;
    }

    if (customId === 'ticket_transcript') {
      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.cleanContent}`).join('\n');
      
      const buffer = Buffer.from(transcript, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: `${interaction.channel.name}-transcript.txt` });

      if (cfg.ticketsLogChannel) {
        const logChan = guild.channels.cache.get(cfg.ticketsLogChannel);
        if (logChan) await logChan.send({ content: `Transcript for **${interaction.channel.name}**:`, files: [attachment] });
      }

      return interaction.reply({ content: 'Transcript generated and saved to logs channel!', ephemeral: true });
    }
  }

  // ----------------------------------------
  // 3. SELECT MENU HANDLER
  // ----------------------------------------
  if (interaction.isStringSelectMenu()) {
    const { customId, guild, member, values } = interaction;

    if (customId === 'ticket_select_type') {
      cfg.ticketCounter = (cfg.ticketCounter || 0) + 1;
      saveGist();

      const type = values[0];
      const chanName = `ticket-${type}-${cfg.ticketCounter}`;

      const category = cfg.ticketsCategory ? guild.channels.cache.get(cfg.ticketsCategory) : null;

      const overwrites = [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] }
      ];

      if (cfg.ticketsRole) {
        overwrites.push({ id: cfg.ticketsRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] });
      }

      const ticketChan = await guild.channels.create({
        name: chanName,
        type: ChannelType.GuildText,
        parent: category ? category.id : null,
        permissionOverwrites: overwrites
      });

      const embed = new EmbedBuilder()
        .setTitle(`Support Ticket: ${type.toUpperCase()}`)
        .setDescription(`Hello ${member}, support staff will be with you shortly.\n\nUse the buttons below to close or save a transcript of this ticket.`)
        .setColor('#5865F2');

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket 🔒').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket_transcript').setLabel('Save Transcript 📄').setStyle(ButtonStyle.Secondary)
      );

      await ticketChan.send({ content: `${member} <@&${cfg.ticketsRole}>`, embeds: [embed], components: [buttons] });
      return interaction.reply({ content: `Ticket created! Head over to ${ticketChan}`, ephemeral: true });
    }
  }
});

// ==========================================
// BOT LOGIN
// ==========================================
client.login(TOKEN);
