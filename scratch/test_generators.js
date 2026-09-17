import generarBracket from '../utils/generarBracket.js';
import { generarTablaImagenCopa } from '../utils/visual/copaVisualGenerator.js';
import { writeFileSync } from 'fs';

async function test() {
    console.log("Starting generator test...");
    
    // Mock teams (like duos, without root discordId)
    const teams = [
        { nombre: "Duo Alfa", miembros: [{ discordId: "1", avatar: null }, { discordId: "2", avatar: null }] },
        { nombre: "Duo Beta", miembros: [{ discordId: "3", avatar: null }, { discordId: "4", avatar: null }] },
        { nombre: "Duo Gamma", miembros: [{ discordId: "5", avatar: null }, { discordId: "6", avatar: null }] },
        { nombre: "Duo Delta", miembros: [{ discordId: "7", avatar: null }, { discordId: "8", avatar: null }] },
        { nombre: "Duo Epsilon", miembros: [{ discordId: "9", avatar: null }, { discordId: "10", avatar: null }] }
    ];

    console.log("1. Testing bracket generation...");
    const bracketData = generarBracket(teams, 'unico');
    console.log("Bracket generated successfully!");
    console.log("Fases:", bracketData.fasesEliminatoria);
    console.log("Matches count in R1:", bracketData.llaves[bracketData.fasesEliminatoria[0]].length);
    console.log("First match team 1:", bracketData.llaves[bracketData.fasesEliminatoria[0]][0].equipo1.nombre);
    console.log("First match team 1 discordId:", bracketData.llaves[bracketData.fasesEliminatoria[0]][0].equipo1.discordId);

    console.log("\n2. Testing table rendering with multiple groups...");
    // Mock tournament with groups
    const torneo = {
        nombre: "Torneo Test",
        prefix: "test",
        gruposHabilitados: true,
        cantidadGrupos: 3,
        clasificadosPorGrupo: 2,
        tema: {
            primario: '#1a1a2e',
            secundario: '#16213e',
            acento: '#e94560',
            texto: '#ffffff',
            borde: '#0f3460',
        },
        equipos: [
            { nombre: "Alfa", grupo: "A", puntos: 6, pj: 2, pg: 2, pe: 0, pp: 0, gf: 5, gc: 1, miembros: [] },
            { nombre: "Beta", grupo: "A", puntos: 3, pj: 2, pg: 1, pe: 0, pp: 1, gf: 3, gc: 3, miembros: [] },
            { nombre: "Gamma", grupo: "B", puntos: 4, pj: 2, pg: 1, pe: 1, pp: 0, gf: 2, gc: 1, miembros: [] },
            { nombre: "Delta", grupo: "B", puntos: 1, pj: 2, pg: 0, pe: 1, pp: 1, gf: 1, gc: 3, miembros: [] },
            { nombre: "Epsilon", grupo: "C", puntos: 3, pj: 1, pg: 1, pe: 0, pp: 0, gf: 2, gc: 0, miembros: [] }
        ]
    };

    const tablaData = torneo.equipos.map(e => ({
        ...e,
        avatar: null
    }));

    try {
        const buffer = await generarTablaImagenCopa(torneo, tablaData, torneo.nombre);
        console.log("Table image generated successfully! Buffer length:", buffer.length);
        writeFileSync('scratch/test_tabla.png', buffer);
        console.log("Saved test_tabla.png to scratch directory.");
    } catch (err) {
        console.error("Error generating table image:", err);
    }
}

test().catch(console.error);
