import { 
    EmbedBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder,
    ButtonStyle,
    ButtonBuilder,
    AttachmentBuilder
} from 'discord.js';
import Torneo from '../../models/copas/Torneo.js';

export default {
    name: 'torneos',
    aliases: ['listatorneos', 'vertorneos'],
    desc: 'Lista todos los torneos activos en el servidor',
    permisos: [],

    run: async (client, message) => {
        const torneos = await Torneo.find({}).catch(() => []);
        const activos = torneos.filter(t => t.estado !== 'Finalizado');

        if (!activos.length) {
            return message.reply('❌ No hay torneos activos actualmente.');
        }

        const embed = new EmbedBuilder()
            .setTitle('🏆 Torneos Activos')
            .setColor('Gold')
            .setDescription(
                activos.map((t, i) => {
                    const compType = t.tipoCompeticion === 'individual' ? '👤 Individual' : t.tipoCompeticion === 'duo' ? '👥 Duo' : '⚔️ Equipos';
                    const icon = t.logo ? '🛡️' : '🏆';
                    return `**${i + 1}. ${icon} ${t.nombre}**\n` +
                           `> Estado: \`${t.estado}\` | Modo: \`${compType}\`\n` +
                           `> Inscriptos: **${t.equipos.length}/${t.cantidadParticipantes}** | Prefijo: \`${t.prefix}\``;
                }).join('\n\n')
            )
            .setTimestamp();

        const files = [];
        // Si hay logo en el primer torneo listado, podemos usarlo como miniatura
        if (activos[0]?.logo) {
            files.push(new AttachmentBuilder(activos[0].logo, { name: 'logo_copa.png' }));
            embed.setThumbnail('attachment://logo_copa.png');
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId('select_torneo_panel')
            .setPlaceholder('Ir al panel de gestión de un torneo...')
            .addOptions(
                activos.slice(0, 25).map(t => ({
                    label: t.nombre,
                    value: t.prefix,
                    description: `Prefijo: ${t.prefix} — Inscriptos: ${t.equipos.length}/${t.cantidadParticipantes}`,
                    emoji: t.tipoCompeticion === 'equipos' ? '⚔️' : t.tipoCompeticion === 'duo' ? '👥' : '👤'
                }))
            );

        const msg = await message.reply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(select)],
            files
        });

        const collector = msg.createMessageComponentCollector({
            filter: i => i.customId === 'select_torneo_panel',
            time: 120000
        });

        collector.on('collect', async interaction => {
            const prefixSelected = interaction.values[0];
            const torneo = await Torneo.findOne({ prefix: prefixSelected }).catch(() => null);

            if (!torneo) {
                return interaction.reply({ content: '❌ Torneo no encontrado.', flags: 64 });
            }

            // Verificar permisos del usuario que interactúa
            if (!interaction.member.permissions.has('Administrator') && interaction.user.id !== torneo.createdBy) {
                return interaction.reply({ content: '❌ Solo administradores o el creador del torneo pueden gestionar este torneo.', flags: 64 });
            }

            // Cargar el comando genérico y ejecutar la gestión mediante el mock de Message
            const genericCmd = client.commands.get('torneo-generic');
            if (!genericCmd) {
                return interaction.reply({ content: '❌ Error: Comando genérico de gestión no encontrado.', flags: 64 });
            }

            // Crear un mock de mensaje para redirigir la respuesta al interaction.reply
            const mockMessage = {
                guild: interaction.guild,
                channel: interaction.channel,
                author: interaction.user,
                member: interaction.member,
                reply: async (options) => {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp(options);
                        return await interaction.fetchReply();
                    }
                    await interaction.reply(options);
                    return await interaction.fetchReply();
                }
            };

            try {
                await genericCmd.runGeneric(client, mockMessage, [], torneo, 'gestion');
            } catch (err) {
                console.error('Error launching management panel from list:', err);
                await interaction.reply({ content: '❌ Hubo un error al abrir el panel de gestión.', flags: 64 }).catch(() => {});
            }
        });
    }
};
