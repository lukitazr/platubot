import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

/**
 * Genera las filas de componentes para navegar por las páginas de la tabla histórica.
 * @param {string} prefix Prefijo único para los customIds (ej: 'tablahist')
 * @param {number} current Índice de página actual (0-indexed)
 * @param {number} total Total de páginas
 * @param {number} totalPlayers Total de jugadores registrados
 * @param {number} pageSize Cantidad de jugadores por página (20 por defecto)
 * @returns {ActionRowBuilder[]}
 */
export function buildTablaHistoricaNavigation(prefix, current, total, totalPlayers, pageSize = 20) {
  const rows = [];

  if (total <= 1) return rows;

  // Fila 1: Select Menu para saltar a una página específica si hay varias páginas
  const options = [];
  for (let p = 0; p < total; p++) {
    const startNum = p * pageSize + 1;
    const endNum = Math.min((p + 1) * pageSize, totalPlayers);
    options.push({
      label: `Página ${p + 1} (Top ${startNum} - ${endNum})`,
      description: `Ver participantes del ranking del #${startNum} al #${endNum}`,
      value: `${p}`,
      default: p === current,
    });
  }

  let optionsToDisplay = options;
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
    .setCustomId(`${prefix}_select`)
    .setPlaceholder(`Seleccionar página (${current + 1}/${total})...`)
    .addOptions(optionsToDisplay);

  rows.push(new ActionRowBuilder().addComponents(select));

  // Fila 2: Botones de navegación
  const rowButtons = new ActionRowBuilder();

  // Botón Primera Página (si hay más de 2 páginas)
  if (total > 2) {
    rowButtons.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}_first`)
        .setLabel('⏮️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(current <= 0)
    );
  }

  // Botón Anterior
  rowButtons.addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_prev`)
      .setLabel('◀️ Anterior')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current <= 0)
  );

  // Botón Indicador de Página Actual (deshabilitado como badge)
  rowButtons.addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_indicator`)
      .setLabel(`${current + 1} / ${total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Botón Siguiente
  rowButtons.addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_next`)
      .setLabel('Siguiente ▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current >= total - 1)
  );

  // Botón Última Página (si hay más de 2 páginas)
  if (total > 2) {
    rowButtons.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}_last`)
        .setLabel('⏭️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(current >= total - 1)
    );
  }

  rows.push(rowButtons);

  return rows;
}
