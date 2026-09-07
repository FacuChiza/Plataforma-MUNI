/* ============================================================================
   CONSULTAS PENDIENTES - para correr en una computadora de la Municipalidad
   ----------------------------------------------------------------------------
   Son las preguntas que quedaron abiertas y que no se pueden responder sin
   acceso a la base. Cada una decide algo concreto del sistema.

   CÓMO USARLO
     1. Abrir SQL Server Management Studio conectado al servidor municipal.
     2. Abrir este archivo (Archivo > Abrir > Archivo).
     3. Verificar que la base seleccionada arriba sea PROGRAM.
     4. Apretar Ctrl+T (resultados como texto, más fácil de copiar).
     5. F5 para ejecutar.
     6. Copiar todo el resultado y pasarlo.

   ESTE ARCHIVO NO MODIFICA NADA
     Son consultas SELECT sobre vistas y sobre el catálogo del sistema. No hay
     INSERT, UPDATE, DELETE, CREATE, ALTER ni DROP fuera de este comentario.
     Se puede ejecutar en producción y cancelar en cualquier momento.
   ============================================================================ */

USE PROGRAM;
GO


/* ############################################################################
   PREGUNTA 1  (la más importante)
   ############################################################################

   ¿La nomenclatura buena es la del POLÍGONO o la del PUNTO?

   Al hacer clic en una parcela, el visor busca el titular usando la
   nomenclatura del punto de etiqueta más cercano, no la del propio polígono.
   Comparando los dos archivos aparecieron 549 parcelas donde no coinciden, y
   en 375 de ellas la diferencia no es de formato: apuntan a otra parcela.

   Como el TITULAR se busca por nomenclatura, en esas 375 la ficha podría estar
   mostrando el propietario equivocado.

   Lo que decide cuál de los dos tiene razón es qué guarda la base. Estos cuatro
   padrones son casos donde polígono y punto discrepan:

       padrón        el polígono dice          el punto dice
       13-7749       PB05000828000012000000    PB05000828000013000000
       13-1044525    6502000002000080000000    PB02000002000080000000
       13-9253       6502000002000079000000    PB02000002000079000000
       13-1022972    6502000904000016000000    PB02000904000016000000

   Si la base devuelve lo mismo que el polígono -> hay que corregir el visor
   para que use la clave del polígono, y eso arregla unas 375 fichas.
   Si devuelve lo mismo que el punto -> el visor está bien como está y NO hay
   que tocar nada.
   -------------------------------------------------------------------------- */
SELECT
    '1. QUIEN TIENE RAZON'  AS pregunta,
    LTRIM(RTRIM(NRO_RENTA)) AS padron,
    LTRIM(RTRIM(NOMENCLA))  AS nomenclatura_en_la_base
FROM dbo.VI_GIS_CATASTRO_PADRON
WHERE LTRIM(RTRIM(NRO_RENTA)) IN ('13-7749', '13-1044525', '13-9253', '13-1022972')
ORDER BY padron;
GO


/* ############################################################################
   PREGUNTA 2
   ############################################################################

   ¿Qué formato de sección usa la base?

   Confirma lo anterior a lo grande. En el archivo de polígonos las secciones
   vienen de dos formas: numéricas (6502) y alfanuméricas (PB02). Los puntos
   usan la otra. Esta consulta muestra cuál de las dos usa realmente la base.

   Si aparecen 6502 y 6503 pero no PB02 ni PA03, el polígono es el correcto.
   -------------------------------------------------------------------------- */
SELECT
    '2. FORMATO DE SECCION' AS pregunta,
    LEFT(LTRIM(RTRIM(NOMENCLA)), 4) AS seccion,
    COUNT(*) AS parcelas
FROM dbo.VI_GIS_CATASTRO_PADRON
WHERE ACTIVO = 1
  AND NOMENCLA IS NOT NULL
GROUP BY LEFT(LTRIM(RTRIM(NOMENCLA)), 4)
ORDER BY seccion;
GO


/* ############################################################################
   PREGUNTA 3
   ############################################################################

   ¿Conviene cambiar ACTIVO = 1 por ACTIVO = '1'?

   ACTIVO es una columna de texto, pero todas las consultas la comparan contra
   un número. SQL Server lo resuelve solo, y por eso funciona, pero esa
   conversión puede estar impidiendo que use los índices y volviendo lentas las
   búsquedas sobre 19.950 filas.

   Esta consulta muestra qué valores tiene realmente la columna. Si son '1' y
   '0', el cambio es seguro y conviene hacerlo.
   -------------------------------------------------------------------------- */
SELECT
    '3. VALORES DE ACTIVO' AS pregunta,
    '[' + ISNULL(ACTIVO, 'NULO') + ']' AS valor_exacto,
    LEN(ACTIVO) AS largo,
    COUNT(*) AS parcelas
FROM dbo.VI_GIS_CATASTRO_PADRON
GROUP BY ACTIVO
ORDER BY parcelas DESC;
GO


/* ############################################################################
   PREGUNTA 4
   ############################################################################

   ¿La zonificación que muestra el visor es la que el municipio llama "zona"?

   El filtro de zonificación usa VI_CPAR_FRENTES.CONCEPTO, que es de donde el
   visor ya venía sacando ese dato. Esta consulta lista los valores que hay.

   Si lo que aparece NO son zonas (por ejemplo, si son conceptos de facturación
   o tipos de tasa), hay que apuntar el filtro a otra columna.
   -------------------------------------------------------------------------- */
SELECT TOP 30
    '4. ZONIFICACIONES' AS pregunta,
    LTRIM(RTRIM(CONCEPTO)) AS valor,
    COUNT(*) AS parcelas
FROM dbo.VI_CPAR_FRENTES
WHERE CONCEPTO IS NOT NULL AND LTRIM(RTRIM(CONCEPTO)) <> ''
GROUP BY LTRIM(RTRIM(CONCEPTO))
ORDER BY parcelas DESC;
GO


/* ############################################################################
   PREGUNTA 5
   ############################################################################

   ¿Cuántas parcelas tienen más de un frente?

   La zonificación se trae con TOP 1 para que una parcela con varios frentes no
   aparezca repetida en los filtros. Pero eso significa que se queda con uno
   cualquiera de ellos.

   Si son pocas, no importa. Si son muchas y tienen zonificaciones distintas
   (una esquina, por ejemplo), hay que decidir cuál se muestra.
   -------------------------------------------------------------------------- */
SELECT
    '5. FRENTES POR PARCELA' AS pregunta,
    frentes,
    COUNT(*) AS cantidad_de_parcelas
FROM (
    SELECT LTRIM(RTRIM(NRO_RENTAS)) AS padron, COUNT(*) AS frentes
    FROM dbo.VI_CPAR_FRENTES
    WHERE NRO_RENTAS IS NOT NULL
    GROUP BY LTRIM(RTRIM(NRO_RENTAS))
) t
GROUP BY frentes
ORDER BY frentes;
GO


/* ############################################################################
   PREGUNTA 6
   ############################################################################

   ¿Cuántas parcelas tienen más de una zonificación distinta?

   Complementa la anterior. Tener varios frentes no es problema si todos dicen
   lo mismo; el problema es cuando dicen cosas distintas y hay que elegir.
   -------------------------------------------------------------------------- */
SELECT
    '6. ZONIFICACIONES DISTINTAS' AS pregunta,
    zonas_distintas,
    COUNT(*) AS cantidad_de_parcelas
FROM (
    SELECT LTRIM(RTRIM(NRO_RENTAS)) AS padron,
           COUNT(DISTINCT LTRIM(RTRIM(CONCEPTO))) AS zonas_distintas
    FROM dbo.VI_CPAR_FRENTES
    WHERE NRO_RENTAS IS NOT NULL AND CONCEPTO IS NOT NULL
    GROUP BY LTRIM(RTRIM(NRO_RENTAS))
) t
GROUP BY zonas_distintas
ORDER BY zonas_distintas;
GO


/* ============================================================================
   FIN

   Con el resultado de la PREGUNTA 1 alcanza para decidir el cambio más
   importante que queda pendiente en el visor. Las demás son mejoras.
   ============================================================================ */
