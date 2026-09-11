#!/usr/bin/env node
/**
 * ============================================================================
 * REVISAR UN ARCHIVO DE PLANO ANTES DE PONERLO EN EL VISOR
 * ----------------------------------------------------------------------------
 * PARA QUE SIRVE
 *   El plano de Merlo crece: cada tanto Catastro entrega una version nueva con
 *   las parcelas que se fueron incorporando. Este script revisa ese archivo
 *   ANTES de reemplazar el que esta en uso, y avisa de los problemas que, si
 *   pasan desapercibidos, aparecen despues como fallas raras del visor:
 *
 *     - Poligonos sin padron      -> la parcela se dibuja pero no se puede
 *                                    consultar ni pintar. Al hacerle clic no
 *                                    trae nada y parece un error del programa.
 *     - Padrones mal escritos     -> lo mismo, pero peor: parecen correctos.
 *     - Padrones repetidos        -> dos poligonos distintos con el mismo
 *                                    numero. Se pintan los dos y uno esta mal.
 *     - Coordenadas fuera de Merlo-> el archivo se exporto en el sistema de
 *                                    coordenadas equivocado. El plano aparece
 *                                    en medio del oceano o no aparece.
 *     - Geometrias rotas          -> Leaflet las saltea sin avisar.
 *
 *   Y, si la computadora llega a la base municipal, tambien compara contra
 *   ella: dice que padrones existen en la base pero NO tienen poligono
 *   dibujado. Esas son las parcelas que despues "no se pintan" cuando alguien
 *   filtra, y que hay que mandar a dibujar.
 *
 * USO
 *   node herramientas/revisar-plano.js
 *       Revisa el plano que el visor esta usando hoy.
 *
 *   node herramientas/revisar-plano.js "C:\\ruta\\PlanoNuevo.json"
 *       Revisa un archivo cualquiera, sin tocar nada de lo instalado.
 *
 *   node herramientas/revisar-plano.js "C:\\ruta\\PlanoNuevo.json" --comparar
 *       Ademas compara contra la base municipal (necesita estar en la red).
 *
 * NO MODIFICA NADA. Solo lee e informa.
 * ============================================================================
 */

'use strict';

const path = require('path');
const fs = require('fs');

const DIR_APP = path.join(__dirname, '..', 'servidor');
const DIR_DATOS = path.join(__dirname, '..', 'web', 'datos');

// Nombre del plano en uso. Tiene que coincidir con el de PLANO.parcelas en
// web/js/app.js: es el archivo que el visor carga realmente.
const PLANO_EN_USO = 'Merlo2026Parcelas-V1.json';

// Villa de Merlo, con margen generoso. Sirve para detectar un archivo exportado
// en el sistema de coordenadas equivocado: el plano original esta en POSGAR 98
// / Argentina Zona 3 (EPSG:22173), y el visor necesita WGS84 (grados). Si se
// exporta sin reproyectar, las coordenadas salen en metros -numeros de seis o
// siete cifras- y no caen ni cerca de este recuadro.
const RECUADRO_MERLO = { lngMin: -65.3, lngMax: -64.7, latMin: -32.7, latMax: -32.0 };

// ----------------------------------------------------------------------------
// Lectura del .env sin la libreria dotenv. Misma razon que en
// probar-conexion.js: este script vive en herramientas/ y las librerias estan
// en servidor/node_modules, asi que un require('dotenv') desde aca no las
// encuentra en una computadora limpia.
// ----------------------------------------------------------------------------
function cargarEnv(ruta) {
    if (!fs.existsSync(ruta)) return;
    for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
        const limpia = linea.trim();
        if (!limpia || limpia.startsWith('#')) continue;
        const corte = limpia.indexOf('=');
        if (corte < 1) continue;
        const clave = limpia.slice(0, corte).trim();
        let valor = limpia.slice(corte + 1).trim();
        if (valor.length > 1 &&
            ((valor[0] === '"' && valor.endsWith('"')) ||
             (valor[0] === "'" && valor.endsWith("'")))) {
            valor = valor.slice(1, -1);
        }
        if (!(clave in process.env)) process.env[clave] = valor;
    }
}

/**
 * Deja un padron en una forma comparable: solo letras y numeros.
 * Tiene que hacer EXACTAMENTE lo mismo que normalizarPadron() en
 * web/js/app.js, porque de eso depende que lo que informa este script
 * coincida con lo que el visor realmente puede pintar.
 */
function normalizarPadron(valor) {
    return String(valor == null ? '' : valor).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function padronDe(props) {
    return String((props && (props.NRO_RENTA || props.PADRON)) || '').trim();
}

/** Recorre las coordenadas de cualquier geometria GeoJSON. */
function recorrerCoordenadas(coords, alPunto) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') { alPunto(coords[0], coords[1]); return; }
    for (const c of coords) recorrerCoordenadas(c, alPunto);
}

function titulo(texto) {
    console.log('');
    console.log('  ' + '='.repeat(66));
    console.log('   ' + texto);
    console.log('  ' + '='.repeat(66));
}

// ============================================================================
// REVISION DEL ARCHIVO
// ============================================================================
function revisarArchivo(ruta) {
    if (!fs.existsSync(ruta)) {
        console.error(`\n  ERROR: no existe el archivo:\n  ${ruta}\n`);
        process.exit(2);
    }

    const tam = (fs.statSync(ruta).size / 1024 / 1024).toFixed(1);
    titulo('ARCHIVO');
    console.log(`   ${ruta}`);
    console.log(`   Tamano: ${tam} MB`);

    let datos;
    try {
        datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch (e) {
        console.error('\n   ERROR: el archivo no es un JSON valido.');
        console.error('   ' + e.message);
        console.error('\n   Suele pasar cuando la exportacion se corto por la mitad.');
        console.error('   Hay que volver a exportarlo.\n');
        process.exit(2);
    }

    const rasgos = datos.features;
    if (!Array.isArray(rasgos)) {
        console.error('\n   ERROR: el archivo no tiene una lista "features".');
        console.error('   No parece un GeoJSON. Al exportar hay que elegir');
        console.error('   formato GeoJSON, no Shapefile ni KML.\n');
        process.exit(2);
    }

    // --- Conteo y clasificacion ---------------------------------------------
    const porPadron = new Map();      // padron normalizado -> [padrones tal cual]
    const sinPadron = [];             // indices de poligonos sin padron
    const formatoRaro = [];           // padrones que no son NN-NNNNNN
    const sinGeometria = [];
    let fueraDeMerlo = 0;
    let ejemploFuera = null;
    let conNomenclatura = 0;

    rasgos.forEach((f, i) => {
        const props = f.properties || {};
        const padron = padronDe(props);

        if (!padron) {
            sinPadron.push(i);
        } else {
            const clave = normalizarPadron(padron);
            if (!porPadron.has(clave)) porPadron.set(clave, []);
            porPadron.get(clave).push(padron);
            if (!/^[0-9]+-[0-9]+$/.test(padron)) formatoRaro.push(padron);
        }

        const nomen = String(props.NOMENCLA || props.NOMENCLATURA || props.NOMENCLATU || '').trim();
        if (nomen) conNomenclatura++;

        if (!f.geometry || !f.geometry.coordinates || f.geometry.coordinates.length === 0) {
            sinGeometria.push(i);
            return;
        }

        // Alcanza con mirar el primer punto de cada poligono para detectar un
        // sistema de coordenadas equivocado: si esta mal, estan todos mal.
        let primero = null;
        recorrerCoordenadas(f.geometry.coordinates, (lng, lat) => {
            if (primero === null) primero = [lng, lat];
        });
        if (primero) {
            const [lng, lat] = primero;
            const dentro = lng >= RECUADRO_MERLO.lngMin && lng <= RECUADRO_MERLO.lngMax &&
                           lat >= RECUADRO_MERLO.latMin && lat <= RECUADRO_MERLO.latMax;
            if (!dentro) {
                fueraDeMerlo++;
                if (!ejemploFuera) ejemploFuera = primero;
            }
        }
    });

    const repetidos = [...porPadron.entries()].filter(([, v]) => v.length > 1);

    titulo('CONTENIDO');
    console.log(`   Poligonos:                 ${rasgos.length}`);
    console.log(`   Con padron:                ${rasgos.length - sinPadron.length}`);
    console.log(`   Padrones distintos:        ${porPadron.size}`);
    console.log(`   Con nomenclatura:          ${conNomenclatura}`);

    // --- Problemas -----------------------------------------------------------
    const problemas = [];
    const avisos = [];

    if (sinPadron.length > 0) {
        problemas.push(
            `${sinPadron.length} poligono(s) SIN PADRON.\n` +
            `      Se dibujan en el mapa, pero al hacerles clic no traen ningun\n` +
            `      dato y nunca se pintan al filtrar. Para el operador parece una\n` +
            `      falla del programa. Hay que completarles el NRO_RENTA en el\n` +
            `      origen (QGIS/ArcGIS) y volver a exportar.`
        );
    }

    if (fueraDeMerlo > 0) {
        problemas.push(
            `${fueraDeMerlo} poligono(s) con coordenadas FUERA DE MERLO.\n` +
            `      Ejemplo: ${ejemploFuera && ejemploFuera.join(', ')}\n` +
            `      Casi siempre significa que el archivo se exporto sin\n` +
            `      reproyectar. El visor necesita WGS84 (grados: -65.01, -32.34),\n` +
            `      no POSGAR / Argentina Zona 3 (metros: 6 o 7 cifras).\n` +
            `      En QGIS: Exportar > Guardar objetos como > GeoJSON, y en SRC\n` +
            `      elegir EPSG:4326 - WGS 84.`
        );
    }

    if (sinGeometria.length > 0) {
        problemas.push(
            `${sinGeometria.length} poligono(s) SIN GEOMETRIA.\n` +
            `      Leaflet los saltea sin avisar: la parcela simplemente no\n` +
            `      aparece en el mapa.`
        );
    }

    if (repetidos.length > 0) {
        const muestra = repetidos.slice(0, 8).map(([, v]) => v[0]).join(', ');
        avisos.push(
            `${repetidos.length} padron(es) aparecen en mas de un poligono.\n` +
            `      Ejemplos: ${muestra}\n` +
            `      Puede ser correcto (propiedad horizontal, parcelas divididas)\n` +
            `      o un poligono duplicado. Conviene revisarlos.`
        );
    }

    if (formatoRaro.length > 0) {
        const muestra = [...new Set(formatoRaro)].slice(0, 10).join(', ');
        avisos.push(
            `${formatoRaro.length} padron(es) con formato distinto al habitual\n` +
            `      (lo normal es 13-123456).\n` +
            `      Ejemplos: ${muestra}\n` +
            `      Algunos son legitimos (planos de mensura, PM-xxxxx). Otros son\n` +
            `      errores de carga: fijarse en los que tengan texto suelto,\n` +
            `      guiones de mas o letras cambiadas.`
        );
    }

    if (conNomenclatura < rasgos.length - sinPadron.length) {
        const faltan = (rasgos.length - sinPadron.length) - conNomenclatura;
        avisos.push(
            `${faltan} poligono(s) sin nomenclatura catastral.\n` +
            `      El visor los agrupa por manzana usando la nomenclatura, asi\n` +
            `      que esos no van a resaltar la manzana al seleccionarlos.`
        );
    }

    titulo('RESULTADO');
    if (problemas.length === 0 && avisos.length === 0) {
        console.log('   Sin problemas. El archivo se puede usar.');
    }
    problemas.forEach((p, i) => console.log(`\n   PROBLEMA ${i + 1}: ${p}`));
    avisos.forEach((a, i) => console.log(`\n   AVISO ${i + 1}: ${a}`));

    if (problemas.length > 0) {
        console.log('\n   Los PROBLEMAS conviene corregirlos en el origen antes de');
        console.log('   reemplazar el plano. Los AVISOS no impiden usarlo.');
    }

    return { rasgos, porPadron, problemas: problemas.length };
}

// ============================================================================
// COMPARACION CONTRA LA BASE MUNICIPAL (opcional)
// ============================================================================
async function compararConLaBase(porPadron) {
    titulo('COMPARACION CONTRA LA BASE MUNICIPAL');

    cargarEnv(path.join(DIR_APP, '.env'));

    let sql;
    try {
        sql = require(path.join(DIR_APP, 'node_modules', 'mssql'));
    } catch (e) {
        console.log('   No se encontro el paquete mssql. Instalar con:');
        console.log('     cd servidor && npm install');
        return;
    }

    const nombreBase = String(process.env.DB_DATABASE || '').trim();
    const esPredeterminada = nombreBase === '' ||
                             nombreBase.toLowerCase() === '<predeterminado>' ||
                             nombreBase.toLowerCase() === 'predeterminado';

    let pool;
    try {
        pool = await sql.connect({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            server: process.env.DB_SERVER,
            ...(esPredeterminada ? {} : { database: nombreBase }),
            requestTimeout: 120000,
            options: {
                encrypt: process.env.DB_ENCRYPT === 'true',
                trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
            }
        });
    } catch (e) {
        console.log('   No se pudo conectar a la base municipal.');
        console.log('   ' + e.message.split('\n')[0]);
        console.log('');
        console.log('   Esta parte necesita estar en la red de la Municipalidad.');
        console.log('   La revision del archivo de arriba igual es valida.');
        return;
    }

    try {
        const r = await pool.request().query(`
            SELECT DISTINCT LTRIM(RTRIM(NRO_RENTA)) AS PADRON
            FROM PROGRAM.dbo.VI_GIS_CATASTRO_PADRON
            WHERE ACTIVO = 1 AND NRO_RENTA IS NOT NULL AND LTRIM(RTRIM(NRO_RENTA)) <> ''
        `);

        const enLaBase = new Map();      // normalizado -> tal cual
        for (const fila of r.recordset) {
            enLaBase.set(normalizarPadron(fila.PADRON), fila.PADRON);
        }

        const sinDibujo = [];            // en la base, no en el plano
        for (const [clave, original] of enLaBase) {
            if (!porPadron.has(clave)) sinDibujo.push(original);
        }

        const sinFicha = [];             // en el plano, no en la base
        for (const [clave, originales] of porPadron) {
            if (!enLaBase.has(clave)) sinFicha.push(originales[0]);
        }

        console.log(`   Padrones activos en la base:   ${enLaBase.size}`);
        console.log(`   Padrones dibujados en el plano: ${porPadron.size}`);
        console.log('');
        console.log(`   EN LA BASE PERO SIN DIBUJAR:    ${sinDibujo.length}`);
        console.log('     Son parcelas que existen, tienen titular y se pueden');
        console.log('     buscar por padron, pero no aparecen en el mapa ni se');
        console.log('     pintan al filtrar. Es la lista de lo que falta dibujar.');
        console.log('');
        console.log(`   DIBUJADAS PERO NO EN LA BASE:   ${sinFicha.length}`);
        console.log('     Poligonos cuyo padron no figura como activo. Pueden ser');
        console.log('     parcelas dadas de baja, unificadas, o con el numero mal');
        console.log('     escrito en el plano.');

        // Los listados completos van a archivos: en pantalla no se pueden leer
        // miles de numeros, y asi se pueden pasar a quien dibuja el plano.
        const salida = path.join(__dirname, '..', 'informes');
        if (!fs.existsSync(salida)) fs.mkdirSync(salida, { recursive: true });

        const sello = new Date().toISOString().slice(0, 10);
        const f1 = path.join(salida, `padrones-sin-dibujar-${sello}.txt`);
        const f2 = path.join(salida, `poligonos-sin-ficha-${sello}.txt`);
        fs.writeFileSync(f1, sinDibujo.sort().join('\r\n'), 'utf8');
        fs.writeFileSync(f2, sinFicha.sort().join('\r\n'), 'utf8');

        console.log('');
        console.log('   Listados completos guardados en:');
        console.log(`     ${f1}`);
        console.log(`     ${f2}`);

    } catch (e) {
        console.log('   Error al consultar la base: ' + e.message.split('\n')[0]);
    } finally {
        try { await pool.close(); } catch (e) { /* ya cerrado */ }
    }
}

// ============================================================================
// PRINCIPAL
// ============================================================================
(async () => {
    const args = process.argv.slice(2);
    const comparar = args.includes('--comparar');
    const rutaPedida = args.find((a) => !a.startsWith('--'));
    const ruta = rutaPedida
        ? path.resolve(rutaPedida)
        : path.join(DIR_DATOS, PLANO_EN_USO);

    console.log('');
    console.log('  REVISION DEL PLANO - VISOR CATASTRAL VILLA DE MERLO');

    const { porPadron, problemas } = revisarArchivo(ruta);

    if (comparar) {
        await compararConLaBase(porPadron);
    } else {
        console.log('');
        console.log('   Para comparar ademas contra la base municipal y saber que');
        console.log('   parcelas faltan dibujar, agregar  --comparar');
    }

    console.log('');
    process.exit(problemas > 0 ? 1 : 0);
})();
