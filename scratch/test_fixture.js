import { generarFixtureImagen } from '../utils/visual/fixtureGenerator.js';
import { writeFileSync } from 'fs';

async function test() {
    console.log("Starting fixture generator test...");
    
    // Mock duo matches
    const partidos = [
        {
            local: "Duo Alfa",
            visitante: "Duo Beta",
            resultado: "2-1",
            ganador: "Duo Alfa",
            avatarL: [
                { discordId: "1", avatar: null },
                { discordId: "2", avatar: null }
            ],
            avatarV: [
                { discordId: "3", avatar: null },
                { discordId: "4", avatar: null }
            ]
        },
        {
            local: "Duo Gamma",
            visitante: "Duo Delta",
            resultado: "Pendiente",
            ganador: null,
            avatarL: [
                { discordId: "5", avatar: null },
                { discordId: "6", avatar: null }
            ],
            avatarV: [
                { discordId: "7", avatar: null },
                { discordId: "8", avatar: null }
            ]
        }
    ];

    const tema = {
        primario: '#1a1a2e',
        secundario: '#16213e',
        acento: '#e94560',
        texto: '#ffffff',
        borde: '#0f3460',
    };

    try {
        const buffer = await generarFixtureImagen({
            titulo: "Torneo Test Duos",
            subtitulo: "Fase de Grupos - Fecha 1",
            partidos,
            tema
        });
        console.log("Fixture image generated successfully! Buffer length:", buffer.length);
        writeFileSync('scratch/test_fixture.png', buffer);
        console.log("Saved test_fixture.png to scratch directory.");
    } catch (err) {
        console.error("Error generating fixture image:", err);
    }
}

test().catch(console.error);
