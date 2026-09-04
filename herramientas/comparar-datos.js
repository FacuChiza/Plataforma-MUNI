#!/usr/bin/env node
/**
 * ============================================================================
 * COMPARA LOS DATOS ORIGINALES CONTRA LOS OPTIMIZADOS
 * ----------------------------------------------------------------------------
 * optimizar-datos.js recorta las coordenadas a 6 decimales y saca los campos
 * vacíos. Las dos cosas PARECEN inocuas, pero tocan la geometría, y la
 * geometría es justamente lo que decide qué datos se le muestran a cada
 * parcela. "Parece inocuo" no alcanza cuando el error resultante sería
 * invisible: una parcela mostrando el titular de otra.
 *
 * Este script resuelve las 17.614 parcelas dos veces —con los datos originales
 * y con los optimizados— y compara parcela por parcela qué punto de
 * nomenclatura eligió cada una.
 *
 * Reutiliza el algoritmo de verificar-equivalencia.js en vez de copiarlo, para
 * que no puedan quedar desincronizados.
 *
 * USO
 *   node herramientas/comparar-datos.js
 *
 * CÓDIGO DE SALIDA
 *   0 = idénticos, los datos optimizados se pueden usar
 *   1 = hay diferencias, NO usarlos
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getPointInLayer } = require('./verificar-equivalencia.js');

const DIR_ORIGINAL = path.join(__dirname, '..', 'web', 'datos');
const DIR_OPTIMIZADO = path.join(__dirname, '..', 'web', 'datos-optimizados');

const PARCELAS = 'Merlo2026Parcelas-V1.json';
const PUNTOS = 'MerloPuntosNomeclaParcelasV2.json';

function cargar(dir, nombre) {
    const ruta = path.join(dir, nombre);
    if (!fs.existsSync(ruta)) {
        console.error(`\n  No se encontró ${ruta}\n`);
        process.exit(2);
    }
    return JSON.parse(fs.readFileSync(ruta, 'utf8')).features;
}

/** Resuelve, para cada parcela, el índice del punto que le corresponde. */
function resolver(parcelas, puntos) {
    const indice = new Map();
    puntos.forEach((p, i) => indice.set(p, i));

    return parcelas.map((f) => {
        const g = f.geometry;
        let anillo = [];
        if (g && g.type === 'Polygon') anillo = g.coordinates[0];
        else if (g && g.type === 'MultiPolygon') anillo = g.coordinates[0][0];

        const hallazgo = getPointInLayer(anillo, puntos);
        return {
            renta: String((f.properties || {}).NRO_RENTA || '').trim(),
            punto: hallazgo ? indice.get(hallazgo.punto) : -1,
            via: hallazgo ? hallazgo.via : 'sin_punto'
        };
    });
}

function main() {
    console.log('\n  COMPARACIÓN: DATOS ORIGINALES vs OPTIMIZADOS');
    console.log('  ============================================================\n');

    console.log('  Resolviendo con los datos originales...');
    const original = resolver(cargar(DIR_ORIGINAL, PARCELAS), cargar(DIR_ORIGINAL, PUNTOS));

    console.log('  Resolviendo con los datos optimizados...');
    const optimizado = resolver(cargar(DIR_OPTIMIZADO, PARCELAS), cargar(DIR_OPTIMIZADO, PUNTOS));

    if (original.length !== optimizado.length) {
        console.log(`\n  ❌ Distinta cantidad de parcelas: ${original.length} vs ${optimizado.length}\n`);
        process.exit(1);
    }

    const dif = [];
    for (let i = 0; i < original.length; i++) {
        const a = original[i], b = optimizado[i];
        if (a.punto !== b.punto || a.via !== b.via) {
            dif.push({ i, renta: a.renta, antes: a, ahora: b });
        }
    }

    console.log(`\n  Parcelas comparadas: ${original.length}`);
    console.log(`  Diferencias:         ${dif.length}\n`);

    if (dif.length === 0) {
        console.log('  ============================================================');
        console.log('   IDÉNTICOS. Las 17.614 parcelas eligen el mismo punto.');
        console.log('   Los datos optimizados se pueden usar sin cambiar nada.');
        console.log('  ============================================================\n');
        process.exit(0);
    }

    console.log('  ============================================================');
    console.log(`   ${dif.length} PARCELA(S) CAMBIAN DE RESULTADO — no usar`);
    console.log('  ============================================================\n');
    for (const d of dif.slice(0, 20)) {
        console.log(`  ${d.renta || '(sin renta)'}  posición ${d.i}`);
        console.log(`     original:  punto ${d.antes.punto} (${d.antes.via})`);
        console.log(`     optimizado: punto ${d.ahora.punto} (${d.ahora.via})`);
    }
    if (dif.length > 20) console.log(`\n  ... y ${dif.length - 20} más.`);
    console.log('');
    process.exit(1);
}

main();
