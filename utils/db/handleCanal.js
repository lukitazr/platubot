import { ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType } from 'discord.js';

/**
 * Maneja el cambio del canal de resultados para una liga fija.
 * @param {import('discord.js').ButtonInteraction} interaction 
 * @param {object} liga 
 * @param {string} div 
 */
export default async function handleCanal(interaction, liga, div) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`sel_canal_${div}`)
    .setPlaceholder('Selecciona el nuevo canal de resultados...')
    .addChannelTypes(ChannelType.GuildText);

  await interaction.reply({
    content: `📺 **Cambiar Canal — ${div.toUpperCase()}**\nSelecciona el canal donde se enviarán las actualizaciones:`,
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64
  });
  const resp = await interaction.fetchReply();

  const sel = await resp.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 60000 }).catch(() => null);
  if (!sel) return;

  liga.canalResultados = sel.values[0];
  await liga.save();

  await sel.update({
    content: `✅ El canal de resultados ha sido actualizado a <#${sel.values[0]}>.`,
    components: []
  });
}
