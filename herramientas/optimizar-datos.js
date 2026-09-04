#!/usr/bin/env node
/**
 * ============================================================================
 * OPTIMIZADOR DE LOS GEOJSON DEL VISOR
 * ----------------------------------------------------------------------------
 * PARA QUÉ SIRVE
 *   Los GeoJSON que exporta el DWG pesan 46 MB entre todos. El navegador tiene
 *   que descargarlos y parsearlos enteros en cada visita, y eso es lo que hace
 *   lenta la primera carga del visor.
 *
 *   Buena parte de ese peso no aporta nada:
 *
 *     1. COORDENADAS CON 14 DECIMALES
 *        14 decimales son millonésimas de milímetro. Leaflet, además, redondea
 *        a 6 al dibujar, así que esos decimales de más se descartan igual.
 *        Con 6 decimales la precisión es de unos 10 cm, de sobra para catastro
 *        urbano, y cada coordenada pasa de ~19 a ~10 caracteres.
 *
 *     2. CAMPOS VACÍOS
 *        El archivo de puntos trae 74 campos por registro (PADRON_1 a
 *        PADRON_30, NOMENCLAT2 a NOMENCLA30...) y en la enorme mayoría de los
 *        casos están vacíos. Un campo vacío ocupa lugar y no dice nada: el
 *        código lo trata igual que a un campo ausente.
 *
 * IMPORTANTE
 *   Esto NO reemplaza los archivos originales: escribe los optimizados en otra
 *   carpeta. Y no cambia ningún resultado del visor, cosa que se verifica
 *   aparte con verificar-equivalencia.js.
 *
 * USO
 *   node herramientas/optimizar-datos.js              genera en web/datos-optimizados/
 *   node herramientas/optimizar-datos.js --reemplazar sobrescribe web/datos/
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIR_ORIGEN = path.join(__dirname, '..', 'web', 'datos');
const DIR_SALIDA = path.join(__dirname, '..', 'web', 'datos-optimizados');

// 6 decimales ≈ 11 cm en latitud. Es la misma precisión que usa Leaflet al
// dibujar, así que no se pierde nada de lo que el visor efectivamente muestra.
const DECIMALES = 6;
const FACTOR = Math.pow(10, DECIMALES);

function redondear(n) {
    return Math.round(n * FACTOR) / FACTOR;
}

/**
 * Recorta las coordenadas de cualquier geometría GeoJSON.
 * Conserva solo lng y lat: el tercer y cuarto valor que traen algunos puntos
 * (altura 0 y el -1e+38 que mete AutoCAD) no los usa nadie.
 */
function limpiarCoordenadas(c) {
    if (typeof c[0] === 'number') {
        return [redondear(c[0]), redondear(c[1])];
    }
    return c.map(limpiarCoordenadas);
}

/** Saca los campos vacíos: el código los trata igual que a los ausentes. */
function limpiarPropiedades(props) {
    const salida = {};
    for (const clave in props) {
        const v = props[clave];
        if (v === null || v === undefined) continue;
        if (String(v).trim() === '') continue;
        salida[clave] = v;
    }
    return salida;
}

function optimizar(nombre) {
    const rutaOrigen = path.join(DIR_ORIGEN, nombre);
    if (!fs.existsSync(rutaOrigen)) {
        console.log(`  ${nombre.padEnd(38)} (no está, se omite)`);
        return null;
    }

    const bytesAntes = fs.statSync(rutaOrigen).size;
    const datos = JSON.parse(fs.readFileSync(rutaOrigen, 'utf8'));

    const features = (datos.features || []).map((f) => {
        const nueva = { type: 'Feature' };
        if (f.geometry && f.geometry.coordinates) {
            nueva.geometry = {
                type: f.geometry.type,
                coordinates: limpiarCoordenadas(f.geometry.coordinates)
            };
        } else {
            nueva.geometry = f.geometry || null;
        }
        nueva.properties = limpiarPropiedades(f.properties || {});
        return nueva;
    });

    const salida = JSON.stringify({ type: 'FeatureCollection', features }, null, 0);
    fs.writeFileSync(path.join(DIR_SALIDA, nombre), salida, 'utf8');

    const bytesDespues = Buffer.byteLength(salida, 'utf8');
    const ahorro = 100 - (bytesDespues * 100 / bytesAntes);

    console.log(
        `  ${nombre.padEnd(38)} ${(bytesAntes / 1e6).toFixed(1).padStart(6)} MB  ->` +
        `${(bytesDespues / 1e6).toFixed(1).padStart(6)} MB   (-${ahorro.toFixed(0)}%)`
    );

    return { bytesAntes, bytesDespues };
}

function main() {
    const reemplazar = process.argv.includes('--reemplazar');

    console.log('\n  OPTIMIZACIÓN DE LOS GEOJSON');
    console.log('  ============================================================\n');

    if (!fs.existsSync(DIR_ORIGEN)) {
        console.error(`  No se encontró ${DIR_ORIGEN}\n`);
        process.exit(2);
    }
    fs.mkdirSync(DIR_SALIDA, { recursive: true });

    const archivos = fs.readdirSync(DIR_ORIGEN).filter((f) => f.endsWith('.json'));
    let antes = 0, despues = 0;

    for (const nombre of archivos) {
        const r = optimizar(nombre);
        if (r) { antes += r.bytesAntes; despues += r.bytesDespues; }
    }

    console.log('  ------------------------------------------------------------');
    console.log(
        `  ${'TOTAL'.padEnd(38)} ${(antes / 1e6).toFixed(1).padStart(6)} MB  ->` +
        `${(despues / 1e6).toFixed(1).padStart(6)} MB   (-${(100 - despues * 100 / antes).toFixed(0)}%)`
    );

    console.log(`\n  Escritos en: web/datos-optimizados/`);
    console.log('\n  ANTES DE USARLOS, verificar que no cambie ningún resultado:');
    console.log('    node herramientas/comparar-datos.js\n');

    if (reemplazar) {
        for (const nombre of archivos) {
            const opt = path.join(DIR_SALIDA, nombre);
            if (fs.existsSync(opt)) fs.copyFileSync(opt, path.join(DIR_ORIGEN, nombre));
        }
        console.log('  Los originales fueron REEMPLAZADOS por las versiones optimizadas.');
        console.log('  Hay que regenerar la línea base:');
        console.log('    node herramientas/verificar-equivalencia.js --guardar\n');
    }
}

main();
