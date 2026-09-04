/* ============================================================================
   DIAGNÓSTICO DE LA BASE MUNICIPAL - Villa de Merlo
   ----------------------------------------------------------------------------
   CÓMO USARLO
     1. Abrir SQL Server Management Studio conectado a NTVMERLO.
     2. Abrir este archivo (Archivo > Abrir > Archivo, o copiar y pegar).
     3. Verificar arriba a la derecha que la base seleccionada sea PROGRAM.
     4. Ejecutar (F5).
     5. Copiar los resultados de las 6 grillas y pasarlos.

   ESTE SCRIPT NO MODIFICA NADA
     Son todas consultas SELECT sobre vistas y sobre el catálogo del sistema.
     No hay INSERT, UPDATE, DELETE, CREATE, ALTER ni DROP. No crea objetos, no
     cambia configuración y no bloquea tablas. Se puede ejecutar en producción
     sin riesgo, y se puede cancelar en cualquier momento sin dejar nada a
     medias.

     Si querés confirmarlo por tu cuenta: buscá en este archivo las palabras
     INSERT, UPDATE, DELETE, DROP o ALTER. No aparecen fuera de este comentario.
   ============================================================================ */

USE PROGRAM;
GO

/* ----------------------------------------------------------------------------
   1. IDENTIDAD DEL SERVIDOR
   Para qué: confirmar IP y puerto reales, y la versión de SQL Server (define
   qué opciones de geometría y de cifrado están disponibles más adelante).
   ---------------------------------------------------------------------------- */
SELECT
    '1. SERVIDOR'                            AS bloque,
    CONNECTIONPROPERTY('local_net_address')  AS ip_del_servidor,
    CONNECTIONPROPERTY('local_tcp_port')     AS puerto,
    CONNECTIONPROPERTY('client_net_address') AS ip_de_tu_maquina,
    @@SERVERNAME                             AS nombre_servidor,
    SERVERPROPERTY('InstanceName')           AS instancia,
    SERVERPROPERTY('ProductVersion')         AS version,
    SERVERPROPERTY('Edition')                AS edicion,
    DB_NAME()                                AS base_actual,
    SUSER_SNAME()                            AS login_actual;
GO

/* ----------------------------------------------------------------------------
   2. ¿EXISTEN LAS VISTAS QUE USA EL VISOR?
   Para qué: si alguna falta o cambió de nombre, la ficha de la parcela muestra
   los campos vacíos SIN dar ningún error. Es una falla silenciosa.
   ---------------------------------------------------------------------------- */
SELECT
    '2. VISTAS' AS bloque,
    v.nombre    AS vista_esperada,
    CASE WHEN o.object_id IS NULL THEN 'NO EXISTE / SIN PERMISO' ELSE 'OK' END AS estado,
    o.type_desc AS tipo
FROM (VALUES
        ('VI_GIS_CATASTRO_PADRON'),
        ('VI_CPAR_PROPIETARIOS'),
        ('VI_CPAR_FRENTES'),
        ('VI_GIS_DEUDA')
     ) AS v(nombre)
LEFT JOIN sys.objects o
       ON o.name = v.nombre
      AND o.schema_id = SCHEMA_ID('dbo')
ORDER BY v.nombre;
GO

/* ----------------------------------------------------------------------------
   3. COLUMNAS DE CADA VISTA
   Para qué: comparar contra las columnas que el código realmente pide, y
   detectar renombres o tipos inesperados.
   ---------------------------------------------------------------------------- */
SELECT
    '3. COLUMNAS' AS bloque,
    TABLE_NAME    AS vista,
    ORDINAL_POSITION AS orden,
    COLUMN_NAME   AS columna,
    DATA_TYPE     AS tipo,
    CHARACTER_MAXIMUM_LENGTH AS largo,
    IS_NULLABLE   AS admite_nulos
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN (
        'VI_GIS_CATASTRO_PADRON',
        'VI_CPAR_PROPIETARIOS',
        'VI_CPAR_FRENTES',
        'VI_GIS_DEUDA')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
GO

/* ----------------------------------------------------------------------------
   4. LA PREGUNTA CLAVE DEL PROYECTO
   ----------------------------------------------------------------------------
   Hoy la ficha de una parcela se arma con DOS claves distintas:

       superficie, deuda y frentes  ->  se buscan por NRO_RENTA
       EL TITULAR                   ->  se busca por NOMENCLATURA

   Esa asimetría es la raíz del problema de integridad: si la nomenclatura que
   llega es la equivocada, la parcela muestra el propietario de otra, y no
   aparece ningún error.

   Si VI_CPAR_PROPIETARIOS tuviera el número de renta, se puede consultar todo
   por la misma clave y el problema desaparece de raíz.
   ---------------------------------------------------------------------------- */
SELECT
    '4. CLAVE DEL TITULAR' AS bloque,
    COLUMN_NAME AS columna_candidata,
    DATA_TYPE   AS tipo
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'VI_CPAR_PROPIETARIOS'
  AND (COLUMN_NAME LIKE '%RENTA%'
    OR COLUMN_NAME LIKE '%PADRON%'
    OR COLUMN_NAME LIKE '%CUENTA%'
    OR COLUMN_NAME LIKE '%NOMENCLA%')
ORDER BY COLUMN_NAME;
GO

/* ----------------------------------------------------------------------------
   5. VOLUMEN DE CADA VISTA
   Para qué: dimensionar. No se usa para validar nada: la cantidad de parcelas
   cambia todo el tiempo por loteos y subdivisiones, y eso es normal.
   ---------------------------------------------------------------------------- */
SELECT '5. VOLUMEN' AS bloque, 'VI_GIS_CATASTRO_PADRON' AS vista, COUNT(*) AS filas,
       SUM(CASE WHEN ACTIVO = 1 THEN 1 ELSE 0 END) AS activas
FROM dbo.VI_GIS_CATASTRO_PADRON
UNION ALL
SELECT '5. VOLUMEN', 'VI_CPAR_PROPIETARIOS', COUNT(*), NULL FROM dbo.VI_CPAR_PROPIETARIOS
UNION ALL
SELECT '5. VOLUMEN', 'VI_CPAR_FRENTES',      COUNT(*), NULL FROM dbo.VI_CPAR_FRENTES
UNION ALL
SELECT '5. VOLUMEN', 'VI_GIS_DEUDA',         COUNT(*), NULL FROM dbo.VI_GIS_DEUDA;
GO

/* ----------------------------------------------------------------------------
   6. ¿CUÁNTAS PARCELAS SE QUEDAN SIN TITULAR?
   ----------------------------------------------------------------------------
   Mide qué tan bien funciona hoy el vínculo por nomenclatura: de las parcelas
   activas, cuántas encuentran titular y cuántas no.

   No devuelve ningún nombre ni dato personal, solo cantidades.
   ---------------------------------------------------------------------------- */
SELECT
    '6. VÍNCULO TITULAR' AS bloque,
    COUNT(*) AS parcelas_activas,
    SUM(CASE WHEN pr.NOMENCLATURA IS NOT NULL THEN 1 ELSE 0 END) AS con_titular,
    SUM(CASE WHEN pr.NOMENCLATURA IS NULL     THEN 1 ELSE 0 END) AS sin_titular
FROM dbo.VI_GIS_CATASTRO_PADRON pa
LEFT JOIN (
        SELECT DISTINCT LTRIM(RTRIM(NOMENCLATURA)) AS NOMENCLATURA
        FROM dbo.VI_CPAR_PROPIETARIOS
        WHERE NOMENCLATURA IS NOT NULL
     ) pr
       ON pr.NOMENCLATURA = LTRIM(RTRIM(pa.NOMENCLA))
WHERE pa.ACTIVO = 1;
GO
