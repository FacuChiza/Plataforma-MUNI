// ============================================================================
// SERVIDOR GIS MUNICIPAL - VILLA DE MERLO
// ----------------------------------------------------------------------------
// API de consulta catastral. El frontend vive en la carpeta web/.
// Objetivos de este pase:
//   1. Eliminar el anti-patrón de reconexión a SQL Server en cada request.
//   2. Sacar las credenciales del código fuente (variables de entorno).
//   3. Endurecer los endpoints espaciales contra descargas masivas.
//   4. Dejar el servidor "observable" (health check) y con apagado ordenado.
// Las rutas y el formato de respuesta JSON se mantienen IDÉNTICOS al
// original para no romper ningún fetch() del frontend.
// ============================================================================

require('dotenv').config(); // Carga variables desde .env (no versionado en git)

const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const sql = require('mssql');

const app = express();
const PORT = process.env.PORT || 8000;

// ============================================================================
// 1. CONFIGURACIÓN DE SQL SERVER (ahora vía variables de entorno)
// ============================================================================
// IMPORTANTE: crear un archivo .env (ver .env.example) con estos valores
// y agregar .env al .gitignore. Nunca commitear credenciales reales.
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    requestTimeout: 120000,
    options: {
        // TODO (roadmap seguridad): habilitar cifrado en tránsito cuando el
        // SQL Server municipal soporte TLS. Hoy se mantiene igual al original
        // para no romper la conexión existente en producción.
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
    },
    pool: {
        max: 20,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Límite duro de filas devueltas por los endpoints de listado (superficie,
// edificación). Protege contra scraping/descarga masiva del padrón completo
// vía un rango absurdamente amplio. Configurable por entorno.
const MAX_ROWS = parseInt(process.env.MAX_ROWS, 10) || 5000;

// ============================================================================
// MODO DE DATOS DE PRUEBA
// ----------------------------------------------------------------------------
// La base municipal solo es alcanzable desde la red de la Municipalidad. Fuera
// de ahí, /api/catastro devuelve 503 y la ficha sale con todos los campos
// vacíos, así que no se puede revisar el diseño ni probar los casos con varios
// titulares.
//
// Con MODO_DEMO=true, y SOLO cuando no hay base disponible, el endpoint
// responde con parcelas inventadas. Los nombres son deliberadamente falsos
// ("PRUEBA", "DEMO") para que nadie los confunda con datos reales, y la
// respuesta incluye la marca _DEMO para que el frontend lo pueda avisar en
// pantalla.
//
// Nunca se activa en producción: si hay conexión a SQL Server, este modo se
// ignora por completo.
// ============================================================================
const MODO_DEMO = process.env.MODO_DEMO === 'true';

function fichaDePrueba(padron, nomenclatura) {
    // Un titular, dos titulares y muchos: los tres casos que hay que poder
    // revisar. Según el último dígito del padrón se devuelve uno u otro.
    const digito = parseInt(String(padron).replace(/\D/g, '').slice(-1), 10) || 0;
    const cuantos = digito < 4 ? 1 : (digito < 7 ? 3 : 12);

    const apellidos = ['GONZALEZ PRUEBA', 'RODRIGUEZ DEMO', 'FERNANDEZ PRUEBA', 'LOPEZ DEMO',
                       'MARTINEZ PRUEBA', 'GOMEZ DEMO', 'DIAZ PRUEBA', 'PEREZ DEMO',
                       'SANCHEZ PRUEBA', 'ROMERO DEMO', 'ALVAREZ PRUEBA', 'TORRES DEMO'];
    const nombres = ['MARIA LUCIA', 'JUAN CARLOS', 'ANA BEATRIZ', 'JOSE LUIS', 'ROSA ELENA',
                     'CARLOS ALBERTO', 'SILVIA NOEMI', 'JORGE OMAR', 'LAURA INES',
                     'RICARDO DANIEL', 'MONICA SUSANA', 'PABLO ANDRES'];

    const titulares = [];
    for (let i = 0; i < cuantos; i++) {
        titulares.push({
            APELLIDO: apellidos[i % apellidos.length],
            NOMBRE: nombres[i % nombres.length],
            TIPO_DOCUMENTO: 'DNI',
            DOCUMENTO: String(10000000 + (i * 1234567) % 40000000),
            CALLE: 'CALLE DE PRUEBA',
            NUMERACION: String(100 + i * 7),
            PISO: cuantos > 6 ? String((i % 4) + 1) : '',
            DEPARTAMENTO: cuantos > 6 ? 'ABCD'[i % 4] : '',
            BARRIO: 'BARRIO DEMO',
            CODIGO_POS: '5881',
            LOCALIDAD: 'VILLA DE MERLO',
            PROVINCIA: 'SAN LUIS'
        });
    }

    const principal = titulares[0];

    return {
        _DEMO: true,
        ...principal,
        NOMENCLA: nomenclatura || '0000000000000000000000',
        NRO_RENTA: padron,
        ACTIVO: '1',
        CALLE1: 'AV. DEL SOL (DEMO)',
        NRO: '1234',
        BARRIO1: 'CENTRO DEMO',
        ESQ_MED: 'MEDIAL',
        SUP_TER: 456.78,
        MET_FRENTE: 12.5,
        DESIG_OFI: 'LOTE 7 MANZANA B (DATO DE PRUEBA)',
        BAL_EDIF: 'EDIFICADO',
        CUENTA: '900' + String(padron).replace(/\D/g, '').slice(-5),
        CONCEPTO: 'RESIDENCIAL R2',
        ZONIFICACION: 'RESIDENCIAL R2',
        UNIDADES_LOCATIVAS: cuantos > 6 ? cuantos : 1,
        PORCENTAJE_COPROPIEDAD: cuantos > 6 ? Number((100 / cuantos).toFixed(2)) : null,
        TITULARES: titulares,
        CANTIDAD_TITULARES: titulares.length
    };
}

// ============================================================================
// 2. POOL DE CONEXIÓN ÚNICO (fix del anti-patrón original)
// ----------------------------------------------------------------------------
// Antes: cada endpoint llamaba `await sql.connect(dbConfig)` en cada request.
// Ahora: se crea UN SOLO pool al arrancar el servidor y se reutiliza en todas
// las queries. Esto reduce latencia (no hay handshake por request) y permite
// centralizar el manejo de errores de conexión.
// ============================================================================
let pool = null;

/**
 * Avisa si falta configuración antes de intentar conectar.
 *
 * Sin esto, un .env incompleto produce un error de driver críptico
 * ("Login failed", "getaddrinfo ENOTFOUND undefined") que hace perder tiempo
 * buscando el problema en la red o en el SQL Server, cuando en realidad falta
 * una línea en un archivo. El servidor arranca igual en modo degradado.
 */
function revisarConfiguracion() {
    const requeridas = ['DB_USER', 'DB_PASSWORD', 'DB_SERVER', 'DB_DATABASE'];
    const faltantes = requeridas.filter((v) => !process.env[v]);

    if (faltantes.length > 0) {
        console.warn('⚠️  Faltan variables de entorno:', faltantes.join(', '));
        console.warn('    Copiar .env.example como .env y completarlo.');
        console.warn('    El visor va a arrancar sin datos de la base municipal.');
        return false;
    }
    return true;
}

async function initDb() {
    if (!revisarConfiguracion()) {
        pool = null;
        return;
    }

    try {
        pool = new sql.ConnectionPool(dbConfig);

        // Si el pool pierde la conexión en caliente (ej: reinicio del SQL
        // Server), lo logueamos en vez de dejar que tumbe el proceso Node.
        pool.on('error', (err) => {
            console.error('❌ Error en el pool de conexión SQL Server:', err.message);
        });

        await pool.connect();
        console.log('✅ Conectado a SQL Server (pool inicializado).');
    } catch (err) {
        // Decisión de diseño: si SQL Server no está disponible al arrancar,
        // el visor NO se cae por completo. Los planos GeoJSON estáticos
        // (Merlo2026Parcelas-V1.json, etc.) siguen sirviéndose igual, porque
        // viven en el filesystem, no en la base de datos. Solo las consultas
        // que dependen de SQL (ficha de parcela, filtros) devolverán 503.
        console.error('⚠️  No se pudo conectar a SQL Server al iniciar:', err.message);
        console.error('    El servidor seguirá funcionando en modo degradado (sin datos de SQL).');
        pool = null;
    }
}

// Helper usado por cada endpoint: devuelve el pool si está disponible,
// o null si la base de datos no está accesible en este momento.
function getPool() {
    if (pool && pool.connected) return pool;
    return null;
}

// ============================================================================
// 3. MIDDLEWARES GLOBALES
// ============================================================================
app.use(compression());

// helmet agrega cabeceras de seguridad estándar (X-Content-Type-Options,
// X-Frame-Options, HSTS, etc.).
//
// NOTA sobre CSP: sigue desactivado, pero por un motivo distinto al original.
// La lógica ya NO es un <script> inline (vive en app.js), así que ese
// impedimento desapareció. Lo que queda bloqueando un CSP estricto es
// cdn.tailwindcss.com: el build de desarrollo de Tailwind genera CSS en
// tiempo de ejecución e inyecta estilos inline, cosa que un CSP razonable
// prohíbe.
//
// ROADMAP: compilar Tailwind a un .css estático (deja de hacer falta el CDN,
// y de paso la app carga más rápido y funciona sin internet). Recién ahí se
// puede activar un CSP estricto sin romper nada.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// El frontend vive en la carpeta hermana web/. Está separado del servidor a
// propósito: así se puede desplegar por su cuenta (por ejemplo en Vercel)
// apuntando a esta API, sin arrastrar el backend.
const DIR_WEB = path.join(__dirname, '..', 'web');

app.use(express.static(DIR_WEB, {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.json')) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
            // El código de la app (app.js, app.css, index.html) se revalida
            // SIEMPRE contra el servidor.
            //
            // Por qué: con maxAge de 1 día, un municipal que ya abrió el visor
            // seguiría usando la versión vieja del código hasta 24 h después de
            // un deploy, sin forma de saberlo. Con 'no-cache' el navegador
            // pregunta si cambió y, si no cambió, el servidor responde 304 sin
            // reenviar el archivo: se conserva casi todo el ahorro de tráfico y
            // desaparece el riesgo de quedar con código viejo.
            //
            // Los GeoJSON no entran acá: son grandes, cambian una vez por mes y
            // el frontend ya les pone su propio anti-caché por querystring.
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Rate limiting SOLO sobre los endpoints de API (no sobre los estáticos:
// el mapa carga varios GeoJSON pesados en cada visita y no queremos
// limitar eso). Esto es lo que efectivamente protege contra descargas
// masivas o abuso automatizado de las consultas a SQL Server.
const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000, // 1 minuto
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100, // 100 requests/min/IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Intente nuevamente en unos instantes.' }
});
app.use('/api/', apiLimiter);

// ============================================================================
// 4. ENDPOINT: Health check (nuevo)
// ----------------------------------------------------------------------------
// Permite monitorear el servidor (uptime checks, balanceadores, etc.) sin
// necesidad de golpear SQL Server. Informa si la DB está o no disponible.
// ============================================================================
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        database: getPool() ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// ======================================================================
// 5. ENDPOINT: Consulta de Rangos de Superficie (m²)
// ======================================================================
app.get('/api/superficie', async (req, res) => {
    const activePool = getPool();
    if (!activePool) {
        return res.status(503).json({ error: 'Base de datos municipal no disponible en este momento.' });
    }

    let { min, max } = req.query;

    let superficieMinima = parseFloat(min) || 0;
    let superficieMaxima = parseFloat(max) || 999999999;

    // Validación defensiva: si el usuario invierte el rango (min > max),
    // lo corregimos en vez de devolver un resultado vacío confuso.
    if (superficieMinima > superficieMaxima) {
        [superficieMinima, superficieMaxima] = [superficieMaxima, superficieMinima];
    }

    try {
        const request = activePool.request();

        request.input('min', sql.Float, superficieMinima);
        request.input('max', sql.Float, superficieMaxima);
        request.input('maxRows', sql.Int, MAX_ROWS);

        // Se agrega TOP (@maxRows) como cota de seguridad. No cambia el
        // formato de la respuesta (sigue siendo un array de filas), solo
        // limita el volumen máximo devuelto en un único request.
        const queryResult = await request.query(`
            SELECT DISTINCT TOP (@maxRows)
                LTRIM(RTRIM(NRO_RENTA)) AS PADRON,
                LTRIM(RTRIM(NOMENCLA)) AS NOMENCLA,
                SUP_TER
            FROM PROGRAM.dbo.VI_GIS_CATASTRO_PADRON
            WHERE TRY_CAST(SUP_TER AS FLOAT) >= @min
              AND TRY_CAST(SUP_TER AS FLOAT) <= @max
              AND SUP_TER IS NOT NULL
              AND ACTIVO = 1
        `);

        res.json(queryResult.recordset);
    } catch (err) {
        console.error('❌ Error en consulta de superficie SQL:', err);
        res.status(500).json({ error: 'Error al consultar superficies en la vista municipal.' });
    }
});

// ======================================================================
// 6. ENDPOINT: Consulta por Estado de Edificación
// ======================================================================
app.get('/api/edificacion', async (req, res) => {
    const activePool = getPool();
    if (!activePool) {
        return res.status(503).json({ error: 'Base de datos municipal no disponible en este momento.' });
    }

    let { tipo } = req.query;

    if (!tipo) {
        return res.status(400).json({ error: 'El parámetro tipo es requerido.' });
    }

    // Saneamos el parámetro: cota de longitud para evitar abusos con
    // strings enormes en el LIKE (no afecta el uso normal EDIFICADO/BALDIO).
    tipo = String(tipo).trim().slice(0, 100);

    try {
        const request = activePool.request();

        request.input('tipo', sql.VarChar, tipo);
        request.input('maxRows', sql.Int, MAX_ROWS);

        const queryResult = await request.query(`
            SELECT DISTINCT TOP (@maxRows)
                LTRIM(RTRIM(NRO_RENTA)) AS PADRON,
                LTRIM(RTRIM(NOMENCLA)) AS NOMENCLA,
                BAL_EDIF
            FROM PROGRAM.dbo.VI_GIS_CATASTRO_PADRON
            WHERE UPPER(LTRIM(RTRIM(BAL_EDIF))) LIKE '%' + UPPER(@tipo) + '%' AND ACTIVO = 1
        `);

        res.json(queryResult.recordset);
    } catch (err) {
        console.error('❌ Error en consulta de edificación SQL:', err);
        res.status(500).json({ error: 'Error al consultar estado de edificación.' });
    }
});

// ====================================================
// 7. ENDPOINT: Consulta de Catastro en Vivo (ficha de parcela)
// ====================================================
app.get('/api/catastro', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    let { padron, nomenclatura } = req.query;

    padron = String(padron || '').trim();
    nomenclatura = String(nomenclatura || '').trim();

    const activePool = getPool();
    if (!activePool) {
        // Sin base: datos de prueba si se pidió expresamente, y si no el 503
        // de siempre. Ver el comentario de MODO_DEMO más arriba.
        if (MODO_DEMO && padron) {
            return res.json(fichaDePrueba(padron, nomenclatura));
        }
        return res.status(503).json({ error: 'Base de datos municipal no disponible en este momento.' });
    }

    if (!padron) {
        return res.status(400).json({ error: 'El padrón (NRO_RENTA) es requerido.' });
    }

    try {
        // ------------------------------------------------------------------
        // Las 4 consultas se disparan en paralelo. Antes compartían UN SOLO
        // objeto Request, y eso es un error latente: en node-mssql un Request
        // representa una operación sobre la conexión y no admite varias
        // queries simultáneas. Que hoy funcione no lo hace correcto; bajo
        // concurrencia puede fallar con "Can't acquire connection for the
        // request" o mezclar resultados entre consultas, que es peor porque no
        // se nota: la ficha saldría con datos de otra parcela sin ningún error.
        //
        // Cada consulta lleva ahora su propio Request con sus propios
        // parámetros. Sigue siendo paralelo (el pool tiene hasta 20
        // conexiones), pero cada una es independiente.
        // ------------------------------------------------------------------
        const conPadron = () => activePool.request().input('padron', sql.VarChar, padron);

        const qFrentes = conPadron().query(`SELECT CONCEPTO, CONCEPTO AS ZONIFICACION FROM PROGRAM.dbo.VI_CPAR_FRENTES WHERE LTRIM(RTRIM(NRO_RENTAS)) = @padron`);
        // --------------------------------------------------------------------
        // TITULARES: se traen TODOS, no solo el primero.
        //
        // Medido sobre la base real: 4.645 parcelas tienen más de un titular
        // (condominios, sucesiones, propiedad horizontal), y una llega a 29.
        // Es el 23,5% de las parcelas con titular. Antes esta consulta traía
        // todas las filas pero más abajo se usaba únicamente recordset[0], así
        // que la ficha mostraba un solo nombre y descartaba el resto sin avisar.
        //
        // Se agregan documento y datos de unidad (piso/depto), que son los que
        // permiten distinguir entre homónimos y ubicar la unidad funcional.
        //
        // El ORDER BY no es cosmético: sin él SQL Server no garantiza ningún
        // orden, así que la misma parcela podría listar sus titulares en
        // distinto orden en dos consultas seguidas. El proyecto exige
        // determinismo: misma entrada, misma salida.
        // --------------------------------------------------------------------
        const qPropiet = activePool.request()
            .input('nomenclatura', sql.VarChar, nomenclatura)
            .query(`
                SELECT
                    APELLIDO,
                    NOMBRE,
                    TIPO_DOCUMENTO,
                    DOCUMENTO,
                    CALLE,
                    NUMERACION_CALLE AS NUMERACION,
                    PISO,
                    DEPARTAMENTO,
                    BARRIO,
                    CODIGO_POSTAL_REAL AS CODIGO_POS,
                    LOCALIDAD,
                    PROVINCIA
                FROM PROGRAM.dbo.VI_CPAR_PROPIETARIOS
                WHERE LTRIM(RTRIM(NOMENCLATURA)) = @nomenclatura
                ORDER BY APELLIDO, NOMBRE, DOCUMENTO
            `);
        // PORCENTAJE_COPROPIEDAD y UNIDADES_LOCATIVAS existían en la vista y no
        // se estaban usando. Son los datos que describen una propiedad
        // horizontal, y el visor ya maneja subparcelas.
        const qPadron  = conPadron().query(`SELECT NOMENCLA, ACTIVO, NRO_RENTA, CALLE AS CALLE1, NRO, BARRIO AS BARRIO1, ESQ_MED, SUP_TER, DESIG_OFI, BAL_EDIF, MET_FRENTE, UNIDADES_LOCATIVAS, PORCENTAJE_COPROPIEDAD FROM PROGRAM.dbo.VI_GIS_CATASTRO_PADRON WHERE LTRIM(RTRIM(NRO_RENTA)) = @padron`);
        const qDeuda   = conPadron().query(`SELECT CUENTA FROM PROGRAM.dbo.VI_GIS_DEUDA WHERE LTRIM(RTRIM(NRO_RENTA)) = @padron AND LTRIM(RTRIM(TBIEN)) = 'ININ'`);

        const [resFrentes, resProp, resPadron, resDeuda] = await Promise.all([qFrentes, qPropiet, qPadron, qDeuda]);

        const rawData = {
            ...((resFrentes.recordset && resFrentes.recordset[0]) || {}),
            ...((resProp.recordset && resProp.recordset[0]) || {}),
            ...((resPadron.recordset && resPadron.recordset[0]) || {}),
            ...((resDeuda.recordset && resDeuda.recordset[0]) || {})
        };

        const consolidado = {};
        for (let key in rawData) consolidado[key.toUpperCase()] = rawData[key];

        // --------------------------------------------------------------------
        // Lista completa de titulares.
        //
        // Se AGREGA como campo nuevo en vez de reemplazar los campos planos
        // (APELLIDO, NOMBRE, ...) que ya venían. Así cualquier parte del
        // frontend que todavía lea el titular "principal" sigue funcionando
        // igual, y la ficha nueva usa el array. Es un cambio aditivo: no rompe
        // el contrato de la API que ya existía.
        // --------------------------------------------------------------------
        consolidado.TITULARES = (resProp.recordset || []).map((t) => {
            const fila = {};
            for (const clave in t) fila[clave.toUpperCase()] = t[clave];
            return fila;
        });
        consolidado.CANTIDAD_TITULARES = consolidado.TITULARES.length;

        res.json(consolidado);

    } catch (err) {
        console.error('Error en consulta SQL Server:', err);
        res.status(500).json({ error: 'Error interno de comunicación con la base de datos municipal.' });
    }
});

// ============================================================================
// Ruta raíz: sirve el visor.
// ----------------------------------------------------------------------------
// Dos detalles que importan y que no se ven a simple vista:
//
// 1. Cache-Control explícito. Esta ruta NO pasa por el middleware de estáticos,
//    así que no hereda su política de caché. Sin esta línea el navegador se
//    queda con una copia vieja del HTML y sigue pidiendo la versión anterior de
//    app.js aunque el servidor ya tenga la nueva: un deploy no llegaría a los
//    municipales hasta que vaciaran el caché a mano.
//
// 2. El archivo se llama 'index.html', todo en minúsculas, igual que en el
//    disco. Windows no distingue mayúsculas, pero un servidor Linux sí, y una
//    diferencia de mayúscula ahí devuelve un error de archivo inexistente.
// ============================================================================
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIR_WEB, 'index.html'));
});

// ============================================================================
// 8. MANEJO DE ERRORES NO CAPTURADOS Y RUTAS INEXISTENTES
// ============================================================================
app.use((req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado.' });
});

// Middleware de error genérico (red de seguridad final). Nunca debería
// dispararse si cada endpoint maneja su propio try/catch, pero evita que
// una excepción no controlada tumbe el proceso.
app.use((err, req, res, next) => {
    console.error('❌ Error no controlado:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
});

// ============================================================================
// 9. ARRANQUE Y APAGADO ORDENADO
// ============================================================================
async function start() {
    await initDb(); // Intenta conectar a SQL Server (no bloquea el arranque si falla)

    app.listen(PORT, () => {
        console.log(`
    ====================================================
    VISOR SIG MUNICIPAL - VILLA DE MERLO
    Servidor Profesional Iniciado de manera Correcta
    ====================================================
    > Local:    http://localhost:${PORT}
    > DB:       ${getPool() ? 'conectada' : 'NO conectada (modo degradado)'}
    ====================================================
    `);
    });
}

// Cierre ordenado del pool de SQL Server al detener el proceso (Ctrl+C,
// reinicio por PM2/systemd, etc.). Evita conexiones "colgadas" en el SQL
// Server municipal.
async function shutdown(signal) {
    console.log(`\n🛑 Señal ${signal} recibida. Cerrando servidor...`);
    try {
        if (pool) await pool.close();
        console.log('✅ Pool de SQL Server cerrado correctamente.');
    } catch (err) {
        console.error('⚠️  Error cerrando el pool de SQL Server:', err.message);
    } finally {
        process.exit(0);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();