# Qué depende de la base municipal y cómo conectarlo

Este documento existe porque buena parte del visor está **escrita y probada
contra datos simulados**, esperando la conexión a la base. Acá está qué toca la
base, qué falta hacer, y cómo verificar que quedó bien cuando la conexión
exista.

---

## La regla que ordena todo

> **La geometría sale de los archivos GeoJSON. Todo lo demás sale de la base.**

El GeoJSON de parcelas trae, por cada polígono, solamente dos datos:

```json
{"NOMENCLA": "PB05000836000003000000", "NRO_RENTA": "13-958934"}
```

La forma de la parcela, su número de renta y su nomenclatura. **Nada más.**

Ni superficie, ni titular, ni zonificación, ni estado de edificación. Todo eso
vive en la base municipal y el visor lo consulta en vivo. Por eso el mapa se ve
completo en Vercel pero las fichas salen vacías: la geometría está publicada, la
base no es accesible desde internet.

---

## Qué campo sale de dónde

| Dato | Origen | Vista |
|---|---|---|
| Forma de la parcela | GeoJSON | `web/datos/Merlo2026Parcelas-V1.json` |
| Nomenclatura, N.º de renta | GeoJSON | idem |
| **Superficie del terreno** | **base** | `VI_GIS_CATASTRO_PADRON.SUP_TER` |
| **Metros de frente** | **base** | `VI_GIS_CATASTRO_PADRON.MET_FRENTE` |
| **Estado (edificado/baldío)** | **base** | `VI_GIS_CATASTRO_PADRON.BAL_EDIF` |
| **Barrio, calle, altura** | **base** | `VI_GIS_CATASTRO_PADRON` |
| **Titulares** | **base** | `VI_CPAR_PROPIETARIOS` |
| **Zonificación** | **base** | `VI_CPAR_FRENTES.CONCEPTO` |
| **N.º de cuenta** | **base** | `VI_GIS_DEUDA.CUENTA` |

Los filtros por superficie, frente, estado, zona y barrio **dependen enteramente
de la base**: el visor no puede calcular ninguno de esos valores por su cuenta.

---

## Cómo funciona hoy, sin conexión

El servidor decide solo, en cada consulta:

```
¿Hay conexión a SQL Server?
├── SÍ  → consulta la base. El modo de prueba se ignora por completo.
└── NO  → ¿MODO_DEMO=true?
          ├── SÍ  → datos inventados + cabecera X-Datos-De-Prueba: true
          └── NO  → error 503
```

**No hay que cambiar nada de código para pasar de uno a otro.** En cuanto el
servidor pueda conectarse, empieza a usar la base sola.

### Cómo se nota que son datos de prueba

Nunca en silencio. Aparece en tres lugares:

- Cartel amarillo arriba de la ficha de parcela
- Franja roja **DOCUMENTO SIN VALIDEZ** cruzando la plancheta
- Aviso **DATOS DE PRUEBA** en el resumen de los filtros y en el título de la
  tabla de resultados

Los nombres inventados dicen "PRUEBA" y "DEMO" a propósito.

---

## Pasar a datos reales

### 1. En el servidor de la Municipalidad

```
MODO_DEMO=false
```

Con eso alcanza. Si la conexión falla, los endpoints devuelven 503 y el
problema se ve, en lugar de quedar tapado por datos inventados.

### 2. Verificar la conexión antes de levantar el visor

```bash
node herramientas/probar-conexion.js
```

Confirma las credenciales, que existan las cuatro vistas y que tengan las
columnas que el código espera. Si falta una columna, la ficha muestra ese campo
vacío **sin dar ningún error**: por eso conviene mirarlo.

### 3. Probar cada cosa que depende de la base

| Qué probar | Cómo | Qué tiene que pasar |
|---|---|---|
| Ficha | buscar un padrón conocido | trae titular, superficie y cuenta |
| Varios titulares | buscar una parcela en condominio | encabezado "TITULARES" con el número |
| Filtro simple | superficie 500 a 900 | devuelve parcelas y las pinta |
| Filtro combinado | superficie + baldío + barrio | los resultados cumplen las tres |
| Listas | abrir el panel de filtros | zonificación y barrio con valores reales |
| Plancheta | imprimir una ficha | sin la franja roja de prueba |

Si alguna búsqueda devuelve la lista vacía y estás seguro de que debería traer
algo, revisá primero el punto siguiente.

---

## Lo que hay que confirmar contra la base real

Estas son decisiones que tomé sin poder verificarlas. Ninguna rompe nada, pero
convendría revisarlas la primera vez:

### `ACTIVO` es texto, no número

Las consultas filtran con `WHERE p.ACTIVO = 1`, comparando una columna `char`
contra un número. SQL Server lo resuelve por conversión implícita y funciona
—de hecho es lo que ya hacía el sistema—, pero esa conversión **puede impedir
que use los índices** y volver lenta la consulta sobre 19.950 filas.

Lo correcto sería `WHERE p.ACTIVO = '1'`. No lo cambié porque no pude medir si
afecta los resultados, y con una base de producción prefiero que lo pruebe
alguien que pueda ver el impacto.

### La zonificación puede no ser lo que ustedes llaman "zona"

El filtro de zonificación usa `VI_CPAR_FRENTES.CONCEPTO`, que es de donde el
visor ya venía sacando ese dato. Si "zona" para el municipio es otra cosa, hay
que cambiar esa columna en `/api/filtrar` y en `/api/opciones`. Es una línea en
cada uno.

### Una parcela puede tener varios frentes

La zonificación se trae con `OUTER APPLY ... TOP 1` en lugar de `LEFT JOIN`
justamente por esto: con JOIN, una parcela con tres frentes aparecería tres
veces en los resultados. Con `TOP 1` aparece una sola vez, pero **se queda con
un frente cualquiera de los que tenga**. Si eso importa —por ejemplo, si una
esquina tiene dos zonificaciones distintas— hay que decidir cuál manda.

### Superficies vacías o no numéricas

`SUP_TER` es `money`, pero las consultas usan `TRY_CAST(... AS FLOAT)` por las
dudas. Una parcela con superficie nula simplemente no aparece en los filtros por
superficie. Es lo correcto, pero significa que **el total de un filtro no es
comparable contra el total del padrón**.

---

## Dónde está cada cosa en el código

| Qué | Archivo |
|---|---|
| Consultas a la base | `servidor/server.js` |
| Datos de prueba | `servidor/server.js`, funciones `*DePrueba` |
| Interruptor del modo prueba | `servidor/.env`, variable `MODO_DEMO` |
| Llamadas desde el visor | `web/js/app.js`, `aplicarFiltros` y `procesarParcela` |
| A qué servidor le pide | `web/js/config.js` |

---

## Y lo que falta para que funcione desde afuera

Que el visor publicado consulte la base requiere que la API corra dentro de la
red municipal y esté publicada con un túnel. Ver el README.

**Antes de publicar esa API hay que ponerle autenticación.** Hoy no tiene
ninguna: tal como está, cualquiera con la URL puede leer nombre, documento y
domicilio de los 26.048 titulares del padrón. Eso no es un detalle a resolver
después.
