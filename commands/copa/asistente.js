import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    SlashCommandBuilder,
    AttachmentBuilder,
    FileUploadBuilder,
    LabelBuilder
} from 'discord.js';
import Torneo from '../../models/copas/Torneo.js';
import { generarPreviewTema, generarBracketCopa } from '../../utils/visual/copaVisualGenerator.js';
import { extractPalette } from '../../utils/visual/colorExtractor.js';
import descargarImagen from '../../utils/descargarImagen.js';

export default {
    name: 'copa-crear',
    aliases: ['crearcopa', 'nuevacopa'],
    desc: 'Asistente paso a paso para crear una nueva copa',
    permisos: ['Administrator'],

    data: new SlashCommandBuilder()
        .setName('copa-crear')
        .setDescription('Asistente paso a paso para crear una nueva copa'),

    execute: async (client, interaction) => {
        await runWizard(client, interaction, true);
    },

    run: async (client, message) => {
        await runWizard(client, message, false);
    }
};

async function runWizard(client, context, isInteraction) {
    const user = isInteraction ? context.user : context.author;
    let step = 1;
    let config = {
        nombre: '',
        prefix: '',
        canalResultados: null,
        cantidadParticipantes: 0,
        formatoPreset: 'personalizado',
        tipoEncuentro: 'unico', // 'unico', 'ida_vuelta', 'hibrido'
        tipoJugadores: 'users',
        tipoCompeticion: 'individual', // 'individual' | 'duo' | 'equipos'
        caracter: 'amistoso', // 'oficial' | 'amistoso'
        logo: null,
        inscripcionAbierta: true,
        equipoConfig: {
            minJugadores: 2,
            maxJugadores: 5,
        },
        hayTercerPuesto: false,
        tema: {
            primario: '#1a1a2e',
            secundario: '#16213e',
            acento: '#e94560',
            texto: '#ffffff',
            borde: '#0f3460',
        }
    };

    let msg = await context.reply({
        embeds: [new EmbedBuilder().setTitle('🏆 Asistente de Creación de Torneos').setDescription('Bienvenido. Vamos a configurar tu nuevo torneo paso a paso.\n\nPresiona el botón para empezar.').setColor('Blue')],
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start_wizard').setLabel('Empezar').setStyle(ButtonStyle.Primary))]
    });

    const collector = msg.createMessageComponentCollector({ idle: 300000 });

    collector.on('collect', async (i) => {
        if (i.user.id !== user.id) return i.reply({ content: 'No puedes usar este asistente.', flags: 64 });

        try {
            if (i.customId === 'start_wizard' || i.customId === 'next_step') {
                await handleStep(i);
            } else if (i.customId === 'select_channel') {
                config.canalResultados = i.values[0];
                step = 3;
                await handleStep(i);
            } else if (i.customId === 'select_competition_type') {
                config.tipoCompeticion = i.values[0];
                if (config.tipoCompeticion === 'equipos') {
                    // Paso 3b: Modal de Configuración de Equipos
                    const modal = new ModalBuilder()
                        .setCustomId('modal_equipo_config')
                        .setTitle('Configuración de Equipos');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('min_jugadores')
                                .setLabel('Mínimo de jugadores por equipo')
                                .setPlaceholder('Ej: 2')
                                .setValue('2')
                                .setRequired(true)
                                .setStyle(TextInputStyle.Short)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('max_jugadores')
                                .setLabel('Máximo de jugadores por equipo')
                                .setPlaceholder('Ej: 5')
                                .setValue('5')
                                .setRequired(true)
                                .setStyle(TextInputStyle.Short)
                        ),
                    );

                    await i.showModal(modal);
                    const submit = await i.awaitModalSubmit({ time: 600000 }).catch(() => null);
                    if (!submit) return;

                    const minJug = parseInt(submit.fields.getTextInputValue('min_jugadores'));
                    const maxJug = parseInt(submit.fields.getTextInputValue('max_jugadores'));
                    if (isNaN(minJug) || isNaN(maxJug) || minJug < 1 || maxJug < minJug) {
                        return submit.reply({ content: '❌ Valores de configuración inválidos.', flags: 64 });
                    }

                    config.equipoConfig = { minJugadores: minJug, maxJugadores: maxJug };

                    step = 4;
                    await submit.update({
                        embeds: [buildEmbed(`Paso 4: Cantidad de Participantes`, `Has configurado los límites por equipo (${minJug} a ${maxJug} jugadores).\n\nHaz clic abajo para ingresar la cantidad de equipos participantes.`)],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('retry_step4')
                                .setLabel('🔢 Ingresar Cantidad')
                                .setStyle(ButtonStyle.Primary)
                        )]
                    });
                } else {
                    step = 4;
                    await handleStep(i);
                }
            } else if (i.customId === 'select_format') {
                const selectedFormat = i.values[0];
                config.formatoPreset = selectedFormat;

                if (selectedFormat === 'personalizado') {
                    const modal = new ModalBuilder()
                        .setCustomId('modal_personalizado')
                        .setTitle('Configuración Manual de Grupos');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('cantidad_grupos')
                                .setLabel('Cantidad de grupos')
                                .setPlaceholder('Ej: 4')
                                .setValue('4')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('jugadores_grupo')
                                .setLabel('Jugadores por grupo')
                                .setPlaceholder('Ej: 4')
                                .setValue('4')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('clasificados_grupo')
                                .setLabel('Clasificados por grupo')
                                .setPlaceholder('Ej: 2')
                                .setValue('2')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('mejor_tercero')
                                .setLabel('¿Habilitar mejores terceros? (S/N)')
                                .setPlaceholder('S / N')
                                .setValue('N')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('cant_mejores_terceros')
                                .setLabel('Cantidad mejores terceros clasificados')
                                .setPlaceholder('Ej: 0, 2, 4')
                                .setValue('0')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );

                    await i.showModal(modal);
                    const submit = await i.awaitModalSubmit({ time: 600000 }).catch(() => null);
                    if (!submit) return;

                    const cantGrupos = parseInt(submit.fields.getTextInputValue('cantidad_grupos'));
                    const jugGrupo = parseInt(submit.fields.getTextInputValue('jugadores_grupo'));
                    const clasGrupo = parseInt(submit.fields.getTextInputValue('clasificados_grupo'));
                    const mejor3 = submit.fields.getTextInputValue('mejor_tercero').toUpperCase() === 'S';
                    const cantMejores3 = parseInt(submit.fields.getTextInputValue('cant_mejores_terceros')) || 0;

                    if (isNaN(cantGrupos) || isNaN(jugGrupo) || isNaN(clasGrupo) || cantGrupos < 1 || jugGrupo < 2 || clasGrupo < 1) {
                        return submit.reply({ content: '❌ Configuración de grupos inválida. Todos los valores numéricos deben ser mayores a cero.', flags: 64 });
                    }

                    if (cantGrupos * jugGrupo !== config.cantidadParticipantes) {
                        return submit.reply({ content: `❌ La cantidad de participantes en los grupos (${cantGrupos} grupos x ${jugGrupo} jugadores = ${cantGrupos * jugGrupo}) no coincide con la cantidad total de participantes configurada (${config.cantidadParticipantes}).`, flags: 64 });
                    }

                    if (clasGrupo >= jugGrupo) {
                        return submit.reply({ content: `❌ La cantidad de clasificados por grupo (${clasGrupo}) debe ser menor que la cantidad de jugadores por grupo (${jugGrupo}).`, flags: 64 });
                    }

                    config.gruposHabilitados = true;
                    config.cantidadGrupos = cantGrupos;
                    config.jugadoresPorGrupo = jugGrupo;
                    config.clasificadosPorGrupo = clasGrupo;
                    config.mejorTercero = mejor3;
                    config.cantMejoresTerceros = cantMejores3;

                    step = 6;
                    await handleStep(submit);
                } else {
                    step = 6;
                    await handleStep(i);
                }
            } else if (i.customId === 'select_match_type') {
                config.tipoEncuentro = i.values[0];
                if (config.tipoCompeticion === 'equipos') {
                    config.tipoJugadores = 'teams'; // Asumido por defecto para equipos
                    step = 8; // Saltar paso 7 (Representación)
                } else {
                    step = 7;
                }
                await handleStep(i);
            } else if (i.customId === 'select_type') {
                config.tipoJugadores = i.values[0];
                step = 8;
                await handleStep(i);
            } else if (i.customId === 'third_place_yes') {
                config.hayTercerPuesto = true;
                step = 9;
                await handleStep(i);
            } else if (i.customId === 'third_place_no') {
                config.hayTercerPuesto = false;
                step = 9;
                await handleStep(i);
            } else if (i.customId === 'logo_upload_yes') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_logo_upload')
                    .setTitle('Subir Logo del Torneo');

                const fileInput = new FileUploadBuilder()
                    .setCustomId('logo')
                    .setRequired(true);

                const inputLabel = new LabelBuilder()
                    .setLabel("Escudo del Equipo")
                    .setFileUploadComponent(fileInput);

                modal.addLabelComponents(inputLabel);

                await i.showModal(modal);
                const submit = await i.awaitModalSubmit({ time: 600000 }).catch(() => null);
                if (!submit) return;

                const attachmentField = submit.fields.getField("logo");
                const attachmentUrl = attachmentField?.attachments.first()?.url;
                if (attachmentUrl && (attachmentUrl.startsWith('http://') || attachmentUrl.startsWith('https://'))) {
                    await submit.deferUpdate();
                    const localPath = await descargarImagen(attachmentUrl, `${config.prefix}_logo`);
                    if (localPath) {
                        config.logo = localPath;

                        try {
                            const paleta = await extractPalette(localPath);
                            config.sugTema = paleta;

                            await submit.editReply({
                                embeds: [
                                    buildEmbed(
                                        `Paso 9c: Paleta de Colores Sugerida`,
                                        `Hemos extraído la siguiente paleta de colores de tu logo:\n\n` +
                                        `• **Primario (Fondo):** \`${paleta.primario}\`\n` +
                                        `• **Secundario (Cajas):** \`${paleta.secundario}\`\n` +
                                        `• **Acento (Destacados):** \`${paleta.acento}\`\n` +
                                        `• **Borde:** \`${paleta.borde}\`\n` +
                                        `• **Texto:** \`${paleta.texto}\`\n\n` +
                                        `¿Deseas aplicar esta paleta sugerida o mantener la que configuraste anteriormente?`
                                    )
                                ],
                                components: [
                                    new ActionRowBuilder().addComponents(
                                        new ButtonBuilder().setCustomId('palette_apply_suggested').setLabel('Aplicar Sugerida').setStyle(ButtonStyle.Success),
                                        new ButtonBuilder().setCustomId('palette_keep_current').setLabel('Mantener Anterior').setStyle(ButtonStyle.Secondary)
                                    )
                                ]
                            });
                        } catch (err) {
                            console.error('Error al extraer paleta:', err);
                            step = 10;
                            await handleStep(submit);
                        }
                    } else {
                        step = 10;
                        await handleStep(submit);
                    }
                } else {
                    step = 10;
                    await handleStep(submit || i);
                }
            } else if (i.customId === 'logo_upload_no') {
                config.logo = null;
                step = 10;
                await handleStep(i);
            } else if (i.customId === 'palette_apply_suggested') {
                if (config.sugTema) {
                    config.tema = { ...config.tema, ...config.sugTema };
                }
                step = 10;
                await handleStep(i);
            } else if (i.customId === 'palette_keep_current') {
                step = 10;
                await handleStep(i);
            } else if (i.customId === 'edit_design') {
                step = 9;
                await handleStep(i);
            } else if (i.customId === 'retry_step4') {
                step = 4;
                await handleStep(i);
            } else if (i.customId === 'confirm_torneo') {
                await saveTorneo(i);
                collector.stop();
            }
        } catch (error) {
            console.error('Error in wizard:', error);
        }
    });

    async function handleStep(i) {
        if (step === 1) {
            const modal = new ModalBuilder()
                .setCustomId('modal_step1')
                .setTitle('1. Nombre y Prefijo');

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nombre').setLabel('Nombre del Torneo').setPlaceholder('Ej: Champions Platubi').setRequired(true).setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prefix').setLabel('Prefijo para comandos').setPlaceholder('Ej: cl').setRequired(true).setMaxLength(5).setStyle(TextInputStyle.Short))
            );

            await i.showModal(modal);
            const submit = await i.awaitModalSubmit({ time: 600000 }).catch(() => null);
            if (!submit) return;

            config.nombre = submit.fields.getTextInputValue('nombre');
            config.prefix = submit.fields.getTextInputValue('prefix').toLowerCase();
            step = 2;

            await submit.update({
                embeds: [buildEmbed(`Paso 2: Canal de Resultados`, `Selecciona el canal donde se reportarán los resultados y se verán las tablas.`)],
                components: [new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder().setCustomId('select_channel').setPlaceholder('Seleccionar canal...').addChannelTypes(ChannelType.GuildText)
                )]
            });
        } else if (step === 3) {
            await i.update({
                embeds: [buildEmbed(`Paso 3: Tipo de Competición`, `Selecciona cómo competirán los participantes:\n\n👤 **Individual:** Los jugadores se inscriben y juegan solos.\n👥 **Duo:** Se inscriben en parejas de 2 jugadores que juegan en simultáneo.\n⚔️ **Equipos:** Se inscriben equipos con roster, disputando enfrentamientos individuales al mejor de N.`)],
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('select_competition_type')
                        .setPlaceholder('Seleccionar tipo de competición...')
                        .addOptions([
                            { label: 'Individual', value: 'individual', description: 'Cada jugador compite individualmente', emoji: '👤' },
                            { label: 'Duo', value: 'duo', description: '2 jugadores por cupo de inscripción', emoji: '👥' },
                            { label: 'Equipos', value: 'equipos', description: 'Equipos con roster (subpartidos al azar)', emoji: '⚔️' }
                        ])
                )]
            });
        } else if (step === 4) {
            let id = Math.random().toString(36).substring(2, 15);
            const modal = new ModalBuilder()
                .setCustomId(`modal_step4_${id}`)
                .setTitle('4. Participantes');

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`cant_${id}`).setLabel('Cantidad de participantes').setPlaceholder('Ej: 16').setMinLength(1).setMaxLength(3).setRequired(true).setStyle(TextInputStyle.Short))
            );

            await i.showModal(modal);
            const submit = await i.awaitModalSubmit({ time: 600000 }).catch(() => null);
            if (!submit) return;

            let cant = parseInt(submit.fields.getTextInputValue(`cant_${id}`));

            let errMsg = null;
            if (isNaN(cant)) {
                errMsg = 'Debes ingresar un número entero válido.';
            } else if (config.tipoCompeticion === 'individual' && cant < 2) {
                errMsg = 'Cantidad inválida, el mínimo para formato Individual es 2 participantes.';
            } else if (config.tipoCompeticion === 'duo' && cant < 4) {
                errMsg = 'Cantidad inválida, el mínimo para formato Duo es 4 participantes (mínimo 2 parejas).';
            } else if (config.tipoCompeticion === 'equipos' && cant < 2) {
                errMsg = 'Cantidad inválida, el mínimo para formato Equipos es 2 equipos.';
            }

            if (errMsg) {
                return submit.update({
                    embeds: [buildEmbed(`⚠️ Paso 4: Cantidad de Participantes`, `❌ **${errMsg}**\n\nHaz clic en el botón de abajo para ingresar la cantidad nuevamente.`)],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('retry_step4')
                            .setLabel('🔢 Reintentar Ingreso')
                            .setStyle(ButtonStyle.Primary)
                    )]
                });
            }

            config.cantidadParticipantes = cant;
            step = 5;

            const options = [
                { label: 'Eliminación Directa', value: 'directa', description: 'Todos a brackets' },
                { label: 'Liga', value: 'liga', description: 'Todos contra todos' },
            ];

            if (cant > 3) {
                options.unshift({ label: 'Champions League', value: 'champions', description: 'Liguilla -> Playoff -> Eliminatoria' })
                options.unshift({ label: 'Eurocopa', value: 'euro', description: 'Grupos con mejores terceros' })
                options.push({ label: 'Personalizado', value: 'personalizado', description: 'Configuración manual de grupos y fases' })
            }

            await submit.update({
                embeds: [buildEmbed(`Paso 5: Formato del Torneo`, `Selecciona el formato de competición:`)],
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_format').setPlaceholder('Seleccionar formato...').addOptions(options)
                )]
            });
        } else if (step === 6) {
            const options = [
                { label: 'Partido Único', value: 'unico', description: 'Un solo enfrentamiento por ronda' },
                { label: 'Ida y Vuelta', value: 'ida_vuelta', description: 'Dos partidos (con desempate si aplica)' },
            ]

            if (config.cantidadParticipantes > 3) {
                options.push({ label: 'Grupos (1) y Eliminatoria (2)', value: 'hibrido', description: 'Grupos a partido único y brackets a ida y vuelta' });
            }
            await i.update({
                embeds: [buildEmbed(`Paso 6: Tipo de Encuentro`, `Selecciona cómo se jugarán los partidos:`)],
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_match_type').setPlaceholder('Seleccionar tipo de encuentro...').addOptions(options)
                )]
            });
        } else if (step === 7) {
            await i.update({
                embeds: [buildEmbed(`Paso 7: Tipo de Participantes`, `¿Qué representarán los participantes?`)],
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_type').setPlaceholder('Seleccionar tipo...').addOptions([
                        { label: 'Equipos', value: 'teams', description: 'Equipos con escudos' },
                        { label: 'Usuarios', value: 'users', description: 'Avatares de Discord' },
                        { label: 'Países', value: 'countries', description: 'Banderas' }
                    ])
                )]
            });
        } else if (step === 8) {
            if (config.cantidadParticipantes < 4) {
                config.hayTercerPuesto = false;
                step = 9;
                await handleStep(i);
                return;
            }
            await i.update({
                embeds: [buildEmbed(`Paso 8: Tercer Puesto`, `¿Habrá partido por el tercer puesto?`)],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('third_place_yes').setLabel('Sí').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('third_place_no').setLabel('No').setStyle(ButtonStyle.Danger)
                )]
            });
        } else if (step === 9) {
            const modal = new ModalBuilder()
                .setCustomId('modal_step9')
                .setTitle('9. Personalización Visual');

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pri').setLabel('Color Primario (Fondo)').setPlaceholder('#1a1a2e').setRequired(false).setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('sec').setLabel('Color Secundario (Cajas)').setPlaceholder('#16213e').setRequired(false).setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('acc').setLabel('Color Acento (Destacados)').setPlaceholder('#e94560').setRequired(false).setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('txt').setLabel('Color de Texto').setPlaceholder('#ffffff').setRequired(false).setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bor').setLabel('Color de Borde').setPlaceholder('#0f3460').setRequired(false).setStyle(TextInputStyle.Short))
            );

            await i.showModal(modal);
            const submit = await i.awaitModalSubmit({ time: 600000 }).catch(() => null);
            if (!submit) return;

            const sanitizeHex = (val, fallback) => {
                if (!val || typeof val !== 'string') return fallback;
                const matches = val.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
                if (matches && matches.length > 0) return matches[0];
                if (/^[0-9a-fA-F]{6}$/.test(val.trim())) return `#${val.trim()}`;
                return fallback;
            };

            config.tema.primario = sanitizeHex(submit.fields.getTextInputValue('pri'), '#1a1a2e');
            config.tema.secundario = sanitizeHex(submit.fields.getTextInputValue('sec'), '#16213e');
            config.tema.acento = sanitizeHex(submit.fields.getTextInputValue('acc'), '#e94560');
            config.tema.texto = sanitizeHex(submit.fields.getTextInputValue('txt'), '#ffffff');
            config.tema.borde = sanitizeHex(submit.fields.getTextInputValue('bor'), '#0f3460');

            await submit.update({
                embeds: [buildEmbed(`Paso 9b: Logo del Torneo (Opcional)`, `¿Deseas agregar un logo para el torneo?\n\nEste logo se colocará como thumbnail en los embeds y reemplazará al emoji de copa en las imágenes del fixture/bracket.`)],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('logo_upload_yes').setLabel('Subir Logo').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('logo_upload_no').setLabel('Continuar sin Logo').setStyle(ButtonStyle.Secondary)
                )]
            });
        } else if (step === 10) {
            // El usuario ya ingresó colores y logo. Mostrar resumen y generar previsualizaciones
            let updateTarget = i;
            if (i.deferred || i.replied) {
                // Si la interacción ya fue respondida/diferida, usamos editReply
                await i.editReply({
                    embeds: [buildEmbed(`Paso 10: Generando Previsualizaciones`, `Por favor espera mientras generamos las previsualizaciones visuales de tu torneo...`)],
                    components: [],
                    files: []
                });
            } else {
                await i.deferUpdate();
            }

            const [previewTabla, previewBrackets] = await Promise.all([
                generarPreviewTema(config.nombre, config.tema, config.logo),
                generarBracketCopa({ nombre: config.nombre, tema: config.tema, logo: config.logo })
            ]);

            const fileTabla = new AttachmentBuilder(previewTabla, { name: 'tabla.png' });
            const fileBrackets = new AttachmentBuilder(previewBrackets, { name: 'brackets.png' });

            const resumen = `**Nombre:** ${config.nombre}\n**Prefijo:** ${config.prefix}\n**Tipo Competición:** \`${config.tipoCompeticion}\`\n**Participantes:** ${config.cantidadParticipantes}\n**Formato:** ${config.formatoPreset}\n**Encuentros:** ${config.tipoEncuentro}\n**Tipo:** ${config.tipoJugadores}\n**Canal:** <#${config.canalResultados}>\n**3er Puesto:** ${config.hayTercerPuesto ? 'Sí' : 'No'}\n**Logo:** ${config.logo ? '✅ Subido' : '❌ No asignado'}`;

            const embedResumen = new EmbedBuilder()
                .setTitle('🏁 Resumen del Torneo')
                .setDescription(`Revisa los datos y el diseño antes de crear el torneo:\n\n${resumen}`)
                .setColor('Gold')
                .setImage('attachment://tabla.png');

            const embedBrackets = new EmbedBuilder()
                .setTitle('📊 Preview de Brackets')
                .setImage('attachment://brackets.png')
                .setColor('Gold');

            await i.editReply({
                embeds: [embedResumen, embedBrackets],
                files: [fileTabla, fileBrackets],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_torneo').setLabel('Crear Torneo').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('edit_design').setLabel('Editar Diseño').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('start_wizard').setLabel('Reiniciar Todo').setStyle(ButtonStyle.Secondary)
                )]
            });
        }
    }

    function buildEmbed(title, desc) {
        return new EmbedBuilder().setTitle(title).setDescription(desc).setColor('Blue').setFooter({ text: `Paso ${step} de 10` });
    }

    async function saveTorneo(i) {
        await i.deferUpdate();

        if (config.formatoPreset === 'champions') {
            const total = config.cantidadParticipantes;
            config.championsConfig = {
                directos: Math.floor(total * 0.22) || 1,
                playoff: Math.floor(total * 0.44) || 2,
                eliminados: total - (Math.floor(total * 0.22) || 1) - (Math.floor(total * 0.44) || 2)
            };
            config.gruposHabilitados = false;
            config.tipoEncuentro = 'ida_vuelta';
        } else if (config.formatoPreset === 'euro') {
            config.gruposHabilitados = true;
            config.mejorTercero = true;
            config.cantidadGrupos = Math.ceil(config.cantidadParticipantes / 4);
            config.jugadoresPorGrupo = 4;
        } else if (config.formatoPreset === 'liga') {
            config.gruposHabilitados = false;
            config.playoffsHabilitados = false;
            config.cantidadGrupos = 0;
        } else if (config.tipoEncuentro === 'hibrido') {
            config.gruposHabilitados = true;
            config.cantidadGrupos = Math.ceil(config.cantidadParticipantes / 4);
            config.jugadoresPorGrupo = 4;
            config.tipoEncuentro = 'ida_vuelta';
        }

        config.estado = 'Inscripcion';
        config.createdBy = user.id;

        // Limpiar el tema sugerido temporal
        delete config.sugTema;

        await Torneo.create(config);

        await i.editReply({
            embeds: [new EmbedBuilder().setTitle('✅ Torneo Creado').setDescription(`El torneo **${config.nombre}** ha sido creado exitosamente.\n\nAhora puedes usar los comandos:\n> \`!${config.prefix}-tabla\`\n> \`!${config.prefix}-fixture\`\n> \`!${config.prefix}-inscripcion\``).setColor('Green')],
            components: [],
            files: []
        });
    }
}
