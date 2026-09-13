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
    .setDescription('Set the admin role for bot management')
    .addRoleOption(opt => opt.setName('role').setDescription('Role allowed to run admin commands').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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
  const adminRoleId = settingsCache[interaction.guild.id]?.adminRoleId;
  return adminRoleId ? interaction.member.roles.cache.has(adminRoleId) : false;
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

    // COMMAND: /setadmin
    if (commandName === 'setadmin') {
      if (!isAdmin(interaction)) {
        return interaction.reply({ content: '❌ You lack permission to configure settings.', flags: MessageFlags.Ephemeral });
      }
      const role = options.getRole('role');
      settingsCache[guild.id].adminRoleId = role.id;
      await saveSettings(settingsCache);

      return interaction.reply({ content: `✅ Admin role set to **${role.name}**.`, flags: MessageFlags.Ephemeral });
    }

    // COMMAND: /settings
    if (commandName === 'settings') {
      const config = settingsCache[guild.id] || {};
      const logChannel = config.logChannelId ? `<#${config.logChannelId}>` : 'Not set';
      const adminRole = config.adminRoleId ? `<@&${config.adminRoleId}>` : 'Not set';

      const embed = new EmbedBuilder()
        .setTitle(`⚙️ Configuration for ${guild.name}`)
        .addFields(
          { name: 'Log Channel', value: logChannel, inline: true },
          { name: 'Admin Role', value: adminRole, inline: true }
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
