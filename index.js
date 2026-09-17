import './database/polyfill.js';
import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import colors from 'colors';

colors.enable();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildExpressions
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
    Partials.Reaction,
  ],
});

client.commands = new Collection();
client.aliases = new Collection();

(async () => {
  const handlers = readdirSync('./handlers').filter(f => f.endsWith('.js'));
  for (const handler of handlers) {
    try {
      const handlerModule = await import(`./handlers/${handler}`);
      await handlerModule.default(client);
    } catch (e) {
      console.log(`ERROR EN EL HANDLER ${handler}`.red);
      console.log(e);
    }
  }

  client.login(process.env.BOT_TOKEN).catch((error) => console.error(`-[X]- NO HAS ESPECIFICADO UN TOKEN VALIDO O TE FALTAN INTENTOS -[X]-\n [-] ACTIVA LOS INTENTOS EN https://dev`.red, error));
})();