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
  MessageFlags 
} = require('discord.js');

// ------------------------------------------------------------------
// 1. EXPRESS WEB SERVER (Keeps Render Awake via UptimeRobot)
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
          'settings.json': { content: JSON.stringify(settingsCache, null, 2) }
        }
      })
    });
    console.log('[Gist] Settings updated successfully.');
  } catch (err) {
    console.error('[Gist Save Error]', err.message);
  }
}

// ------------------------------------------------------------------
// 3. DISCORD BOT SETUP & COMMAND DEFINITIONS
// ------------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('Set the moderation logging channel')
    .addChannelOption(opt => opt.setName('channel').setDescription('Channel to send logs to').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setadmin')
    .setDescription('Set a single main admin role')
    .addRoleOption(opt => opt.setName('role').setDescription('Role to grant admin access').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('adminrole')
    .setDescription('Manage multiple bot admin roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add an admin role')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to grant admin access').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('del')
        .setDescription('Remove an admin role')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to revoke admin access').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all configured admin roles')
    ),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Manage user warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Issue a warning to a user')
        .addUserOption(opt => opt.setName('target').setDescription('User to warn').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the warning').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List warnings for a user')
        .addUserOption(opt => opt.setName('target').setDescription('User to check').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Clear all warnings for a user')
        .addUserOption(opt => opt.setName('target').setDescription('User to clear warnings for').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('List all roles in the server'),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View current bot configuration for this server'),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption(opt => opt.setName('target').setDescription('Member to kick').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for kick'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(opt => opt.setName('target').setDescription('Member to ban').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('Reason for ban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete messages')
    .addIntegerOption(opt => opt.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
].map(cmd => cmd.toJSON());

// Helper function to send log entries
async function sendLog(guild, embed) {
  const guildConfig = settingsCache[guild.id];
  if (!guildConfig?.logChannelId) return;
  const logChannel = guild.channels.cache.get(guildConfig.logChannelId);
  if (logChannel) {
    try {
      await logChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error('[Log Error]', err.message);
    }
  }
}

// Helper to verify admin authority
function isAdmin(interaction) {
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const config = settingsCache[interaction.guild.id] || {};
  
  if (config.adminRoleId && interaction.member.roles.cache.has(config.adminRoleId)) {
    return true;
  }
  
  const adminRoleIds = config.adminRoleIds || [];
  return adminRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
}

// ------------------------------------------------------------------
// 4. EVENT HANDLERS
// ------------------------------------------------------------------
client.once(Events.ClientReady, async (c) => {
  console.log(`[Bot Online] Logged in as ${c.user.tag}`);
  await loadSettings();

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || process.env.TOKEN);
  try {
    console.log('[Slash Commands] Registering globally...');
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log('[Slash Commands] Successfully registered!');
  } catch (err) {
    console.error('[Slash Commands Error]', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, guild, member } = interaction;
  if (!settingsCache[guild.id]) settingsCache[guild.id] = {};
  if (!settingsCache[guild.id].adminRoleIds) settingsCache[guild.id].adminRoleIds = [];
  if (!settingsCache[guild.id].warnings) settingsCache[guild.id].warnings = {};

  try {
    // COMMAND: /setlogs
    if (commandName === 'setlogs') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ You lack permission to configure settings.', flags: MessageFlags.Ephemeral });
      }
      const channel = options.getChannel('channel');
      settingsCache[guild.id].logChannelId = channel.id;
      await saveSettings(settingsCache);

      return interaction.reply({ content: `✅ Log channel updated to ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    // COMMAND: /setadmin (Legacy single-role setup)
    if (commandName === 'setadmin') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ You lack permission to configure settings.', flags: MessageFlags.Ephemeral });
      }
      const role = options.getRole('role');
      settingsCache[guild.id].adminRoleId = role.id;
      
      if (!settingsCache[guild.id].adminRoleIds.includes(role.id)) {
        settingsCache[guild.id].adminRoleIds.push(role.id);
      }
      
      await saveSettings(settingsCache);

      return interaction.reply({ content: `✅ Set primary admin role to **${role.name}**.`, flags: MessageFlags.Ephemeral });
    }

    // COMMAND GROUP: /adminrole (add, del, list)
    if (commandName === 'adminrole') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ You lack permission to manage admin roles.', flags: MessageFlags.Ephemeral });
      }

      const subcommand = options.getSubcommand();
      const currentAdminRoles = settingsCache[guild.id].adminRoleIds;

      if (subcommand === 'add') {
        const role = options.getRole('role');

        if (currentAdminRoles.includes(role.id)) {
          return interaction.reply({ content: `⚠️ **${role.name}** is already registered as an admin role.`, flags: MessageFlags.Ephemeral });
        }

        currentAdminRoles.push(role.id);
        await saveSettings(settingsCache);

        return interaction.reply({ content: `✅ Added **${role.name}** to admin roles.`, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'del') {
        const role = options.getRole('role');

        if (!currentAdminRoles.includes(role.id)) {
          return interaction.reply({ content: `⚠️ **${role.name}** is not currently an admin role.`, flags: MessageFlags.Ephemeral });
        }

        settingsCache[guild.id].adminRoleIds = currentAdminRoles.filter(id => id !== role.id);
        await saveSettings(settingsCache);

        return interaction.reply({ content: `🗑️ Removed **${role.name}** from admin roles.`, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'list') {
        const roleMentions = currentAdminRoles.length > 0
          ? currentAdminRoles.map(id => `<@&${id}>`).join('\n')
          : 'No admin roles configured.';

        const embed = new EmbedBuilder()
          .setTitle(`🔑 Admin Roles for ${guild.name}`)
          .setDescription(roleMentions)
          .setColor('#5865F2');

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }

    // COMMAND GROUP: /warn (add, list, clear)
    if (commandName === 'warn') {
      if (!isAdmin(interaction) && !member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({ content: '❌ You lack permission to manage warnings.', flags: MessageFlags.Ephemeral });
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
        const warningEntry = {
          reason,
          moderator: interaction.user.tag,
          date: new Date().toISOString()
        };

        userWarnings.push(warningEntry);
        await saveSettings(settingsCache);

        await interaction.reply({ content: `⚠️ Issued warning to **${targetUser.tag}**. Total warnings: **${userWarnings.length}**`, flags: MessageFlags.Ephemeral });

        // Try to DM the user
        try {
          await targetUser.send(`⚠️ You have received a warning in **${guild.name}**. Reason: ${reason}`);
        } catch (dmErr) {
          console.log(`[DM Warning] Could not DM user ${targetUser.tag}`);
        }

        // Log warning
        const logEmbed = new EmbedBuilder()
          .setTitle('⚠️ User Warned')
          .addFields(
            { name: 'User', value: `${targetUser.tag} (${targetUser.id})` },
            { name: 'Moderator', value: interaction.user.tag },
            { name: 'Reason', value: reason },
            { name: 'Total Warnings', value: `${userWarnings.length}` }
          )
          .setColor('#F39C12')
          .setTimestamp();
        return sendLog(guild, logEmbed);
      }

      if (subcommand === 'list') {
        if (userWarnings.length === 0) {
          return interaction.reply({ content: `✅ **${targetUser.tag}** has no active warnings.`, flags: MessageFlags.Ephemeral });
        }

        const warningListDesc = userWarnings.map((w, index) => 
          `**#${index + 1}** | Reason: ${w.reason}\n*Moderator: ${w.moderator}*`
        ).join('\n\n');

        const embed = new EmbedBuilder()
          .setTitle(`⚠️ Warnings for ${targetUser.tag}`)
          .setDescription(warningListDesc)
          .setColor('#F39C12')
          .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'clear') {
        if (userWarnings.length === 0) {
          return interaction.reply({ content: `ℹ️ **${targetUser.tag}** has no warnings to clear.`, flags: MessageFlags.Ephemeral });
        }

        settingsCache[guild.id].warnings[userId] = [];
        await saveSettings(settingsCache);

        return interaction.reply({ content: `🗑️ Cleared all warnings for **${targetUser.tag}**.`, flags: MessageFlags.Ephemeral });
      }
    }

    // COMMAND: /roles
    if (commandName === 'roles') {
      const roleList = guild.roles.cache
        .filter(r => r.name !== '@everyone')
        .map(r => `<@&${r.id}>`)
        .join(', ');

      const embed = new EmbedBuilder()
        .setTitle(`📜 Roles in ${guild.name}`)
        .setDescription(roleList || 'No custom roles found.')
        .setColor('#5865F2');

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // COMMAND: /settings
    if (commandName === 'settings') {
      const config = settingsCache[guild.id] || {};
      const logChannel = config.logChannelId ? `<#${config.logChannelId}>` : 'Not set';
      const adminRoles = config.adminRoleIds && config.adminRoleIds.length > 0
        ? config.adminRoleIds.map(id => `<@&${id}>`).join(', ')
        : (config.adminRoleId ? `<@&${config.adminRoleId}>` : 'Not set');

      const embed = new EmbedBuilder()
        .setTitle(`⚙️ Configuration for ${guild.name}`)
        .addFields(
          { name: 'Log Channel', value: logChannel, inline: true },
          { name: 'Admin Roles', value: adminRoles, inline: true }
        )
        .setColor('#5865F2');

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // COMMAND: /kick
    if (commandName === 'kick') {
      if (!isAdmin(interaction) && !member.permissions.has(PermissionFlagsBits.KickMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }
      const target = options.getMember('target');
      const reason = options.getString('reason') || 'No reason provided';
      if (!target) return interaction.reply({ content: 'User not found in server.', flags: MessageFlags.Ephemeral });

      await target.kick(reason);
      await interaction.reply({ content: `👢 Kicked **${target.user.tag}** | Reason: ${reason}` });

      const logEmbed = new EmbedBuilder()
        .setTitle('Member Kicked')
        .addFields(
          { name: 'User', value: `${target.user.tag} (${target.id})` },
          { name: 'Moderator', value: interaction.user.tag },
          { name: 'Reason', value: reason }
        )
        .setColor('#E74C3C')
        .setTimestamp();
      return sendLog(guild, logEmbed);
    }

    // COMMAND: /ban
    if (commandName === 'ban') {
      if (!isAdmin(interaction) && !member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }
      const target = options.getUser('target');
      const reason = options.getString('reason') || 'No reason provided';

      await guild.members.ban(target, { reason });
      await interaction.reply({ content: `🔨 Banned **${target.tag}** | Reason: ${reason}` });

      const logEmbed = new EmbedBuilder()
        .setTitle('Member Banned')
        .addFields(
          { name: 'User', value: `${target.tag} (${target.id})` },
          { name: 'Moderator', value: interaction.user.tag },
          { name: 'Reason', value: reason }
        )
        .setColor('#992D22')
        .setTimestamp();
      return sendLog(guild, logEmbed);
    }

    // COMMAND: /purge
    if (commandName === 'purge') {
      if (!isAdmin(interaction) && !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: '❌ Permission denied.', flags: MessageFlags.Ephemeral });
      }
      const amount = options.getInteger('amount');
      if (amount < 1 || amount > 100) {
        return interaction.reply({ content: 'Please specify an amount between 1 and 100.', flags: MessageFlags.Ephemeral });
      }

      const deleted = await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `🧹 Deleted ${deleted.size} messages.`, flags: MessageFlags.Ephemeral });

      const logEmbed = new EmbedBuilder()
        .setTitle('Messages Purged')
        .addFields(
          { name: 'Channel', value: `${interaction.channel}` },
          { name: 'Amount', value: `${deleted.size}` },
          { name: 'Moderator', value: interaction.user.tag }
        )
        .setColor('#F1C40F')
        .setTimestamp();
      return sendLog(guild, logEmbed);
    }

  } catch (err) {
    console.error(`[Command Error] /${commandName}:`, err);
    const msg = '⚠️ An error occurred while executing this command.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  }
});

// ------------------------------------------------------------------
// 5. BOT LOGIN
// ------------------------------------------------------------------
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
