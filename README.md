# 🤖 PlatuBOT 2.0

> **Bot avanzado de gestión de torneos, ligas competitivas, validación por IA y generación visual de estadísticas para Discord.**  
> Desarrollado con **JavaScript / Node.js & Bun**, **Discord.js v14**, **MongoDB (Mongoose)**, **Google Gemini AI** y renderizado visual ultrarrápido con **Satori** & **Resvg**.

---

## 📋 Tabla de Contenidos
- [Características Principales](#-características-principales)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Tecnologías y Dependencias](#-tecnologías-y-dependencias)
- [Requisitos Previos](#-requisitos-previos)
- [Instalación y Configuración](#-instalación-y-configuración)
- [Variables de Entorno](#-variables-de-entorno)
- [Comandos de Desarrollo y Operación](#-comandos-de-desarrollo-y-operación)
- [Sistema de Torneos y Ligas](#-sistema-de-torneos-y-ligas)
- [Validación de Resultados con IA (Gemini)](#-validación-de-resultados-con-ia-gemini)
- [Renderizado Visual de Fixtures y Tablas](#-renderizado-visual-de-fixtures-y-tablas)
- [Copias de Seguridad y API de Dashboard](#-copias-de-seguridad-y-api-de-dashboard)

---

## 🚀 Características Principales

1. **Gestión Integral de Ligas & Torneos:**
   - **Primera, Segunda y Tercera División:** Ligas regulares completas con tablas de posiciones, fixtures, ascensos, descensos y desempates.
   - **Superliga:** Formato de equipos con entrenadores (coaches), plantillas de jugadores, economía interna y series al mejor de 3 minipartidos individuales.
   - **Supersupercopa & Coppa:** Torneos con fase de grupos, semifinales ida/vuelta, gran final y partidos de desempate automáticos.
   - **Torneos Dinámicos Personalizables:** Creación dinámica de torneos individuales o por equipos con prefijo propio (ej. `!cdll-fixture`, `!cdll-g`), grupos, brackets y selección de temas visuales.

2. **Validación Automática de Resultados con IA (Google Gemini):**
   - Detección automática de capturas de pantalla de fin de partido en los canales designados.
   - Extracción de marcadores, gamertags y verificación contra los aliases de los jugadores esperados.
   - Menú interactivo con paginación y agrupación por torneo activo en Discord.
   - Aprobación instantánea con alta confianza o canalización a revisión manual para administradores con botones de aprobación, edición y rechazo.

3. **Cálculo de Media / ELO Dinámico:**
   - Algoritmo de actualización de media para jugadores tras cada partido o minipartido resuelto.
   - Historial de enfrentamientos directos (Head-to-Head) y estadísticas acumuladas globales.

4. **Generación Visual de Alta Calidad (Imágenes PNG):**
   - Renderizado dinámico de tablas de posiciones, llaves de eliminación (brackets) y fixtures por fecha.
   - Procesamiento en paralelo mediante piscina de workers (`piscina`), construcción SVG/HTML con `satori` y conversión nativa ultrarrápida con `@resvg/resvg-js`.
   - Sistema de caché inteligente para evitar renderizados redundantes.

5. **Infraestructura de Datos y Respaldos Automatizados:**
   - Base de datos MongoDB con Mongoose (con polyfill para compatibilidad nativa en Bun).
   - Sistema multinivel de copias de seguridad automáticas (`30m`, `1h`, `3h`, `1d`, `1w`).
   - Servidor HTTP interno integrado (`Bun.serve`) para sincronización remota y dashboard administrativo con autenticación Bearer Token.

---

## 📁 Estructura del Proyecto

```plaintext
platubot2/
├── assets/                 # Recursos gráficos (logos, fondos, trofeos, escudos)
├── bin/                    # Binarios locales de mongod/mongosh para desarrollo
├── backups/                # Respaldos generados de la base de datos
├── commands/               # Comandos del bot organizados por módulo
│   ├── copa/               # Torneos genéricos dinámicos y brackets
│   ├── coppa/              # Torneo de copa estilo Coppa
│   ├── info/               # Comandos informativos y de perfil
│   ├── primera/            # Liga Primera División
│   ├── segunda/            # Liga Segunda División
│   ├── superliga/          # Superliga (equipos, duelos 3v3, mercado)
│   └── supersupercopa/     # Supersupercopa y torneos mayores
├── database/               # Conexión MongoDB, polyfill de v8 y Backup Manager
│   ├── backupManager.js    # Tiers de backup y API REST embebida
│   ├── connect.js          # Conexión a MongoDB
│   └── polyfill.js         # Polyfill para compatibilidad Mongoose en Bun
├── events/                 # Eventos de Discord.js
│   ├── client/             # Eventos del ciclo de vida del cliente (ready, etc.)
│   └── server/             # messageCreate (subida de imágenes), interactionCreate
├── handlers/               # Inicializadores de comandos, eventos y subidas
├── models/                 # Esquemas y modelos de datos (Mongoose)
│   ├── copas/              # Modelos de Torneos personalizados y Coppa
│   ├── superliga/          # Modelos de Superliga, Equipos, Supersupercopa
│   └── ...                 # Modelos de Primera, Segunda, Jugador, Historial
├── scripts/                # Scripts de automatización y mantenimiento
│   ├── backup-db.js        # Ejecución manual de backups
│   ├── restore-db.js       # Restauración interactiva de base de datos
│   ├── migrate-to-mongo.js # Migración de estructuras JSON legadas
│   └── setup-local-mongo.js# Descarga e instalación de Mongo local
├── utils/                  # Utilidades y lógica de negocio
│   ├── aiValidator.js      # Integración con Google Gemini para OCR y validación
│   ├── matchFinder.js      # Detección y filtrado de partidos pendientes por usuario
│   ├── submission.js       # Flujo interactivo de selectores y envío de capturas
│   ├── db/                 # Sincronización global, cálculo de media ELO
│   ├── torneos/            # Lógica de administración y cruces de torneos
│   ├── ui/                 # Embeds y componentes interactivos
│   └── visual/             # RenderPool, workers y generadores Satori/Resvg
├── deploy-commands.js      # Registro de Slash Commands en la API de Discord
├── index.js                # Punto de entrada principal del bot
└── package.json            # Dependencias y configuración del proyecto
```

---

## 🛠️ Tecnologías y Dependencias

- **Runtime:** [Bun](https://bun.sh/) (v1.3+ recomendado) o Node.js v20+.
- **Discord API:** [discord.js](https://discord.js.org/) v14.
- **Base de Datos:** [MongoDB](https://www.mongodb.com/) gestionado a través de [Mongoose](https://mongoosejs.com/).
- **Inteligencia Artificial:** [@google/genai](https://www.npmjs.com/package/@google/genai) (Google Gemini Flash Models).
- **Motor Gráfico:**
  - [satori](https://github.com/vercel/satori) (HTML/CSS a SVG).
  - [@resvg/resvg-js](https://github.com/RazrFalcon/resvg) (Conversión de SVG a PNG de alto rendimiento).
  - [piscina](https://github.com/piscinajs/piscina) (Worker thread pool para evitar bloqueos del event loop).
  - [sharp](https://sharp.pixelplumbing.com/) (Manipulación y compresión de imágenes).

---

## ⚙️ Requisitos Previos

- **Bun instalado** (ejecutar `bun --version`).
- **MongoDB** en ejecución local o una URI de conexión a **MongoDB Atlas**.
- **Aplicación en Discord Developer Portal** con intents privilegiados activados:
  - `Server Members Intent`
  - `Message Content Intent`
- **Google Gemini API Key** (de Google AI Studio).

---

## 📥 Instalación y Configuración

1. **Clonar el repositorio:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd platubot2
   ```

2. **Instalar dependencias:**
   ```bash
   bun install
   ```

3. **Configurar MongoDB local (opcional si no tienes Mongo instalado):**
   ```bash
   bun scripts/setup-local-mongo.js
   ```

4. **Configurar las variables de entorno:**
   Crea un archivo `.env` en la raíz del proyecto basándote en la plantilla de abajo.

5. **Desplegar comandos de barra diagonal (Slash Commands):**
   ```bash
   bun deploy-commands.js
   ```

6. **Iniciar el bot:**
   ```bash
   bun index.js
   ```

---

## 🔑 Variables de Entorno (`.env`)

```env
# Discord Configuration
BOT_TOKEN="tu_bot_token_aqui"
PREFIX=">"

# Canales de Resultados y Registro
CANAL_RESULTADOS_PRIMERA="ID_CANAL_PRIMERA"
CANAL_RESULTADOS_SEGUNDA="ID_CANAL_SEGUNDA"
CANAL_RESULTADOS_SUPERLIGA="ID_CANAL_SUPERLIGA"
CANAL_RESULTADOS_COPPA="ID_CANAL_COPPA"
CANAL_APROBACION="ID_CANAL_REVISION_ADMIN"

# Inteligencia Artificial
GEMINI_API_KEY="tu_gemini_api_key_aqui"

# Servidor API de Dashboard y Backups
DASHBOARD_PORT="3001"
DASHBOARD_API_SECRET="tu_clave_secreta_para_api"

# MongoDB (Opcional si usa localhost por defecto)
# MONGO_URI="mongodb://localhost:27017/platubot"
```

---

## 💻 Comandos de Desarrollo y Operación

| Tarea | Comando | Descripción |
| :--- | :--- | :--- |
| **Iniciar Bot** | `bun index.js` | Inicia el cliente de Discord, la conexión a BD y el servidor API embebido. |
| **Desplegar Comandos** | `bun deploy-commands.js` | Registra globalmente los Slash Commands en Discord. |
| **Instalar Mongo Local** | `bun scripts/setup-local-mongo.js` | Descarga e instala `mongod.exe` y `mongosh.exe` en la carpeta `bin/`. |
| **Backup Manual** | `bun scripts/backup-db.js` | Genera una copia inmediata de la base de datos (admite `--tier=1h\|1d\|...`). |
| **Restaurar Backup** | `bun scripts/restore-db.js` | Menú interactivo en terminal para restaurar un respaldo previo. |
| **Migrar Datos JSON** | `bun scripts/migrate-to-mongo.js` | Importa bases de datos heredadas en formato `.json` a MongoDB. |

---

## 🏆 Sistema de Torneos y Ligas

### 1. Prefijos y Dinámica de Torneos
Los torneos creados de manera personalizada poseen un prefijo dinámico configurado por el administrador (ejemplo: `cdll` para Copa de la Liga). Los subcomandos se invocan mediante:
`!<prefijo>-<subcomando>` (ejemplo: `!cdll-tabla`, `!cdll-fixture`, `!cdll-g`).

- **`tabla`**: Muestra la tabla de posiciones generada en imagen.
- **`fixture`**: Visualiza los encuentros por fecha y sus estados.
- **`bracket`**: Visualiza las llaves de eliminación directa.
- **`g` / `gestion`**: Panel administrativo interactivo mediante botones y modales (sorteos, cruces, edición de grupos, carga manual y cambio de fases).
- **`alineacion`**: Permite a los capitanes o coaches cargar las formaciones de sus equipos.

### 2. Series Superliga (3 Mini-Encuentros)
En la Superliga, cada serie entre dos clubes se compone de 3 duelos individuales entre jugadores asignados. El bot contabiliza cada minipartido por separado, modifica las medias de los participantes y calcula el resultado global de la serie al alcanzar 2 victorias.

---

## 🧠 Validación de Resultados con IA (Gemini)

1. **Envío de Capturas:** Un participante sube la captura de pantalla del resultado final al canal de la competición correspondiente.
2. **Selección del Partido:** El bot detecta si el usuario tiene partidos pendientes y despliega un menú interactivo:
   - Agrupación por competición si participa en varias categorías simultáneamente.
   - Paginación automática si se superan los límites de 25 opciones de la API de Discord.
3. **Análisis de Visión Artificial:** Gemini analiza la imagen, verifica que los gamertags correspondan a los contrincantes y extrae el marcador.
4. **Decisión Inteligente:**
   - **Alta Confianza:** Auto-aprobación, registro del partido, actualización de tablas y notificación inmediata.
   - **Confianza Media / Ambigüedad:** Envío de tarjeta de revisión con la imagen y marcador estimado al canal administrativo (`CANAL_APROBACION`).
   - **Baja Confianza / No Coincide:** Rechazo automático solicitando la imagen correcta.

---

## 🎨 Renderizado Visual de Fixtures y Tablas

Para evitar demoras o saturación del bot, las imágenes no se generan con navegadores headless pesados (Puppeteer), sino a través de:
- **`satori`**: Interpreta componentes en formato HTML/SVG con estilos modernos (Flexbox, gradientes, fuentes personalizadas).
- **`@resvg/resvg-js`**: Compila el SVG a PNG de forma nativa en C++.
- **`Piscina Worker Pool`**: Ejecuta las transformaciones en hilos de procesamiento independientes, manteniendo al bot 100% receptivo en Discord.

---

## 🔒 Copias de Seguridad y API de Dashboard

El sistema incluye un servidor HTTP ligero administrado en [`backupManager.js`](file:///c:/Users/luca/Documents/Proyectos/platubot2/database/backupManager.js) corriendo en el puerto `DASHBOARD_PORT`:
- **Respaldos Automatizados:** Rotación programada de snapshots de MongoDB en `backups/` categorizados por niveles de tiempo (`30m`, `1h`, `3h`, `1d`, `1w`).
- **Endpoints Protegidos:** Permite descargar respaldos o sincronizar información mediante solicitudes HTTP con cabecera `Authorization: Bearer <DASHBOARD_API_SECRET>`.

---

## 📄 Licencia y Créditos

Desarrollado para la comunidad competitiva de **PlatuBOT**.  
*Todos los derechos reservados.*

