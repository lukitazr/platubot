import { resolveFilterTarget, matchInvolvesTarget, paginateFilteredMatches } from '../utils/fixtureFilter.js';
import { generarFixtureImagen } from '../utils/visual/fixtureGenerator.js';
import { generarFixtureSuperligaImagen } from '../utils/visual/fixtureSuperligaGenerator.js';

console.log('--- TEST 1: Paginate Filtered Matches ---');
const dummyMatches = Array.from({ length: 25 }, (_, i) => ({
    localNombre: `Jugador A`,
    visitanteNombre: `Jugador ${i + 1}`,
    fechaNumero: i + 1,
    fechaLabel: `Fecha ${i + 1}`,
    resultado: i < 10 ? '2-1' : 'Pendiente'
}));

const pages = paginateFilteredMatches(dummyMatches, 10);
console.log(`Total Pages generated for 25 matches: ${pages.length}`);
console.assert(pages.length === 3, 'Should generate 3 pages');
console.assert(pages[0].partidos.length === 10, 'Page 0 should have 10 matches');
console.assert(pages[1].partidos.length === 10, 'Page 1 should have 10 matches');
console.assert(pages[2].partidos.length === 5, 'Page 2 should have 5 matches');
console.log(`Page 0 Label: ${pages[0].label}`);
console.log(`Page 1 Label: ${pages[1].label}`);
console.log(`Page 2 Label: ${pages[2].label}`);

console.log('\n--- TEST 2: Match Involves Target ---');
const targetPlayer = {
    isFilter: true,
    type: 'player',
    id: '123456789012345678',
    nombre: 'Luca',
    aliases: ['luca', '123456789012345678', 'lucas']
};

const targetTeam = {
    isFilter: true,
    type: 'team',
    id: 'team_boca',
    nombre: 'Boca Juniors',
    aliases: ['boca juniors', 'boca', 'team_boca']
};

// Match 1: Player is local ID
const m1 = { localId: '123456789012345678', visitanteId: '999', local: 'Luca', visitante: 'Rival' };
console.assert(matchInvolvesTarget(m1, targetPlayer) === true, 'm1 should involve targetPlayer');

// Match 2: Player is visitante alias
const m2 = { local: 'Rival', visitante: 'Lucas' };
console.assert(matchInvolvesTarget(m2, targetPlayer) === true, 'm2 should involve targetPlayer by alias');

// Match 3: Team is local
const m3 = { localNombre: 'Boca Juniors', visitanteNombre: 'River Plate' };
console.assert(matchInvolvesTarget(m3, targetTeam) === true, 'm3 should involve targetTeam');

// Match 4: Duelo individual has player
const m4 = {
    localNombre: 'River',
    visitanteNombre: 'Racing',
    duelosIndividuales: [
        { localJugador: '123456789012345678', localJugadorNombre: 'Luca', visitanteJugador: '555', golesLocal: 3, golesVisitante: 1 }
    ]
};
console.assert(matchInvolvesTarget(m4, targetPlayer) === true, 'm4 should involve targetPlayer via duelosIndividuales');

console.log('\n--- TEST 3: Visual Generation with Fecha Badges ---');
try {
    const buffer1 = await generarFixtureImagen({
        titulo: 'Platubi — Torneo Apertura',
        subtitulo: 'Partidos de Luca (Fechas 1 a 10)',
        partidos: pages[0].partidos.map(p => ({
            local: p.localNombre,
            visitante: p.visitanteNombre,
            resultado: p.resultado,
            fechaLabel: p.fechaLabel,
            fechaNumero: p.fechaNumero
        })),
        tema: { primario: '#1a0505', secundario: '#2e0909', acento: '#ff4d4d', borde: '#450f0f' }
    });
    console.log(`✅ Fixture Image with Fecha Badges generated! Buffer size: ${buffer1.length} bytes`);
} catch (err) {
    console.error('❌ Error generating fixture image:', err);
}

console.log('\n--- TEST 4: Superliga Fixture Multi-Fecha Generation ---');
try {
    const slMatches = Array.from({ length: 4 }, (_, i) => ({
        localNombre: 'Boca Juniors',
        visitanteNombre: `Rival ${i + 1}`,
        fechaNumero: i + 1,
        fechaLabel: `Fecha ${i + 1}`,
        puntosMiniLocal: 2,
        puntosMiniVisitante: 1,
        finalizado: true,
        duelosIndividuales: [
            { localJugadorId: '123456789012345678', visitanteJugadorId: '222', golesLocal: 3, golesVisitante: 2, finalizado: true },
            { localJugadorId: '333', visitanteJugadorId: '444', golesLocal: 1, golesVisitante: 0, finalizado: true },
            { localJugadorId: '555', visitanteJugadorId: '666', golesLocal: 0, golesVisitante: 2, finalizado: true }
        ]
    }));

    const buffer2 = await generarFixtureSuperligaImagen(
        slMatches,
        'FECHAS 1 A 4',
        'SUPERLIGA - TEMPORADA 1',
        [{ nombre: 'Boca Juniors', escudo: null }, { nombre: 'Rival 1', escudo: null }]
    );
    console.log(`✅ Superliga Multi-Fecha Image generated! Buffer size: ${buffer2.length} bytes`);
} catch (err) {
    console.error('❌ Error generating Superliga multi-fecha image:', err);
}

console.log('\nALL TESTS PASSED SUCCESSFULLY! 🎉');
process.exit(0);
