import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

/**
 * Genera las filas de componentes para navegar por el fixture.
 * @param {string} prefix Prefijo único para los customIds (ej: 'primera', 'segunda', 'torneo_cl')
 * @param {number} current actual (índice o número de fecha)
 * @param {number} total total de fechas/fases
 * @param {Array<string>} labels etiquetas para el select menu
 * @returns {ActionRowBuilder[]}
 */
export function buildFixtureNavigation(prefix, current, total, labels = []) {
    const rows = [];

    // Fila 1: Select Menu para saltar a una fecha específica
    if (labels.length > 0) {
        let optionsToDisplay = labels.map((label, idx) => ({
            label: label.slice(0, 100),
            value: `${idx}`,
            default: idx === current
        }));

        if (optionsToDisplay.length > 25) {
            let start = Math.max(0, current - 12);
            let end = start + 25;
            if (end > optionsToDisplay.length) {
                end = optionsToDisplay.length;
                start = Math.max(0, end - 25);
            }
            optionsToDisplay = optionsToDisplay.slice(start, end);
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId(`${prefix}_fix_select`)
            .setPlaceholder('Seleccionar fecha/fase...')
            .addOptions(optionsToDisplay);
        rows.push(new ActionRowBuilder().addComponents(select));
    }

    // Fila 2: Botones Atrás/Adelante
    const rowButtons = new ActionRowBuilder();

    rowButtons.addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}_fix_prev`)
            .setLabel('◀️ Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(current <= 0),
        new ButtonBuilder()
            .setCustomId(`${prefix}_fix_next`)
            .setLabel('Siguiente ▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(current >= total - 1)
    );

    rows.push(rowButtons);

    return rows;
}
