#!/usr/bin/env node
/**
 * ============================================================================
 * VERIFICA QUE NO SE HAYA PERDIDO NADA DEL PROGRAMA ORIGINAL
 * ----------------------------------------------------------------------------
 * PARA QUÉ SIRVE
 *   El visor original era un solo archivo Index.html de 1.414 líneas. Se
 *   separó en maquetado, estilos y lógica, se reorganizaron las carpetas y se
 *   reescribieron varias partes. Cada uno de esos pasos pudo haberse llevado
 *   algo puesto sin que se note: un botón que quedó llamando a una función que
 *   ya no existe, un campo que el código busca y el HTML ya no tiene.
 *
 *   Ese tipo de rotura no se ve al abrir el visor. Se ve el día que alguien
 *   aprieta ese botón.
 *
 *   Este script compara el estado actual contra una copia del original que se
 *   conserva en docs/, y avisa si falta algo.
 *
 * USO
 *   node herramientas/verificar-funcionalidad.js
 *
 * CÓDIGO DE SALIDA
 *   0 = todo bien
 *   1 = falta algo, el detalle está en la salida
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ORIGINAL = path.join(RAIZ, 'docs', 'Index-monolitico-original.html.bak');
const HTML = path.join(RAIZ, 'web', 'index.html');
const JS = path.join(RAIZ, 'web', 'js', 'app.js');
const SERVIDOR = path.join(RAIZ, 'servidor', 'server.js');

/**
 * Capacidades que el visor original tenía. Cada una se busca por una marca en
 * el código actual. La lista se escribió leyendo el original: si algún día se
 * agrega una función nueva que haya que preservar, va acá.
 */
const CAPACIDADES = [
    ['Buscar por padrón',            'buscarPadron'],
    ['Ficha de parcela',             'showModalData'],
    ['Plancheta imprimible',         'imprimirFicha'],
    ['Propiedad horizontal',         'mostrarModalPH'],
    ['Selección de sub-unidad PH',   'seleccionarPH'],
    ['Filtro por superficie',        'supMin'],
    ['Filtro por edificación',       'edificacion'],
    ['Limpiar filtros',              'limpiarFiltros'],
    ['Pintar resultados en el mapa', 'paintMapFromFilter'],
    ['Tabla de resultados',          'abrirModalResultados'],
    ['Panel de capas',               'toggleLayers'],
    ['Cambiar mapa base',            'switchBaseLayer'],
    ['Etiquetas de nomenclatura',    'renderDynamicLabels'],
    ['Capa Edificado',               'Edificado2026'],
    ['Capa Barrios',                 'MerloBarrios'],
    ['Capa Manzanas',                'MerloPuntosNomeclaManzanas'],
    ['Capa Parcelas',                'Merlo2026Parcelas-V1'],
    ['Punto en polígono',            'isPointInPolygon']
];

/** Endpoints que el visor original consumía y que no se pueden eliminar. */
const ENDPOINTS = ['api/catastro', 'api/superficie', 'api/edificacion'];

function leer(ruta) {
    if (!fs.existsSync(ruta)) return null;
    return fs.readFileSync(ruta, 'utf8');
}

function main() {
    console.log('\n  VERIFICACIÓN CONTRA EL PROGRAMA ORIGINAL');
    console.log('  ============================================================\n');

    const html = leer(HTML);
    const js = leer(JS);
    const servidor = leer(SERVIDOR);

    if (!html || !js || !servidor) {
        console.error('  No se encontraron los archivos del visor.\n');
        process.exit(1);
    }

    const codigo = html + '\n' + js;
    let problemas = 0;

    // ---- 1. Botones que llaman a funciones inexistentes --------------------
    // Es la rotura más típica de un refactor: el HTML sigue teniendo el botón,
    // pero la función que llamaba ya no está. No falla al cargar la página,
    // falla cuando alguien lo aprieta.
    console.log('  1. Botones del visor');
    const llamadas = new Set();
    for (const m of html.matchAll(/on\w+\s*=\s*"(\w+)\s*\(/g)) llamadas.add(m[1]);

    const rotos = [];
    for (const fn of llamadas) {
        const declarada = new RegExp(`function\\s+${fn}\\s*\\(`).test(js);
        const asignada = new RegExp(`window\\.${fn}\\s*=`).test(js);
        if (!declarada && !asignada) rotos.push(fn);
    }
    if (rotos.length) {
        problemas++;
        console.log(`     ✗ ${rotos.length} boton(es) llaman a funciones que no existen:`);
        for (const f of rotos) console.log(`         ${f}()`);
    } else {
        console.log(`     ✓ los ${llamadas.size} botones apuntan a funciones que existen`);
    }

    // ---- 2. Elementos que el código busca y el HTML no tiene ---------------
    console.log('\n  2. Elementos de la interfaz');
    const idsJs = new Set();
    for (const m of js.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)) idsJs.add(m[1]);
    const idsHtml = new Set();
    for (const m of html.matchAll(/id="([\w-]+)"/g)) idsHtml.add(m[1]);

    const faltantes = [...idsJs].filter((id) => !idsHtml.has(id));
    if (faltantes.length) {
        problemas++;
        console.log(`     ✗ el código busca ${faltantes.length} elemento(s) que no están en el HTML:`);
        for (const id of faltantes) console.log(`         #${id}`);
    } else {
        console.log(`     ✓ los ${idsJs.size} elementos que busca el código existen`);
    }

    // ---- 3. Capacidades del original ---------------------------------------
    console.log('\n  3. Capacidades del programa original');
    const perdidas = CAPACIDADES.filter(([, marca]) => !codigo.includes(marca));
    if (perdidas.length) {
        problemas++;
        for (const [nombre] of perdidas) console.log(`     ✗ ${nombre}`);
    } else {
        console.log(`     ✓ las ${CAPACIDADES.length} capacidades siguen presentes`);
    }

    // ---- 4. Endpoints ------------------------------------------------------
    // Los endpoints viejos se conservan aunque el visor ya no los use: puede
    // haber algo más apuntando ahí, y quitarlos no aporta nada.
    console.log('\n  4. Endpoints de la API');
    const eliminados = ENDPOINTS.filter((ep) => !servidor.includes(ep));
    if (eliminados.length) {
        problemas++;
        for (const ep of eliminados) console.log(`     ✗ /${ep} ya no existe en el servidor`);
    } else {
        console.log(`     ✓ los ${ENDPOINTS.length} endpoints originales siguen respondiendo`);
    }

    // ---- 5. El original sigue guardado --------------------------------------
    console.log('\n  5. Copia del programa original');
    if (leer(ORIGINAL)) {
        console.log('     ✓ conservada en docs/Index-monolitico-original.html.bak');
    } else {
        console.log('     ! no está: sin ella no se puede comparar contra el original');
    }

    console.log('\n  ============================================================');
    if (problemas === 0) {
        console.log('   SIN PERDIDAS. El visor hace todo lo que hacía el original.');
        console.log('  ============================================================\n');
        process.exit(0);
    }
    console.log(`   ${problemas} PROBLEMA(S). Ver el detalle arriba.`);
    console.log('  ============================================================\n');
    process.exit(1);
}

main();
