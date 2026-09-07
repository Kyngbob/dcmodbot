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
    console.log(`Logged in as ${client.user.tag}! Registering slash commands...`);

    // Define the /banall slash command
    const commands = [
        new SlashCommandBuilder()
            .setName('banall')
            .setDescription('Bans all eligible members from the server')
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for the mass ban')
                    .setRequired(false)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    try {
        // Clear old global commands and register guild/global commands instantly
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Successfully registered /banall slash command globally.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'banall') {
        // Check if the user executing the command is one of the two allowed IDs
        if (!ALLOWED_USERS.includes(interaction.user.id)) {
            return interaction.reply({ 
                content: 'You do not have permission to use this command.', 
                ephemeral: true 
            });
        }

        const reason = interaction.options.getString('reason') || 'Mass ban command executed';

        // Defer reply ephemerally because fetching and banning members takes time
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            let count = 0;
            const members = await guild.members.fetch();

            for (const [id, member] of members) {
                // Do not ban the bot itself, the server owner, or the allowed admin accounts
                if (member.bannable && !ALLOWED_USERS.includes(id) && id !== client.user.id && id !== guild.ownerId) {
                    await member.ban({ reason });
                    count++;
                }
            }

            await interaction.editReply(`Successfully banned ${count} members from **${guild.name}**.`);
        } catch (err) {
            await interaction.editReply(`Failed to complete mass ban: ${err.message}`);
        }
    }
});

client.login(process.env.TOKEN);
