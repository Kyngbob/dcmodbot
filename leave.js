const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// The ID of the server you want the bot to stay in
const KEEP_GUILD_ID = '1548675867302170755';

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Currently in ${client.guilds.cache.size} servers.`);
  console.log(`Targeting all servers for departure EXCEPT server ID: ${KEEP_GUILD_ID}`);

  for (const [id, guild] of client.guilds.cache) {
    if (id === KEEP_GUILD_ID) {
      console.log(`[SKIPPED] Keeping server: ${guild.name} (${id})`);
      continue;
    }

    try {
      await guild.leave();
      console.log(`[LEFT] Successfully left: ${guild.name} (${id})`);
    } catch (err) {
      console.error(`[ERROR] Failed to leave ${guild.name} (${id}):`, err);
    }
  }

  console.log('Finished leaving specified servers.');
  process.exit(0); // Safely terminates the script
});

client.login(process.env.DISCORD_TOKEN);
