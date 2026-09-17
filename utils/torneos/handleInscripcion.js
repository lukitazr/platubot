import {
    ActionRowBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ComponentType,
    LabelBuilder,
    FileUploadBuilder
} from 'discord.js';
import { getFlagUrl } from '../visual/countryHelper.js';
import descargarImagen from '../descargarImagen.js';
import { ensureUserRegistered } from '../db/userResolver.js';

export async function handleInscripcion(client, message, args, torneo) {
    if (!message.member.permissions.has('Administrator') && message.author.id !== torneo.createdBy) {
        return message.reply('❌ Solo administradores pueden usar este comando.');
    }

    if (torneo.tipoCompeticion === 'duo') {
        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(`admin_select_duo|${torneo.prefix}`)
                .setPlaceholder('Selecciona a los 2 jugadores para el duo...')
                .setMinValues(2)
                .setMaxValues(2)
        );

        const msg = await message.reply({
            content: '👥 **Inscripción Administrativa (Duo)**\nSelecciona a los dos usuarios que jugarán juntos:',
            components: [row]
        });

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id,
            componentType: ComponentType.UserSelect,
            time: 60000
        });

        collector.on('collect', async interaction => {
            const user1Id = interaction.values[0];
            const user2Id = interaction.values[1];

            const user1 = interaction.users.get(user1Id);
            const user2 = interaction.users.get(user2Id);

            // Verificar si alguno ya está registrado
            const yaInscrito = torneo.equipos.some(e =>
                e.miembros?.some(m => m.discordId === user1Id || m.discordId === user2Id) ||
                e.discordId === user1Id || e.discordId === user2Id
            );

            if (yaInscrito) {
                return interaction.reply({ content: '❌ Uno o ambos jugadores ya están en el torneo.', flags: 64 });
            }

            const modalId = `modal_admin_duo|${user1Id}|${user2Id}`;
            const modal = new ModalBuilder().setCustomId(modalId).setTitle('Registrar Pareja (Duo)');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('nombre')
                        .setLabel('Nombre del Duo / Pareja')
                        .setValue(`${user1.username} & ${user2.username}`)
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                )
            );

            await interaction.showModal(modal);

            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                time: 600000
            }).catch(() => null);

            if (modalSubmit) {
                const nombreIngresado = modalSubmit.fields.getTextInputValue('nombre');
                await modalSubmit.deferReply({ flags: 64 });

                await ensureUserRegistered(user1, client);
                await ensureUserRegistered(user2, client);

                const nuevoDuo = {
                    nombre: nombreIngresado,
                    miembros: [
                        { discordId: user1Id, avatar: user1.displayAvatarURL({ extension: 'png', size: 128 }) },
                        { discordId: user2Id, avatar: user2.displayAvatarURL({ extension: 'png', size: 128 }) }
                    ],
                    puntos: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0
                };

                torneo.equipos.push(nuevoDuo);
                await torneo.save();

                await modalSubmit.editReply({ content: `✅ **Pareja registrada:** **${nombreIngresado}** se ha unido al torneo.` });
            }
        });
        return;
    }

    if (torneo.tipoCompeticion === 'equipos') {
        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(`admin_select_owner|${torneo.prefix}`)
                .setPlaceholder('Selecciona al propietario del equipo...')
        );

        const msg = await message.reply({
            content: '🛡️ **Inscripción Administrativa (Equipos)**\nSelecciona al usuario que será propietario/coach del equipo:',
            components: [row]
        });

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id,
            componentType: ComponentType.UserSelect,
            time: 600000
        });

        collector.on('collect', async interaction => {
            const ownerId = interaction.values[0];
            const ownerUser = interaction.users.get(ownerId);

            const yaInscrito = torneo.equipos.some(e =>
                e.propietario === ownerId || e.discordId === ownerId
            );

            if (yaInscrito) {
                return interaction.reply({ content: `❌ **${ownerUser.tag}** ya tiene un equipo o ya está registrado.`, flags: 64 });
            }

            const modalId = `modal_admin_team|${ownerId}`;
            const modal = new ModalBuilder().setCustomId(modalId).setTitle('Crear Equipo');

            const nLabel = new LabelBuilder()
                .setLabel('Nombre del Equipo')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('nombre')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Ej: Los Galácticos')
                        .setRequired(true)
                );

            const fileInput = new FileUploadBuilder()
                .setCustomId('logo')
                .setMaxValues(1)
                .setRequired(true);

            const labelInput = new LabelBuilder()
                .setLabel("Escudo / Logo")
                .setDescription("Sube una imagen para el escudo de tu equipo")
                .setFileUploadComponent(fileInput);

            modal.addLabelComponents(nLabel, labelInput);

            await interaction.showModal(modal);

            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                time: 600000
            }).catch(() => null);

            if (modalSubmit) {
                const nombreIngresado = modalSubmit.fields.getTextInputValue('nombre');
                const attachmentField = modalSubmit.fields.getField("logo");
                const attachmentUrl = attachmentField?.attachments.first()?.url;

                if (!attachmentUrl) {
                    return modalSubmit.reply({ content: '❌ Debes subir un logo para el equipo.', flags: 64 });
                }

                await modalSubmit.deferReply({ flags: 64 });
                await ensureUserRegistered(ownerUser || ownerId, client);
                const localPath = await descargarImagen(attachmentUrl, `${torneo.prefix}_team_${ownerId}`);

                const nuevoEquipo = {
                    nombre: nombreIngresado,
                    avatar: localPath || ownerUser.displayAvatarURL({ extension: 'png' }),
                    propietario: ownerId,
                    miembros: [],
                    puntos: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0
                };

                torneo.equipos.push(nuevoEquipo);
                await torneo.save();

                await modalSubmit.editReply({ content: `✅ **Equipo registrado:** **${nombreIngresado}** se ha unido al torneo. El propietario es <@${ownerId}>.` });
            }
        });
        return;
    }

    // Flujo Individual
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId(`admin_select_user|${torneo.prefix}`)
            .setPlaceholder('Selecciona al usuario para inscribir...')
    );

    const msg = await message.reply({
        content: '⚙️ **Inscripción Administrativa**\nSelecciona un usuario del menú:',
        components: [row]
    });

    const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        componentType: ComponentType.UserSelect,
        time: 600000
    });

    collector.on('collect', async interaction => {
        const selectedId = interaction.values[0];
        const selectedUser = interaction.users.get(selectedId);

        if (torneo.equipos.some(e => e.discordId === selectedId)) {
            return interaction.reply({ content: `❌ **${selectedUser.tag}** ya está en el torneo.`, flags: 64 });
        }

        if (torneo.tipoJugadores === 'users') {
            await interaction.deferUpdate();
            await inscribirFinal(client, interaction, torneo, selectedUser, selectedUser.username, selectedUser.displayAvatarURL({ extension: 'png' }));
            return;
        }

        const modalId = `modal_admin_ins|${selectedId}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle(`Inscribir a ${selectedUser.username}`);

        const label = torneo.tipoJugadores === 'countries' ? 'Nombre del País' : 'Nombre del Equipo';
        const nLabel = new LabelBuilder()
            .setLabel(label)
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId('nombre')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ej: Argentina / Real Madrid')
                    .setRequired(true)
            );

        if (torneo.tipoJugadores === 'teams') {
            const fileInput = new FileUploadBuilder().setCustomId('logo').setMaxValues(1).setRequired(true);
            const labelInput = new LabelBuilder().setLabel("Logo").setDescription("Subi una imagen para usarla como logo del equipo").setFileUploadComponent(fileInput);
            modal.addLabelComponents(nLabel, labelInput);
        } else {
            modal.addLabelComponents(nLabel);
        }

        await interaction.showModal(modal);

        const modalSubmit = await interaction.awaitModalSubmit({
            filter: i => i.customId === modalId && i.user.id === interaction.user.id,
            time: 600000
        }).catch(() => null);

        if (modalSubmit) {
            const nombreIngresado = modalSubmit.fields.getTextInputValue('nombre');
            let finalAvatar = selectedUser.displayAvatarURL({ extension: 'png', size: 128 });

            if (torneo.tipoJugadores === 'teams') {
                const attachmentField = modalSubmit.fields.getField("logo");
                const attachmentUrl = attachmentField?.attachments.first()?.url;
                if (attachmentUrl) {
                    const localPath = await descargarImagen(attachmentUrl, `${torneo.prefix}_${selectedId}`);
                    if (localPath) finalAvatar = localPath;
                }
            }

            await modalSubmit.deferReply({ flags: 64 });
            await inscribirFinal(client, modalSubmit, torneo, selectedUser, nombreIngresado, finalAvatar);
        }
    });
}

async function inscribirFinal(client, context, torneo, user, nombre, avatar) {
    let finalAvatar = avatar;
    await ensureUserRegistered(user, client);

    // Si es un torneo de países, intentar obtener la bandera automáticamente
    if (torneo.tipoJugadores === 'countries') {
        const flagUrl = getFlagUrl(nombre);
        if (flagUrl) finalAvatar = flagUrl;
    }

    const nuevoEquipo = {
        nombre: nombre,
        discordId: user.id,
        avatar: finalAvatar,
        puntos: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0
    };

    torneo.equipos.push(nuevoEquipo);
    await torneo.save();
    await context.editReply({ content: `✅ **Inscripción Exitosa:** **${user.tag}** se ha unido como **${nombre}**.` });
}

export async function handleSelfInscripcion(client, message, args, torneo) {
    if (torneo.estado !== 'Inscripcion') {
        return message.reply('❌ La inscripción para este torneo no está abierta.');
    }
    if (!torneo.inscripcionAbierta) {
        return message.reply('❌ La auto-inscripción está deshabilitada en este torneo.');
    }

    const userId = message.author.id;
    const yaInscrito = torneo.equipos.some(e => {
        if (torneo.tipoCompeticion === 'duo') {
            return e.miembros?.some(m => m.discordId === userId) || e.discordId === userId;
        }
        if (torneo.tipoCompeticion === 'equipos') {
            return e.propietario === userId || e.miembros?.some(m => m.discordId === userId) || e.discordId === userId;
        }
        return e.discordId === userId;
    });

    if (yaInscrito) {
        return message.reply('❌ Ya estás inscrito o formas parte de un equipo en este torneo.');
    }

    if (torneo.equipos.length >= torneo.cantidadParticipantes) {
        return message.reply('❌ El torneo ya ha alcanzado el límite máximo de participantes.');
    }

    if (torneo.tipoCompeticion === 'duo') {
        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(`self_select_partner|${torneo.prefix}`)
                .setPlaceholder('Selecciona a tu pareja (compañero)...')
        );

        const msg = await message.reply({
            content: '👥 **Inscripción en Duo**\nPor favor, selecciona a tu compañero de juego del menú:',
            components: [row]
        });

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 600000
        });

        collector.on('collect', async interaction => {
            const partnerId = interaction.values[0];
            if (partnerId === userId) {
                return interaction.reply({ content: '❌ No puedes elegirte a ti mismo como compañero.', flags: 64 });
            }

            const partnerUser = interaction.users.get(partnerId);

            const partnerInscrito = torneo.equipos.some(e =>
                e.miembros?.some(m => m.discordId === partnerId) ||
                e.discordId === partnerId
            );

            if (partnerInscrito) {
                return interaction.reply({ content: `❌ **${partnerUser.username}** ya está registrado en el torneo.`, flags: 64 });
            }

            const modalId = `modal_self_duo|${partnerId}`;
            const modal = new ModalBuilder().setCustomId(modalId).setTitle('Registrar Pareja (Duo)');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('nombre')
                        .setLabel('Nombre del Duo')
                        .setValue(`${message.author.username} & ${partnerUser.username}`)
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                )
            );

            await interaction.showModal(modal);

            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                time: 600000
            }).catch(() => null);

            if (modalSubmit) {
                const nombreIngresado = modalSubmit.fields.getTextInputValue('nombre');
                await modalSubmit.deferReply({ flags: 64 });

                await ensureUserRegistered(message.author, client);
                await ensureUserRegistered(partnerUser || partnerId, client);

                const nuevoDuo = {
                    nombre: nombreIngresado,
                    miembros: [
                        { discordId: userId, avatar: message.author.displayAvatarURL({ extension: 'png', size: 128 }) },
                        { discordId: partnerId, avatar: partnerUser.displayAvatarURL({ extension: 'png', size: 128 }) }
                    ],
                    puntos: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0
                };

                torneo.equipos.push(nuevoDuo);
                await torneo.save();

                await modalSubmit.editReply({ content: `✅ **Inscripción de Duo Exitosa:** Te has inscrito junto a **${partnerUser.tag}** como **${nombreIngresado}**.` });
            }
        });
        return;
    }

    if (torneo.tipoCompeticion === 'equipos') {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`self_create_team_btn|${torneo.prefix}`)
                .setLabel('Registrar Equipo')
                .setStyle(ButtonStyle.Success)
        );

        const msg = await message.reply({
            content: '⚔️ **Inscripción por Equipos**\nPresiona el botón para abrir el formulario y registrar tu equipo:',
            components: [row]
        });

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 600000
        });

        collector.on('collect', async interaction => {
            const modalId = `modal_self_team|${torneo.prefix}`;
            const modal = new ModalBuilder().setCustomId(modalId).setTitle('Registrar mi Equipo');

            const nLabel = new LabelBuilder()
                .setLabel('Nombre del Equipo')
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId('nombre')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Ej: Los Intocables')
                        .setRequired(true)
                );

            const fileInput = new FileUploadBuilder()
                .setCustomId('logo')
                .setMaxValues(1)
                .setRequired(true);

            const labelInput = new LabelBuilder()
                .setLabel("Escudo / Logo")
                .setDescription("Sube la imagen para el logo de tu equipo")
                .setFileUploadComponent(fileInput);

            modal.addLabelComponents(nLabel, labelInput);

            await interaction.showModal(modal);

            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => i.customId === modalId && i.user.id === interaction.user.id,
                time: 600000
            }).catch(() => null);

            if (modalSubmit) {
                const nombreIngresado = modalSubmit.fields.getTextInputValue('nombre');
                const attachmentField = modalSubmit.fields.getField("logo");
                const attachmentUrl = attachmentField?.attachments.first()?.url;

                if (!attachmentUrl) {
                    return modalSubmit.reply({ content: '❌ Debes subir una imagen para el escudo de tu equipo.', flags: 64 });
                }

                await modalSubmit.deferReply({ flags: 64 });
                await ensureUserRegistered(message.author, client);
                const localPath = await descargarImagen(attachmentUrl, `${torneo.prefix}_team_${userId}`);

                const nuevoEquipo = {
                    nombre: nombreIngresado,
                    avatar: localPath || message.author.displayAvatarURL({ extension: 'png' }),
                    propietario: userId,
                    miembros: [
                        { discordId: userId, nombre: message.author.username, avatar: message.author.displayAvatarURL({ extension: 'png' }) }
                    ],
                    puntos: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0
                };

                torneo.equipos.push(nuevoEquipo);
                await torneo.save();

                await modalSubmit.editReply({ content: `✅ **Inscripción de Equipo Exitosa:** Has creado y registrado el equipo **${nombreIngresado}**.` });
            }
        });
        return;
    }

    if (torneo.tipoJugadores === 'users') {
        await ensureUserRegistered(message.author, client);
        const nuevoEquipo = {
            nombre: message.author.username,
            discordId: userId,
            avatar: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
            puntos: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0
        };

        torneo.equipos.push(nuevoEquipo);
        await torneo.save();
        return message.reply(`✅ **Inscripción Exitosa:** Te has inscrito como **${message.author.username}**.`);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`self_register_indiv_btn|${torneo.prefix}`)
            .setLabel('Completar Inscripción')
            .setStyle(ButtonStyle.Primary)
    );

    const msg = await message.reply({
        content: `👤 **Inscripción Individual (${torneo.tipoJugadores === 'countries' ? 'País' : 'Equipo'})**\nPresiona el botón para ingresar tu nombre y detalles:`,
        components: [row]
    });

    const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === userId,
        time: 600000
    });

    collector.on('collect', async interaction => {
        const modalId = `modal_self_indiv|${torneo.prefix}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle('Completar Registro');

        const label = torneo.tipoJugadores === 'countries' ? 'Nombre del País' : 'Nombre del Equipo';
        const nLabel = new LabelBuilder()
            .setLabel(label)
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId('nombre')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ej: Brasil / Barcelona')
                    .setRequired(true)
            );

        if (torneo.tipoJugadores === 'teams') {
            const fileInput = new FileUploadBuilder().setCustomId('logo').setMaxValues(1).setRequired(true);
            const labelInput = new LabelBuilder().setLabel("Escudo / Logo").setDescription("Sube la imagen para el logo").setFileUploadComponent(fileInput);
            modal.addLabelComponents(nLabel, labelInput);
        } else {
            modal.addLabelComponents(nLabel);
        }

        await interaction.showModal(modal);

        const modalSubmit = await interaction.awaitModalSubmit({
            filter: i => i.customId === modalId && i.user.id === interaction.user.id,
            time: 600000
        }).catch(() => null);

        if (modalSubmit) {
            const nombreIngresado = modalSubmit.fields.getTextInputValue('nombre');
            let finalAvatar = message.author.displayAvatarURL({ extension: 'png', size: 128 });

            if (torneo.tipoJugadores === 'teams') {
                const attachmentField = modalSubmit.fields.getField("logo");
                const attachmentUrl = attachmentField?.attachments.first()?.url;
                if (attachmentUrl) {
                    const localPath = await descargarImagen(attachmentUrl, `${torneo.prefix}_${userId}`);
                    if (localPath) finalAvatar = localPath;
                }
            } else if (torneo.tipoJugadores === 'countries') {
                const flagUrl = getFlagUrl(nombreIngresado);
                if (flagUrl) finalAvatar = flagUrl;
            }

            await modalSubmit.deferReply({ flags: 64 });
            await ensureUserRegistered(message.author, client);

            const nuevoEquipo = {
                nombre: nombreIngresado,
                discordId: userId,
                avatar: finalAvatar,
                puntos: 0, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0
            };

            torneo.equipos.push(nuevoEquipo);
            await torneo.save();

            await modalSubmit.editReply({ content: `✅ **Inscripción Exitosa:** Te has inscrito como **${nombreIngresado}**.` });
        }
    });
}