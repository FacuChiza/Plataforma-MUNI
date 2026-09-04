/* ============================================================================
   DIAGNÓSTICO RÁPIDO - copiar, pegar en SSMS y ejecutar (F5)
   ----------------------------------------------------------------------------
   Versión corta del diagnóstico, pensada para copiar el resultado y mandarlo.
   Devuelve 4 grillas cortas en vez de 6 largas.

   SOLO LECTURA: son consultas SELECT sobre vistas y sobre el catálogo del
   sistema. No modifica, no crea y no borra nada.

   ANTES DE EJECUTAR: verificar que arriba a la izquierda diga PROGRAM.
   RECOMENDADO: apretar Ctrl+T antes de F5 para que el resultado salga como
   texto plano, mucho más fácil de copiar y pegar.
   ============================================================================ */

USE PROGRAM;
GO

/* --- 1) Servidor: IP real y puerto -------------------------------------- */
SELECT
    CONNECTIONPROPERTY('local_net_address')  AS ip_servidor,
    CONNECTIONPROPERTY('local_tcp_port')     AS puerto,
    CONNECTIONPROPERTY('client_net_address') AS ip_cliente,
    @@SERVERNAME                             AS servidor,
    SERVERPROPERTY('ProductVersion')         AS version;
GO

/* --- 2) ¿Existen las 4 vistas y cuántas filas tienen? ------------------- */
SELECT 'VI_GIS_CATASTRO_PADRON' AS vista, COUNT(*) AS filas FROM dbo.VI_GIS_CATASTRO_PADRON
UNION ALL SELECT 'VI_CPAR_PROPIETARIOS', COUNT(*) FROM dbo.VI_CPAR_PROPIETARIOS
UNION ALL SELECT 'VI_CPAR_FRENTES',      COUNT(*) FROM dbo.VI_CPAR_FRENTES
UNION ALL SELECT 'VI_GIS_DEUDA',         COUNT(*) FROM dbo.VI_GIS_DEUDA;
GO

/* --- 3) LA PREGUNTA CLAVE ------------------------------------------------
   ¿La vista de propietarios tiene alguna columna de renta o padrón?
   Si la tiene, el titular se puede buscar por la misma clave que el resto de
   la ficha y desaparece la causa de fondo del problema de integridad.
   -------------------------------------------------------------------------- */
SELECT COLUMN_NAME AS columna, DATA_TYPE AS tipo
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'VI_CPAR_PROPIETARIOS'
ORDER BY ORDINAL_POSITION;
GO

/* --- 4) ¿Cuántas parcelas se quedan hoy sin titular? --------------------
   No devuelve ningún nombre ni dato personal, solo cantidades.
   -------------------------------------------------------------------------- */
SELECT
    COUNT(*) AS parcelas_activas,
    SUM(CASE WHEN pr.NOMENCLATURA IS NOT NULL THEN 1 ELSE 0 END) AS con_titular,
    SUM(CASE WHEN pr.NOMENCLATURA IS NULL     THEN 1 ELSE 0 END) AS sin_titular
FROM dbo.VI_GIS_CATASTRO_PADRON pa
LEFT JOIN (
        SELECT DISTINCT LTRIM(RTRIM(NOMENCLATURA)) AS NOMENCLATURA
        FROM dbo.VI_CPAR_PROPIETARIOS
        WHERE NOMENCLATURA IS NOT NULL
     ) pr ON pr.NOMENCLATURA = LTRIM(RTRIM(pa.NOMENCLA))
WHERE pa.ACTIVO = 1;
GO
