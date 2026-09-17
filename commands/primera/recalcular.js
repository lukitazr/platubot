import { SlashCommandBuilder } from 'discord.js';
import Primera from '../../models/Primera.js';

export default {
  name: 'platubi-recalcular',
  aliases: ['plrecalcular', 'recalcularpl'],
  desc: 'Recalcula las estadísticas de los jugadores en base a los partidos jugados.',
  permisos: ['Administrator'],

  data: new SlashCommandBuilder()
    .setName('platubi-recalcular')
    .setDescription('Recalcula las estadísticas de los jugadores en base a los partidos jugados.'),

  execute: async (client, interaction) => {
    await interaction.deferReply();
    
    const ligas = await Primera.find({}).catch(() => []);
    ligas.sort((a, b) => new Date(b.fechaDeInicio) - new Date(a.fechaDeInicio));

    if (!ligas.length) {
      return interaction.editReply('❌ No hay temporadas registradas para Platubi.');
    }

    const liga = ligas[0]; // Trabajamos con la liga activa (la más reciente)
    
    const res = await recalcularEstadisticas(liga);
    
    if (res.success) {
      await interaction.editReply(`✅ Estadísticas recalculadas correctamente para la temporada **${liga.nombreLiga}**.`);
    } else {
      await interaction.editReply('❌ Hubo un error al guardar los datos.');
    }
  },

  run: async (client, message, args) => {
    const ligas = await Primera.find({}).catch(() => []);
    ligas.sort((a, b) => new Date(b.fechaDeInicio) - new Date(a.fechaDeInicio));

    if (!ligas.length) {
      return message.reply('❌ No hay temporadas registradas para Platubi.');
    }

    const liga = ligas[0];
    const loading = await message.reply('<a:loading:1461897825439711468> Recalculando estadísticas...');
    
    const res = await recalcularEstadisticas(liga);
    
    if (res.success) {
      await loading.edit(`✅ Estadísticas recalculadas correctamente para la temporada **${liga.nombreLiga}**.`);
    } else {
      await loading.edit('❌ Hubo un error al guardar los datos.');
    }
  }
};

async function recalcularEstadisticas(liga) {
  const mapa = new Map();
  
  for (const j of liga.jugadores) {
    mapa.set(j.id, { pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, pts: 0 });
  }

  for (const fecha of (liga.partidos ?? [])) {
    if (!Array.isArray(fecha?.partidos)) continue;
    for (const p of fecha.partidos) {
      if (!p.finalizado) continue;
      
      const local = mapa.get(p.localId);
      const visitante = mapa.get(p.visitanteId);
      if (!local || !visitante) continue;

      local.pj++;
      visitante.pj++;
      
      const gl = p.golesLocal || 0;
      const gv = p.golesVisitante || 0;

      local.gf += gl;
      local.gc += gv;
      visitante.gf += gv;
      visitante.gc += gl;

      const isDoubleWO = p.isDoubleWO || (gl === 0 && gv === 0);
      const isWO = p.isWO || (gl === 3 && gv === 0) || (gl === 0 && gv === 3);

      if (isDoubleWO) {
        local.pe++; // WO en la tabla
        local.pts -= 2;
        local.pp++;
        visitante.pe++; // WO en la tabla
        visitante.pts -= 2;
        visitante.pp++;
      } else if (gl > gv) {
        local.pg++;
        local.pts += 3;
        visitante.pp++;
        if (isWO) {
          visitante.pe++; // WO en la tabla
          visitante.pts -= 2;
        }
      } else if (gl < gv) {
        visitante.pg++;
        visitante.pts += 3;
        local.pp++;
        if (isWO) {
          local.pe++; // WO en la tabla
          local.pts -= 2;
        }
      }
    }
  }

  for (const j of liga.jugadores) {
    const calc = mapa.get(j.id);
    if (calc) {
      j.pj = calc.pj;
      j.pg = calc.pg;
      j.pe = calc.pe;
      j.pp = calc.pp;
      j.gf = calc.gf;
      j.gc = calc.gc;
      j.puntos = calc.pts;
    }
  }

  try {
    await liga.save();
    return { success: true };
  } catch (error) {
    console.error('Error al guardar liga recalculada:', error);
    return { success: false };
  }
}
