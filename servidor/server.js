// ============================================================================
// SERVIDOR GIS MUNICIPAL - VILLA DE MERLO
// ----------------------------------------------------------------------------
// API de consulta catastral. El frontend vive en la carpeta web/.
//
// LA REGLA QUE ORDENA TODO
//   La geometría sale de los archivos GeoJSON. Todo lo demás sale de la base.
//
//   El GeoJSON de parcelas trae por polígono únicamente la forma, el
//   NRO_RENTA y la NOMENCLA. Ni superficie, ni titular, ni zonificación, ni
//   estado de edificación: eso vive en la base municipal y se consulta acá, en
//   vivo. Por eso el mapa se ve aunque no haya conexión, y las fichas no.
//
//   Consecuencia práctica: los filtros por superficie, frente, estado, zona y
//   barrio dependen ENTERAMENTE de esta API. El visor no puede calcular
//   ninguno de esos valores por su cuenta.
//
// SIN CONEXIÓN
//   Cada endpoint decide solo: si hay pool, consulta la base; si no lo hay y
//   MODO_DEMO está activo, responde con datos inventados y lo avisa con la
//   cabecera X-Datos-De-Prueba. No hay que tocar código para pasar de un modo
//   al otro: en cuanto el servidor pueda conectarse, usa la base.
//
//   Ver docs/conexion-con-la-base.md para el detalle de qué campo sale de qué
//   vista y qué falta confirmar contra la base real.
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

/**
 * Padrones reales tomados del GeoJSON, para el modo de prueba.
 *
 * Los filtros no sirven de nada si devuelven padrones inventados: el mapa no
 * los encontraría y no se pintaría ninguna parcela. Así que en modo de prueba
 * se leen los padrones que EXISTEN en el archivo de parcelas y se les inventan
 * los atributos (superficie, frente, zonificación). El resultado se puede
 * pintar en el mapa igual que uno real, que es lo que hace útil la prueba.
 *
 * Se lee una sola vez y solo si hace falta.
 */
let padronesDePrueba = null;

function cargarPadronesDePrueba() {
    if (padronesDePrueba !== null) return padronesDePrueba;

    try {
        const fs = require('fs');
        const ruta = path.join(__dirname, '..', 'web', 'datos', 'Merlo2026Parcelas-V1.json');
        const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));

        padronesDePrueba = datos.features
            .map((f) => ({
                PADRON: String((f.properties || {}).NRO_RENTA || '').trim(),
                NOMENCLA: String((f.properties || {}).NOMENCLA || '').trim()
            }))
            .filter((p) => p.PADRON);

        console.log(`🧪 Modo de prueba: ${padronesDePrueba.length} padrones cargados del GeoJSON.`);
    } catch (err) {
        console.warn('⚠️  Modo de prueba: no se pudo leer el archivo de parcelas:', err.message);
        padronesDePrueba = [];
    }
    return padronesDePrueba;
}

/**
 * Atributos ficticios pero DETERMINÍSTICOS: el mismo padrón devuelve siempre
 * los mismos valores. Si fueran aleatorios, cada consulta daría un resultado
 * distinto y no se podría probar nada.
 */
function atributosDePrueba(padron) {
    const n = parseInt(String(padron).replace(/\D/g, '').slice(-6), 10) || 0;
    const zonas = ['RESIDENCIAL R1', 'RESIDENCIAL R2', 'COMERCIAL C1', 'INDUSTRIAL', 'RURAL'];
    const barrios = ['CENTRO DEMO', 'BARRIO DEMO', 'BALNEARIO DEMO', 'RINCON DEMO'];

    return {
        SUP_TER: 200 + (n % 1800),          // entre 200 y 2000 m²
        MET_FRENTE: 8 + (n % 22),           // entre 8 y 30 m
        BAL_EDIF: (n % 3 === 0) ? 'BALDIO' : 'EDIFICADO',
        ZONIFICACION: zonas[n % zonas.length],
        BARRIO: barrios[n % barrios.length]
    };
}

/** Aplica los criterios sobre los datos de prueba, igual que lo haría el SQL. */
function filtrarDePrueba(criterios) {
    const contiene = (valor, buscado) =>
        !buscado || String(valor || '').toUpperCase().includes(String(buscado).toUpperCase());

    const vistos = new Set();

    return cargarPadronesDePrueba()
        .filter((p) => {
            // Equivale al SELECT DISTINCT de la consulta real: el archivo de
            // parcelas tiene padrones repetidos y sin esto saldrían duplicados.
            if (vistos.has(p.PADRON)) return false;
            vistos.add(p.PADRON);
            return true;
        })
        .map((p) => ({ ...p, ...atributosDePrueba(p.PADRON) }))
        .filter((p) => {
            if (!isNaN(criterios.supMin) && p.SUP_TER < criterios.supMin) return false;
            if (!isNaN(criterios.supMax) && p.SUP_TER > criterios.supMax) return false;
            if (!isNaN(criterios.frenteMin) && p.MET_FRENTE < criterios.frenteMin) return false;
            if (!isNaN(criterios.frenteMax) && p.MET_FRENTE > criterios.frenteMax) return false;
            if (!contiene(p.BAL_EDIF, criterios.edificacion)) return false;
            if (!contiene(p.ZONIFICACION, criterios.zonificacion)) return false;
            if (!contiene(p.BARRIO, criterios.barrio)) return false;
            return true;
        })
        .slice(0, MAX_ROWS);
}

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

// La cabecera X-Datos-De-Prueba tiene que poder leerse desde el navegador aun
// cuando el frontend esté publicado en otro dominio (por ejemplo en Vercel,
// con la API corriendo dentro de la Municipalidad). Sin exponerla, el visor no
// puede avisar que los datos no son reales.
app.use((req, res, next) => {
    res.setHeader('Access-Control-Expose-Headers', 'X-Datos-De-Prueba');
    next();
});

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
            res.setHeader('X-Datos-De-Prueba', 'true');
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
// ENDPOINT: BÚSQUEDA COMBINADA DE PARCELAS
// ----------------------------------------------------------------------------
// Antes había un endpoint por criterio: /api/superficie y /api/edificacion.
// Servían para una sola condición por vez, así que no se podía pedir algo tan
// común como "baldíos de más de 500 m² en el barrio Centro": había que filtrar
// por uno, exportar, y cruzar a mano.
//
// Este endpoint acepta todos los criterios juntos y los combina con AND. Los
// que no llegan, no filtran, así que sirve igual para una condición o para
// cinco.
//
// Los dos endpoints anteriores siguen funcionando: hay pantallas que todavía
// los usan y no se rompen por esto.
// ============================================================================
app.get('/api/filtrar', async (req, res) => {
    const activePool = getPool();

    // Criterios recibidos. Todos opcionales.
    const criterios = {
        supMin: parseFloat(req.query.supMin),
        supMax: parseFloat(req.query.supMax),
        frenteMin: parseFloat(req.query.frenteMin),
        frenteMax: parseFloat(req.query.frenteMax),
        edificacion: String(req.query.edificacion || '').trim().slice(0, 60),
        zonificacion: String(req.query.zonificacion || '').trim().slice(0, 80),
        barrio: String(req.query.barrio || '').trim().slice(0, 80)
    };

    if (!activePool) {
        if (MODO_DEMO) {
            // Estos endpoints devuelven un ARRAY, así que no se les puede
            // agregar un campo _DEMO adentro sin cambiarles el formato. La
            // marca va por cabecera, y el visor la lee para avisar en pantalla.
            // Sin este aviso, una búsqueda sin conexión devuelve superficies
            // inventadas con la misma cara que las reales.
            res.setHeader('X-Datos-De-Prueba', 'true');
            return res.json(filtrarDePrueba(criterios));
        }
        return res.status(503).json({ error: 'Base de datos municipal no disponible en este momento.' });
    }

    try {
        const request = activePool.request();
        const condiciones = ['p.ACTIVO = 1'];

        // Cada criterio agrega su condición Y su parámetro. Los valores nunca
        // se concatenan al SQL: van siempre como parámetros, así que no hay
        // forma de inyectar nada desde la query string.
        if (!isNaN(criterios.supMin)) {
            request.input('supMin', sql.Float, criterios.supMin);
            condiciones.push('TRY_CAST(p.SUP_TER AS FLOAT) >= @supMin');
        }
        if (!isNaN(criterios.supMax)) {
            request.input('supMax', sql.Float, criterios.supMax);
            condiciones.push('TRY_CAST(p.SUP_TER AS FLOAT) <= @supMax');
        }
        if (!isNaN(criterios.frenteMin)) {
            request.input('frenteMin', sql.Float, criterios.frenteMin);
            condiciones.push('TRY_CAST(p.MET_FRENTE AS FLOAT) >= @frenteMin');
        }
        if (!isNaN(criterios.frenteMax)) {
            request.input('frenteMax', sql.Float, criterios.frenteMax);
            condiciones.push('TRY_CAST(p.MET_FRENTE AS FLOAT) <= @frenteMax');
        }
        if (criterios.edificacion) {
            request.input('edificacion', sql.VarChar, criterios.edificacion);
            condiciones.push("UPPER(LTRIM(RTRIM(p.BAL_EDIF))) LIKE '%' + UPPER(@edificacion) + '%'");
        }
        if (criterios.barrio) {
            request.input('barrio', sql.VarChar, criterios.barrio);
            condiciones.push("UPPER(LTRIM(RTRIM(p.BARRIO))) LIKE '%' + UPPER(@barrio) + '%'");
        }
        if (criterios.zonificacion) {
            request.input('zonificacion', sql.VarChar, criterios.zonificacion);
            condiciones.push("UPPER(LTRIM(RTRIM(f.CONCEPTO))) LIKE '%' + UPPER(@zonificacion) + '%'");
        }

        request.input('maxRows', sql.Int, MAX_ROWS);

        // La zonificación vive en otra vista. Se trae con OUTER APPLY TOP 1 en
        // lugar de un LEFT JOIN: una parcela puede tener varios frentes, y con
        // JOIN aparecería repetida una vez por cada uno.
        // ACÁ es donde la superficie, el frente, el estado y el barrio salen
        // de la base. Mientras no haya conexión los devuelve filtrarDePrueba()
        // con valores inventados; esta consulta es la definitiva y no hay que
        // cambiarla cuando la conexión exista.
        const consulta = `
            SELECT DISTINCT TOP (@maxRows)
                LTRIM(RTRIM(p.NRO_RENTA)) AS PADRON,
                LTRIM(RTRIM(p.NOMENCLA))  AS NOMENCLA,
                p.SUP_TER,
                p.MET_FRENTE,
                LTRIM(RTRIM(p.BAL_EDIF))  AS BAL_EDIF,
                LTRIM(RTRIM(p.BARRIO))    AS BARRIO,
                LTRIM(RTRIM(f.CONCEPTO))  AS ZONIFICACION
            FROM PROGRAM.dbo.VI_GIS_CATASTRO_PADRON p
            OUTER APPLY (
                SELECT TOP 1 CONCEPTO
                FROM PROGRAM.dbo.VI_CPAR_FRENTES
                WHERE LTRIM(RTRIM(NRO_RENTAS)) = LTRIM(RTRIM(p.NRO_RENTA))
            ) f
            WHERE ${condiciones.join(' AND ')}
            ORDER BY LTRIM(RTRIM(p.NRO_RENTA))
        `;

        const resultado = await request.query(consulta);
        res.json(resultado.recordset);

    } catch (err) {
        console.error('❌ Error en la búsqueda combinada:', err);
        res.status(500).json({ error: 'Error al consultar la base municipal.' });
    }
});

// ============================================================================
// ENDPOINT: VALORES DISPONIBLES PARA LOS FILTROS
// ----------------------------------------------------------------------------
// Devuelve las zonificaciones y los barrios que existen realmente en la base,
// para poder ofrecerlos en una lista en vez de que el operador tenga que
// adivinar cómo se escriben. Se consulta una sola vez al abrir el visor.
// ============================================================================
app.get('/api/opciones', async (req, res) => {
    const activePool = getPool();

    if (!activePool) {
        if (MODO_DEMO) {
            res.setHeader('X-Datos-De-Prueba', 'true');
            return res.json({
                _DEMO: true,
                zonificaciones: ['RESIDENCIAL R1', 'RESIDENCIAL R2', 'COMERCIAL C1', 'INDUSTRIAL', 'RURAL'],
                barrios: ['CENTRO DEMO', 'BARRIO DEMO', 'BALNEARIO DEMO', 'RINCON DEMO']
            });
        }
        return res.status(503).json({ error: 'Base de datos municipal no disponible en este momento.' });
    }

    try {
        const [zonas, barrios] = await Promise.all([
            activePool.request().query(`
                SELECT DISTINCT LTRIM(RTRIM(CONCEPTO)) AS valor
                FROM PROGRAM.dbo.VI_CPAR_FRENTES
                WHERE CONCEPTO IS NOT NULL AND LTRIM(RTRIM(CONCEPTO)) <> ''
                ORDER BY valor
            `),
            activePool.request().query(`
                SELECT DISTINCT LTRIM(RTRIM(BARRIO)) AS valor
                FROM PROGRAM.dbo.VI_GIS_CATASTRO_PADRON
                WHERE BARRIO IS NOT NULL AND LTRIM(RTRIM(BARRIO)) <> '' AND ACTIVO = 1
                ORDER BY valor
            `)
        ]);

        res.json({
            zonificaciones: zonas.recordset.map((r) => r.valor),
            barrios: barrios.recordset.map((r) => r.valor)
        });
    } catch (err) {
        console.error('❌ Error al leer las opciones de filtro:', err);
        res.status(500).json({ error: 'Error al consultar la base municipal.' });
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