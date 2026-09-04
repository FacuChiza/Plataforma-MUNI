#!/usr/bin/env node
/**
 * ============================================================================
 * DIAGNÓSTICO DE CONEXIÓN A LA BASE MUNICIPAL
 * ----------------------------------------------------------------------------
 * PARA QUÉ SIRVE
 *   Correr esto desde una máquina que esté DENTRO de la red municipal (o con
 *   VPN) para saber, de una sola pasada:
 *
 *     1. Si el servidor responde y las credenciales del .env son válidas.
 *     2. Si existen las 4 vistas que consulta /api/catastro.
 *     3. Qué columnas tiene cada una, para confirmar que el código pide lo que
 *        la base realmente ofrece.
 *     4. Si VI_CPAR_PROPIETARIOS tiene alguna columna de N.º de Renta.
 *
 *   El punto 4 es el importante para el proyecto. Hoy la ficha de una parcela
 *   se arma con DOS claves distintas: superficie, deuda y frentes se buscan por
 *   NRO_RENTA, pero el TITULAR se busca por NOMENCLATURA. Mientras eso siga
 *   así, un error en la nomenclatura le cuelga a una parcela el propietario de
 *   otra. Si esta vista tuviera NRO_RENTA, se puede unificar la consulta y el
 *   problema desaparece de raíz.
 *
 * USO
 *   node herramientas/probar-conexion.js
 *
 *   Lee la configuración de VISUALIZADOR/.env. No pide ni muestra la
 *   contraseña.
 *
 * SEGURIDAD
 *   Solo hace SELECT y lee metadatos del catálogo. No modifica, no crea y no
 *   borra nada. Las tablas de origen no se tocan (regla del proyecto).
 * ============================================================================
 */

'use strict';

const path = require('path');
const fs = require('fs');

const DIR_APP = path.join(__dirname, '..', 'VISUALIZADOR');
require('dotenv').config({ path: path.join(DIR_APP, '.env') });

let sql;
try {
    sql = require(path.join(DIR_APP, 'node_modules', 'mssql'));
} catch (e) {
    console.error('\n  ERROR: no se encontró el paquete mssql.');
    console.error('  Instalar las dependencias primero:\n');
    console.error('    cd VISUALIZADOR && npm install\n');
    process.exit(2);
}

// Las 4 vistas que consulta /api/catastro, y las columnas que el código espera
// de cada una. Si algo de esto cambia en la base, la ficha se rompe en
// silencio: los campos aparecen vacíos sin ningún error.
const VISTAS = {
    'VI_GIS_CATASTRO_PADRON': ['NOMENCLA', 'ACTIVO', 'NRO_RENTA', 'CALLE', 'NRO', 'BARRIO', 'ESQ_MED', 'SUP_TER', 'DESIG_OFI', 'BAL_EDIF', 'MET_FRENTE'],
    'VI_CPAR_PROPIETARIOS':   ['APELLIDO', 'NOMBRE', 'CALLE', 'NUMERACION_CALLE', 'BARRIO', 'CODIGO_POSTAL_REAL', 'PROVINCIA', 'NOMENCLATURA'],
    'VI_CPAR_FRENTES':        ['CONCEPTO', 'NRO_RENTAS'],
    'VI_GIS_DEUDA':           ['CUENTA', 'NRO_RENTA', 'TBIEN']
};

function seccion(titulo) {
    console.log('\n  ' + titulo);
    console.log('  ' + '-'.repeat(titulo.length));
}

async function main() {
    console.log('\n  DIAGNÓSTICO DE CONEXIÓN - BASE MUNICIPAL');
    console.log('  ============================================================');

    const faltantes = ['DB_USER', 'DB_PASSWORD', 'DB_SERVER', 'DB_DATABASE']
        .filter((v) => !process.env[v]);
    if (faltantes.length) {
        console.error(`\n  Faltan variables en el .env: ${faltantes.join(', ')}`);
        console.error(`  Ruta esperada del archivo: ${path.join(DIR_APP, '.env')}\n`);
        process.exit(2);
    }

    console.log(`\n  Servidor : ${process.env.DB_SERVER}`);
    console.log(`  Base     : ${process.env.DB_DATABASE}`);
    console.log(`  Usuario  : ${process.env.DB_USER}`);
    console.log(`  Cifrado  : ${process.env.DB_ENCRYPT === 'true' ? 'sí' : 'no'}`);

    const config = {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        server: process.env.DB_SERVER,
        database: process.env.DB_DATABASE,
        connectionTimeout: 15000,
        requestTimeout: 60000,
        options: {
            encrypt: process.env.DB_ENCRYPT === 'true',
            trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
        }
    };

    let pool;
    try {
        console.log('\n  Conectando...');
        pool = await new sql.ConnectionPool(config).connect();
        console.log('  ✅ CONECTADO');
    } catch (err) {
        console.error('\n  ❌ NO SE PUDO CONECTAR');
        console.error(`     ${err.message}\n`);

        const m = String(err.message || '');
        if (m.includes('ENOTFOUND') || m.includes('getaddrinfo')) {
            console.error('  El nombre del servidor no se resuelve. Esta máquina no está en');
            console.error('  la red municipal, o el nombre cambió. Probar con la IP directa');
            console.error('  en DB_SERVER, o conectarse por VPN.');
        } else if (m.includes('Login failed')) {
            console.error('  El servidor responde pero rechaza el usuario o la contraseña.');
            console.error('  Verificar DB_USER y DB_PASSWORD, y que el login esté habilitado.');
        } else if (m.includes('ETIMEOUT') || m.includes('timeout')) {
            console.error('  El nombre resuelve pero no hay respuesta en el puerto 1433.');
            console.error('  Puede ser el firewall, o que SQL Server no acepte TCP/IP.');
        }
        console.error('');
        process.exit(1);
    }

    try {
        // ---- Identidad del servidor ----
        seccion('SERVIDOR');
        const info = await pool.request().query(`
            SELECT
                @@VERSION            AS version,
                DB_NAME()            AS base,
                SUSER_SNAME()        AS login_actual,
                GETDATE()            AS ahora
        `);
        const fila = info.recordset[0];
        console.log(`  ${String(fila.version).split('\n')[0].trim()}`);
        console.log(`  Base conectada: ${fila.base}   Login: ${fila.login_actual}`);

        // ---- Vistas y columnas ----
        seccion('VISTAS QUE USA EL VISOR');

        for (const [vista, esperadas] of Object.entries(VISTAS)) {
            const r = await pool.request()
                .input('v', sql.VarChar, vista)
                .query(`
                    SELECT COLUMN_NAME, DATA_TYPE
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME = @v
                    ORDER BY ORDINAL_POSITION
                `);

            if (r.recordset.length === 0) {
                console.log(`\n  ❌ ${vista} — NO EXISTE o el usuario no tiene permiso`);
                continue;
            }

            const columnas = r.recordset.map((c) => c.COLUMN_NAME);
            const faltan = esperadas.filter((c) => !columnas.includes(c));

            console.log(`\n  ${faltan.length === 0 ? '✅' : '⚠️ '} ${vista} — ${columnas.length} columnas`);
            if (faltan.length) {
                console.log(`     FALTAN columnas que el código usa: ${faltan.join(', ')}`);
                console.log('     La ficha va a mostrar esos campos vacíos, sin error.');
            }

            // Conteo, útil para dimensionar
            try {
                const c = await pool.request().query(`SELECT COUNT(*) AS n FROM PROGRAM.dbo.${vista}`);
                console.log(`     Filas: ${c.recordset[0].n.toLocaleString('es-AR')}`);
            } catch (e) {
                console.log('     Filas: (no se pudo contar)');
            }

            console.log(`     Columnas: ${columnas.join(', ')}`);
        }

        // ---- LA PREGUNTA CLAVE DEL PROYECTO ----
        seccion('¿SE PUEDE UNIFICAR LA CLAVE DEL TITULAR?');
        console.log('  Hoy el titular se busca por NOMENCLATURA y el resto de la ficha');
        console.log('  por NRO_RENTA. Si esta vista tuviera el N.º de Renta, se puede');
        console.log('  consultar todo por la misma clave y se elimina esa fuente de error.\n');

        const cand = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'VI_CPAR_PROPIETARIOS'
              AND (COLUMN_NAME LIKE '%RENTA%' OR COLUMN_NAME LIKE '%PADRON%' OR COLUMN_NAME LIKE '%CUENTA%')
            ORDER BY COLUMN_NAME
        `);

        if (cand.recordset.length === 0) {
            console.log('  ❌ VI_CPAR_PROPIETARIOS no tiene ninguna columna de renta/padrón.');
            console.log('     La nomenclatura sigue siendo el único vínculo con el titular.');
            console.log('     Habría que pedirle a Rentas/Catastro una vista que lo incluya.');
        } else {
            console.log('  ✅ Hay columnas candidatas para unificar la clave:');
            for (const c of cand.recordset) {
                console.log(`       ${c.COLUMN_NAME}  (${c.DATA_TYPE})`);
            }
            console.log('\n     Si alguna está poblada y es confiable, se puede cambiar la');
            console.log('     consulta del titular para que use NRO_RENTA como las demás.');
        }

        // ---- Prueba real de una parcela ----
        seccion('PRUEBA CON UNA PARCELA REAL');
        const muestra = await pool.request().query(`
            SELECT TOP 1
                LTRIM(RTRIM(NRO_RENTA)) AS NRO_RENTA,
                LTRIM(RTRIM(NOMENCLA))  AS NOMENCLA
            FROM PROGRAM.dbo.VI_GIS_CATASTRO_PADRON
            WHERE ACTIVO = 1 AND NRO_RENTA IS NOT NULL AND NOMENCLA IS NOT NULL
        `);

        if (muestra.recordset.length === 0) {
            console.log('  No se encontró ninguna parcela activa para probar.');
        } else {
            const { NRO_RENTA, NOMENCLA } = muestra.recordset[0];
            console.log(`  Padrón ${NRO_RENTA}   Nomenclatura ${NOMENCLA}`);

            const prop = await pool.request()
                .input('nomenclatura', sql.VarChar, NOMENCLA)
                .query(`SELECT TOP 1 APELLIDO, NOMBRE FROM PROGRAM.dbo.VI_CPAR_PROPIETARIOS WHERE LTRIM(RTRIM(NOMENCLATURA)) = @nomenclatura`);

            if (prop.recordset.length === 0) {
                console.log('  ⚠️  Esa nomenclatura no devuelve titular en VI_CPAR_PROPIETARIOS.');
                console.log('     Puede ser normal (parcela municipal, sin titular cargado) o');
                console.log('     indicar que el formato de nomenclatura no coincide entre vistas.');
            } else {
                const t = prop.recordset[0];
                const nombre = [t.APELLIDO, t.NOMBRE].filter(Boolean).join(' ').trim();
                console.log(`  ✅ Titular encontrado por nomenclatura: ${nombre ? '(dato presente)' : '(vacío)'}`);
                console.log('     (no se imprime el nombre: son datos personales)');
            }
        }

        console.log('\n  ============================================================');
        console.log('   Diagnóstico terminado.\n');

    } catch (err) {
        console.error('\n  Error durante el diagnóstico:', err.message, '\n');
        process.exitCode = 1;
    } finally {
        await pool.close();
    }
}

main();
