# Actualizar el plano con parcelas nuevas

El plano de Merlo crece. Cada vez que Catastro incorpora parcelas, hay que
llevar esos polígonos al visor. Esta guía es ese procedimiento.

**Son tres pasos y una comprobación.** No hace falta saber programar: el único
cambio en el código es reemplazar un nombre de archivo, y está señalizado.

---

## Antes de empezar: qué tiene que traer el archivo

El visor dibuja las parcelas desde un archivo **GeoJSON**. De cada polígono
necesita exactamente dos datos:

| Campo | Para qué sirve | Si falta |
|---|---|---|
| `NRO_RENTA` | Es el padrón. Con él se busca todo lo demás en la base municipal. | La parcela se dibuja pero **al hacerle clic no trae nada** y nunca se pinta al filtrar. |
| `NOMENCLA` | Nomenclatura catastral (22 dígitos). Agrupa las parcelas por manzana. | La parcela funciona, pero **no resalta su manzana** al seleccionarla. |

> **El resto de los datos NO van en el archivo.** Superficie, titular, deuda,
> zonificación y estado de edificación salen de la base municipal, en vivo. El
> plano aporta únicamente la forma y estas dos claves. Agregar más campos al
> GeoJSON solo lo hace más pesado.

Y una condición que no se ve pero rompe todo:

> **El archivo tiene que estar en WGS84 (EPSG:4326).** El plano original está en
> POSGAR 98 / Argentina Zona 3 (EPSG:22173), que mide en metros. Si se exporta
> sin reproyectar, las coordenadas salen como números de seis o siete cifras y
> el plano no aparece en Merlo: aparece en medio del océano, o no aparece.
> En QGIS, al exportar, hay que elegir **SRC: EPSG:4326 – WGS 84**.

---

## Paso 1 — Revisar el archivo nuevo

**Antes de reemplazar nada.** Desde la carpeta del visor:

```bash
node herramientas/revisar-plano.js "C:\ruta\del\PlanoNuevo.json"
```

Informa cuántos polígonos trae y avisa de los problemas que después aparecen
como fallas raras del visor: polígonos sin padrón, padrones repetidos o mal
escritos, geometrías rotas, coordenadas fuera de Merlo.

Distingue dos niveles:

- **PROBLEMA** — conviene corregirlo en el origen (QGIS/ArcGIS) y volver a
  exportar. Son cosas que el operador va a ver como errores del programa.
- **AVISO** — no impide usar el archivo, pero vale la pena mirarlo.

Si además la computadora llega a la base municipal:

```bash
node herramientas/revisar-plano.js "C:\ruta\del\PlanoNuevo.json" --comparar
```

Esto agrega lo más útil de todo: **qué padrones existen en la base pero no
están dibujados**. Esas son exactamente las parcelas que después "no se pintan"
cuando alguien filtra. El listado completo queda en la carpeta `informes\`,
listo para pasárselo a quien dibuja el plano.

> La carpeta `informes\` no se sube a GitHub: tiene padrones reales del
> municipio. Se regenera corriendo la herramienta de nuevo.

---

## Paso 2 — Copiar el archivo

Copiar el GeoJSON nuevo a:

```
web\datos\
```

**No borrar el anterior todavía.** Si algo sale mal, volver atrás es cambiar el
nombre de vuelta. Recién cuando el plano nuevo esté confirmado conviene
limpiar.

---

## Paso 3 — Decirle al visor cuál usar

Abrir `web\js\app.js` y buscar el bloque **`ARCHIVOS DEL PLANO`** (está
señalizado con un encabezado grande). Ahí hay una lista como esta:

```js
const PLANO = {
    parcelas: {
        archivo: 'Merlo2026Parcelas-V1.json',
        ...
```

Cambiar el nombre por el del archivo nuevo. **Ese es el único lugar del
programa donde figura**, así que no hay nada más que tocar.

Si lo que se actualizó fue otra capa (manzanas, barrios, edificado), se cambia
la línea que corresponda de esa misma lista.

---

## Comprobación

1. Cerrar el visor y volver a abrirlo con `INICIAR.bat`.
2. En el navegador, abrir la consola con **F12** y mirar los mensajes del
   arranque. Tiene que decir algo como:

   ```
   ✅ polígonos de las parcelas: 17614 elementos — datos/Merlo2026Parcelas-V1.json
   ```

   Si dice **❌ Falta el archivo**, el nombre no coincide: revisar que esté bien
   escrito y que el archivo esté en `web\datos\`.

3. Buscar un padrón de los nuevos y confirmar que abre su ficha con datos.

> **Si no cambió nada**, casi siempre es que se está ejecutando otra copia del
> programa. La versión aparece abajo a la derecha del mapa: si no es la que
> esperabas, estás abriendo otra carpeta. Ver `docs/instalacion-en-la-muni.md`.

---

## Por qué algunas parcelas no se pintan al filtrar

Es la consulta más frecuente, y casi nunca es un error del programa.

Cuando se filtra, el visor le pregunta a la base qué parcelas cumplen los
criterios y después busca cada una en el plano para pintarla. Si una parcela
**está en la base pero no está dibujada**, no hay nada que pintar.

El visor ahora lo dice: debajo del panel de filtros aparece un cartel que
avisa cuántas parcelas de la lista no tienen polígono. Y en la consola (F12)
quedan los padrones concretos.

Para ver el panorama completo, el listado de todo lo que falta dibujar sale del
paso 1 con `--comparar`.

Hay una segunda causa posible, que el visor también avisa: si la búsqueda
encuentra más parcelas que el tope del servidor (5000 por defecto), solo llegan
las primeras. Ahí conviene achicar el rango del filtro. Ese tope se cambia en
`servidor\.env`, en `MAX_ROWS`.

---

## Nota sobre el tamaño

Los GeoJSON que entrega el software de catastro suelen traer muchos campos que
el visor no usa. `herramientas/optimizar-datos.js` los quita: en la última
pasada bajó de 46,6 MB a 19,4 MB **sin cambiar ningún resultado** (verificado
con `herramientas/comparar-datos.js`).

No es obligatorio, pero un plano más liviano abre más rápido, sobre todo en las
computadoras más viejas de la Municipalidad.
