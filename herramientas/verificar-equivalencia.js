#!/usr/bin/env node
/**
 * ============================================================================
 * TEST DE EQUIVALENCIA DEL VÍNCULO PARCELA -> DATOS
 * ----------------------------------------------------------------------------
 * PARA QUÉ SIRVE
 *   Antes de refactorizar app.js hay que poder demostrar —no prometer— que el
 *   resultado no cambió. Este script resuelve, para CADA polígono del padrón,
 *   exactamente lo mismo que resuelve el navegador al hacer clic: qué punto de
 *   nomenclatura se elige y qué claves (padrón + nomenclatura) se terminan
 *   mandando a /api/catastro.
 *
 *   El resultado se guarda como "línea base". Después de cualquier cambio en
 *   app.js se vuelve a correr y se compara contra esa línea base: si sale
 *   IDÉNTICO, el refactor no alteró ningún resultado. Si algo cambió, dice
 *   exactamente en qué parcela y en qué difiere.
 *
 * USO
 *   node herramientas/verificar-equivalencia.js            comparar contra la línea base
 *   node herramientas/verificar-equivalencia.js --guardar  fijar la línea base
 *   node herramientas/verificar-equivalencia.js --informe  + diagnóstico de integridad
 *   node herramientas/verificar-equivalencia.js --hash     huella para contrastar con el navegador
 *
 * VERIFICAR EL CÓDIGO REAL DEL VISOR (no esta copia)
 *   Este script reproduce la lógica de app.js, pero no la ejecuta: si alguien
 *   cambia app.js y no toca este archivo, la comparación seguiría dando "sin
 *   cambios" sin haber probado nada. Para verificar el código que realmente
 *   corre en el navegador:
 *
 *     1. node herramientas/verificar-equivalencia.js --hash
 *     2. abrir el visor, esperar a que cargue el mapa completo
 *     3. pegar en la consola del navegador (F12):
 *
 *        (async () => {
 *          const idx = new Map(); labelsData.forEach((p,i)=>idx.set(p,i));
 *          const capas = [];
 *          geojsonLayer.eachLayer(function w(l){ if(l.eachLayer){l.eachLayer(w);return;} if(l.feature) capas.push(l); });
 *          const filas = capas.map(l => (l.feature.properties.NRO_RENTA||'').trim() + '|' +
 *            (()=>{ const p = getPointInLayer(l, labelsData); return p ? idx.get(p) : -1; })());
 *          const buf = new TextEncoder().encode(filas.join('\n'));
 *          const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))]
 *            .map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
 *          console.log('parcelas:', capas.length, '\nhash:', h);
 *        })();
 *
 *     4. los dos hash tienen que ser iguales.
 *
 * CÓDIGO DE SALIDA
 *   0 = sin cambios (o línea base guardada)
 *   1 = hay parcelas que cambiaron de resultado
 *   2 = faltan los archivos de datos
 *   3 = los datos de entrada cambiaron (la comparación no aplica)
 *
 * IMPORTANTE
 *   Las funciones de la sección 2 son una COPIA FIEL de la lógica de app.js
 *   (isPointInPolygon / getPointInLayer y la resolución de claves del onClick).
 *   No "mejorar" nada acá: el valor de este script es reproducir el
 *   comportamiento actual tal cual es, incluido el fallback por cercanía.
 *   Si se cambia app.js a propósito, se actualiza la línea base con --guardar.
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR_DATOS = path.join(__dirname, '..', 'web', 'datos');
const ARCHIVO_PARCELAS = path.join(DIR_DATOS, 'Merlo2026Parcelas-V1.json');
const ARCHIVO_PUNTOS = path.join(DIR_DATOS, 'MerloPuntosNomeclaParcelasV2.json');
const ARCHIVO_BASE = path.join(__dirname, 'linea-base.json');

// ============================================================================
// 1. CARGA
// ============================================================================
function cargar(ruta, nombre) {
    if (!fs.existsSync(ruta)) {
        console.error(`\n  ERROR: no se encontró ${nombre}`);
        console.error(`  Ruta esperada: ${ruta}`);
        console.error(`  Los GeoJSON no se versionan en git (ver .gitignore).`);
        console.error(`  Copiarlos desde el servidor a web/datos/ antes de correr esto.\n`);
        process.exit(2);
    }
    return JSON.parse(fs.readFileSync(ruta, 'utf8')).features;
}

/**
 * Huella de un archivo de datos.
 *
 * La comparación de esta herramienta es 1 a 1 por posición, así que solo tiene
 * sentido contra los MISMOS datos de entrada. La huella detecta si alguien
 * cargó un DWG nuevo entre una corrida y la otra: en ese caso las diferencias
 * que aparecerían no serían culpa del refactor sino de los datos, y reportarlas
 * como si lo fueran sería peor que no tener test.
 */
function huella(ruta) {
    return crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex').slice(0, 16);
}

// ============================================================================
// 2. ALGORITMO ACTUAL - copia fiel de app.js (NO MODIFICAR)
// ============================================================================

/**
 * Redondeo de Leaflet (L.Util.formatNum con precisión por defecto = 6).
 *
 * POR QUÉ ESTO IMPORTA:
 *   getPointInLayer() saca el anillo del polígono con layer.toGeoJSON(), y ese
 *   método redondea las coordenadas a 6 decimales (~0,1 m). El bounding box,
 *   en cambio, sale de layer.getBounds(), que usa las coordenadas internas SIN
 *   redondear. O sea que el navegador filtra por bbox con precisión completa y
 *   después hace el ray-casting con precisión recortada.
 *
 *   Es una mezcla rara, pero es la que corre en producción. Si este script
 *   usara los 14 decimales del archivo, no estaría midiendo lo que hace el
 *   visor: estaría midiendo otra cosa parecida.
 */
function formatNum(num) {
    const pow = Math.pow(10, 6);
    return Math.round(num * pow) / pow;
}

/** Ray-casting. Copia textual de app.js. Recibe [lat, lng]. */
function isPointInPolygon(point, polygonCoords) {
    const x = point[1], y = point[0];
    let inside = false;
    for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
        const xi = polygonCoords[i][0], yi = polygonCoords[i][1];
        const xj = polygonCoords[j][0], yj = polygonCoords[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Equivalente a getPointInLayer() de app.js.
 *
 * Replica tres cosas que importan y que es fácil romper sin querer:
 *   1. El ORDEN: recorre los puntos en el orden del archivo y devuelve el
 *      PRIMERO que cae adentro. Hay polígonos con más de un punto adentro,
 *      así que el orden decide el resultado en esos casos.
 *   2. El bounding box de Leaflet es INCLUSIVO en los bordes (<= y >=).
 *   3. El fallback: si ningún punto cae adentro pero alguno está en el bbox,
 *      devuelve el más cercano al centro igual. Nunca devuelve "no sé".
 */
function getPointInLayer(anillo, puntos) {
    if (!puntos || puntos.length === 0) return null;

    // Bounding box y centro: precisión COMPLETA (equivale a layer.getBounds()).
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of anillo) {
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
    }
    const centroLat = (minLat + maxLat) / 2;
    const centroLng = (minLng + maxLng) / 2;

    // Anillo para el ray-casting: redondeado a 6 decimales (equivale a
    // layer.toGeoJSON()). Ver el comentario de formatNum().
    const anilloRedondeado = anillo.map(c => [formatNum(c[0]), formatNum(c[1])]);

    let bestMatch = null;
    let minDistance = Infinity;

    for (let idx = 0; idx < puntos.length; idx++) {
        const pt = puntos[idx];
        if (!pt.geometry || pt.geometry.type !== 'Point') continue;
        const lng = pt.geometry.coordinates[0];
        const lat = pt.geometry.coordinates[1];

        if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
            if (anilloRedondeado.length > 0 && isPointInPolygon([lat, lng], anilloRedondeado)) {
                return { punto: pt, indice: idx, via: 'dentro' };
            }
            const dist = Math.pow(lat - centroLat, 2) + Math.pow(lng - centroLng, 2);
            if (dist < minDistance) {
                minDistance = dist;
                bestMatch = { punto: pt, indice: idx, via: 'cercania' };
            }
        }
    }
    return bestMatch;
}

/**
 * Replica la resolución de claves del onClick de app.js: detección de
 * propiedad horizontal y las dos cadenas de precedencia que deciden qué se le
 * manda a /api/catastro.
 */
function resolverClaves(propsPoligono, propsAdicionales) {
    let isPH = false;
    const phList = [];

    if (propsAdicionales) {
        const mainPadron = String(propsAdicionales.PADRON || '').trim();
        if (!mainPadron && propsAdicionales.PADRON_1 && String(propsAdicionales.PADRON_1).trim() !== '') {
            isPH = true;
            for (let i = 1; i <= 50; i++) {
                const phPadron = propsAdicionales[`PADRON_${i}`];
                if (phPadron && String(phPadron).trim() !== '') {
                    const phNomencla = propsAdicionales[`NOMENCLAT${i}`] || propsAdicionales[`NOMENCLA${i}`] || '';
                    phList.push({ padron: String(phPadron).trim(), index: i, nomencla: phNomencla });
                }
            }
        }
    }

    // Parcela simple: ESTA es la precedencia que hoy pone al punto por delante
    // de la clave propia del polígono. Se reproduce tal cual está en app.js.
    const padronId = String(
        propsAdicionales.PADRON || propsPoligono.NRO_RENTA || propsPoligono.PADRON || ''
    ).trim();
    const nomenclaturaId = String(
        propsAdicionales.NOMENCLATU || propsAdicionales.NOMENCLA || propsPoligono.NOMENCLA || ''
    ).trim();

    return { isPH, cantidadPH: phList.length, padronId, nomenclaturaId };
}

// ============================================================================
// 3. RESOLUCIÓN COMPLETA DEL PADRÓN
// ============================================================================
function resolverTodo(parcelas, puntos) {
    const filas = [];
    const t0 = Date.now();

    for (let i = 0; i < parcelas.length; i++) {
        const f = parcelas[i];
        const props = f.properties || {};
        const g = f.geometry;

        let anillo = [];
        if (g && g.type === 'Polygon') anillo = g.coordinates[0];
        else if (g && g.type === 'MultiPolygon') anillo = g.coordinates[0][0];

        const hallazgo = getPointInLayer(anillo, puntos);
        const propsAdicionales = hallazgo ? hallazgo.punto.properties : {};
        const claves = resolverClaves(props, propsAdicionales);

        filas.push({
            i,
            rentaPol: String(props.NRO_RENTA || '').trim(),
            nomenclaPol: String(props.NOMENCLA || '').trim(),
            puntoIdx: hallazgo ? hallazgo.indice : -1,
            via: hallazgo ? hallazgo.via : 'sin_punto',
            padronId: claves.padronId,
            nomenclaturaId: claves.nomenclaturaId,
            isPH: claves.isPH,
            cantidadPH: claves.cantidadPH
        });

        if ((i + 1) % 2000 === 0) {
            process.stdout.write(`  ... ${i + 1}/${parcelas.length}\r`);
        }
    }

    console.log(`  ${parcelas.length} parcelas resueltas en ${((Date.now() - t0) / 1000).toFixed(1)}s        `);
    return filas;
}

// ============================================================================
// 4. COMPARACIÓN CONTRA LA LÍNEA BASE
// ============================================================================
/**
 * Compara posición por posición contra la línea base.
 *
 * POR QUÉ POR POSICIÓN Y NO POR NRO_RENTA:
 *   Parece más robusto comparar por clave, pero no lo es. Hay 365 polígonos
 *   sin NRO_RENTA y 111 claves duplicadas: al agrupar por clave, parcelas
 *   distintas caen en el mismo casillero y se comparan entre sí, produciendo
 *   diferencias que no existen. Este script sirve para verificar cambios de
 *   CÓDIGO sobre datos fijos, y para eso la posición es una identidad exacta.
 *   Que los datos no hayan cambiado lo garantiza la huella, no la clave.
 */
function comparar(actual, base) {
    const dif = [];
    const n = Math.min(actual.length, base.length);

    for (let i = 0; i < n; i++) {
        const a = actual[i];
        const b = base[i];
        if (a.padronId !== b.padronId || a.nomenclaturaId !== b.nomenclaturaId ||
            a.via !== b.via || a.isPH !== b.isPH || a.puntoIdx !== b.puntoIdx) {
            dif.push({
                clave: a.rentaPol || `(sin NRO_RENTA, posición ${i})`,
                antes: b,
                ahora: a
            });
        }
    }
    return { dif, comparadas: n };
}

// ============================================================================
// 5. INFORME DE INTEGRIDAD (opcional, --informe)
// ============================================================================
function informe(filas, parcelas) {
    const c = {
        total: filas.length, dentro: 0, cercania: 0, sinPunto: 0, ph: 0,
        polSinRenta: 0, discrepan: 0, coinciden: 0
    };
    const discrepancias = [];
    const vistos = new Map();
    let duplicados = 0;

    for (const f of filas) {
        if (f.via === 'dentro') c.dentro++;
        else if (f.via === 'cercania') c.cercania++;
        else c.sinPunto++;

        if (f.rentaPol) vistos.set(f.rentaPol, (vistos.get(f.rentaPol) || 0) + 1);

        if (f.isPH) { c.ph++; continue; }
        if (!f.rentaPol) { c.polSinRenta++; continue; }
        if (!f.padronId) continue;

        if (f.padronId === f.rentaPol) {
            c.coinciden++;
        } else {
            c.discrepan++;
            if (discrepancias.length < 20) {
                discrepancias.push({ poligono: f.rentaPol, punto: f.padronId, via: f.via });
            }
        }
    }
    for (const [, n] of vistos) if (n > 1) duplicados++;

    let geomInvalida = 0, conAgujeros = 0;
    for (const f of parcelas) {
        const g = f.geometry;
        if (!g || g.type !== 'Polygon') { geomInvalida++; continue; }
        if (g.coordinates.length > 1) conAgujeros++;
        const r = g.coordinates[0];
        if (r.length < 4) geomInvalida++;
        else if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) geomInvalida++;
    }

    console.log('\n  --- INTEGRIDAD DE ESTA CARGA -------------------------------');
    console.log(`  Parcelas totales                    ${c.total}`);
    console.log(`  Punto resuelto por contención       ${c.dentro}`);
    console.log(`  Punto resuelto por CERCANÍA         ${c.cercania}   <- adivinado`);
    console.log(`  Sin ningún punto                    ${c.sinPunto}`);
    console.log(`  Propiedad horizontal (PH)           ${c.ph}`);
    console.log(`  Polígonos sin NRO_RENTA             ${c.polSinRenta}`);
    console.log(`  NRO_RENTA duplicados                ${duplicados}`);
    console.log(`  Geometrías inválidas                ${geomInvalida}`);
    console.log(`  Polígonos con agujeros              ${conAgujeros}`);
    console.log('  ---');
    console.log(`  Clave del polígono == clave usada   ${c.coinciden}`);
    console.log(`  DISCREPAN                           ${c.discrepan}   <- ficha con datos de OTRA parcela`);

    if (discrepancias.length) {
        console.log('\n  Parcelas donde el punto contradice al polígono:');
        for (const d of discrepancias) {
            console.log(`    polígono ${d.poligono.padEnd(14)} -> se consulta ${d.punto.padEnd(14)} (${d.via})`);
        }
    }
    console.log('  ------------------------------------------------------------');
}

// ============================================================================
// 6. MAIN
// ============================================================================
function main() {
    const args = process.argv.slice(2);
    const guardar = args.includes('--guardar');
    const conInforme = args.includes('--informe');
    const soloHash = args.includes('--hash');

    console.log('\n  TEST DE EQUIVALENCIA - vínculo parcela -> datos');
    console.log('  ============================================================\n');

    const parcelas = cargar(ARCHIVO_PARCELAS, 'Merlo2026Parcelas-V1.json');
    const puntos = cargar(ARCHIVO_PUNTOS, 'MerloPuntosNomeclaParcelasV2.json');
    console.log(`  Parcelas: ${parcelas.length}   Puntos: ${puntos.length}\n`);

    const filas = resolverTodo(parcelas, puntos);
    if (conInforme) informe(filas, parcelas);

    if (soloHash) {
        // Misma huella que calcula el fragmento de consola documentado arriba:
        // "NRO_RENTA|índice del punto elegido" por parcela, en orden.
        const texto = filas.map(f => f.rentaPol + '|' + f.puntoIdx).join('\n');
        const h = crypto.createHash('sha256').update(texto).digest('hex').slice(0, 32);
        console.log(`\n  parcelas: ${filas.length}`);
        console.log(`  hash:     ${h}`);
        console.log('\n  Comparar con el que devuelve el fragmento de consola del');
        console.log('  encabezado de este archivo, corriéndolo en el visor abierto.\n');
        process.exit(0);
    }

    const existeBase = fs.existsSync(ARCHIVO_BASE);

    const huellaActual = {
        parcelas: huella(ARCHIVO_PARCELAS),
        puntos: huella(ARCHIVO_PUNTOS)
    };

    if (guardar || !existeBase) {
        fs.writeFileSync(ARCHIVO_BASE, JSON.stringify({
            generado: new Date().toISOString(),
            origen: { parcelas: parcelas.length, puntos: puntos.length },
            huella: huellaActual,
            filas
        }), 'utf8');
        console.log(`\n  ${existeBase ? 'Línea base ACTUALIZADA' : 'Línea base CREADA'}: herramientas/linea-base.json`);
        if (!existeBase) {
            console.log('  Ya se puede refactorizar: volvé a correr este script y avisa si algo cambió.\n');
        } else {
            console.log('  Los resultados actuales pasan a ser la nueva referencia.\n');
        }
        process.exit(0);
    }

    const base = JSON.parse(fs.readFileSync(ARCHIVO_BASE, 'utf8'));

    // Si los datos de entrada cambiaron, esta comparación no mide el refactor:
    // mide el cambio de datos. Se corta acá en vez de reportar diferencias
    // engañosas.
    const hb = base.huella || {};
    if (hb.parcelas !== huellaActual.parcelas || hb.puntos !== huellaActual.puntos) {
        console.log('  ============================================================');
        console.log('   LOS DATOS DE ENTRADA CAMBIARON DESDE LA LÍNEA BASE');
        console.log('  ============================================================\n');
        console.log(`  parcelas: ${hb.parcelas || '(sin registrar)'} -> ${huellaActual.parcelas}`);
        console.log(`  puntos:   ${hb.puntos || '(sin registrar)'} -> ${huellaActual.puntos}\n`);
        console.log('  Con datos distintos, cualquier diferencia sería del DWG nuevo y no');
        console.log('  del código, así que no se compara. Para verificar un refactor:');
        console.log('    1. volver a los datos de la línea base, o');
        console.log('    2. fijar la referencia con los datos nuevos ANTES de tocar el código:');
        console.log('       node herramientas/verificar-equivalencia.js --guardar\n');
        process.exit(3);
    }

    const { dif, comparadas } = comparar(filas, base.filas);

    console.log(`\n  Línea base del ${base.generado}`);
    console.log(`  Datos verificados: misma huella que la línea base`);
    console.log(`  Parcelas comparadas: ${comparadas}\n`);

    if (dif.length === 0) {
        console.log('  ============================================================');
        console.log('   SIN CAMBIOS. El refactor no alteró ningún resultado.');
        console.log('  ============================================================\n');
        process.exit(0);
    }

    console.log('  ============================================================');
    console.log(`   ${dif.length} PARCELA(S) CAMBIARON DE RESULTADO`);
    console.log('  ============================================================\n');
    for (const d of dif.slice(0, 25)) {
        console.log(`  Parcela ${d.clave}`);
        console.log(`    antes: padrón=${d.antes.padronId}  nomencla=${d.antes.nomenclaturaId}  vía=${d.antes.via}`);
        console.log(`    ahora: padrón=${d.ahora.padronId}  nomencla=${d.ahora.nomenclaturaId}  vía=${d.ahora.via}`);
    }
    if (dif.length > 25) console.log(`\n  ... y ${dif.length - 25} más.`);
    console.log('\n  Si estos cambios son INTENCIONALES, fijar la nueva referencia con:');
    console.log('    node herramientas/verificar-equivalencia.js --guardar\n');
    process.exit(1);
}

main();
