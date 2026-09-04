# Plataforma MUNI — Sistema catastral de Villa de Merlo

Visor web de las parcelas de Villa de Merlo (San Luis) para la Municipalidad.
Mapa interactivo sobre Leaflet, con la ficha catastral de cada parcela
consultada en vivo contra la base municipal.

---

## ⚠️ Lo único que NO está en este repositorio

| Falta | Dónde conseguirlo | Sin eso |
|---|---|---|
| `servidor/.env` | crearlo a partir de `servidor/.env.example` | las fichas salen sin datos de titular |

No se versiona porque tiene las credenciales de la base municipal.

Los GeoJSON **sí** están (`web/datos/`, 19,4 MB optimizados), así que al clonar
el mapa funciona enseguida. Lo que no funciona sin `.env` y sin estar en la red
municipal es la consulta de titulares y superficies.

---

## Puesta en marcha

```bash
cd servidor
npm install
```

Copiar `.env.example` como `.env` y completar los datos de conexión.

Probar la conexión **antes** de levantar el servidor:

```bash
node herramientas/probar-conexion.js
```

Ese script dice exactamente qué falla si algo falla: si no resuelve el nombre
del servidor, si rechaza las credenciales, o si falta alguna de las vistas que
el visor consulta.

Levantar:

```bash
cd servidor
node server.js
```

Abrir <http://localhost:8000>. El estado de la conexión se puede consultar en
`/health`.

En el servidor municipal corre con PM2:

```bash
pm2 restart sig-merlo
```

---

## Trabajar sin acceso a la base

La base municipal solo es alcanzable desde la red de la Municipalidad. Para
desarrollar desde afuera, poner en el `.env`:

```
MODO_DEMO=true
```

Con eso, y **solo** cuando no hay conexión, las fichas responden con datos
inventados. Salen marcadas con un cartel amarillo en pantalla y una franja roja
"DOCUMENTO SIN VALIDEZ" impresa en la plancheta, para que no se confundan con
datos reales. Si hay conexión a SQL Server, la variable se ignora.

Dejar en `false` en el servidor.

---

## Estructura

```
web/                     frontend — es lo que se publica
  index.html             maquetado del visor
  css/app.css            estilos
  js/config.js           a qué servidor le pide los datos
  js/app.js              lógica del mapa, la ficha y la plancheta
  img/                   escudo y miniaturas de los mapas base
  datos/                 GeoJSON (no versionados)

servidor/                backend — corre dentro de la red municipal
  server.js              API Express + conexión a SQL Server
  .env                   credenciales (no versionado)
  .env.example           plantilla

herramientas/            diagnóstico y verificación
  verificar-equivalencia.js   red de seguridad para refactorizar
  probar-conexion.js          diagnóstico de la base desde Node
  diagnostico.sql             el mismo diagnóstico para SSMS
  linea-base.json             referencia del test de equivalencia

docs/                    documentación y material de referencia
```

### Actualizar los datos del mes

Cuando llega un DWG nuevo y se exportan los GeoJSON, conviene pasarlos por el
optimizador antes de reemplazarlos: quedan un 58% más livianos sin perder nada.

```bash
node herramientas/optimizar-datos.js
node herramientas/comparar-datos.js        # verifica que no cambie ningún resultado
node herramientas/optimizar-datos.js --reemplazar
node herramientas/verificar-equivalencia.js --guardar
```

Frontend y backend están separados a propósito: `web/` se puede publicar por
su cuenta apuntando a la API que corre en la Municipalidad. El único archivo
que cambia entre un entorno y otro es `web/js/config.js`.

---

## Antes de cambiar `app.js`

El vínculo entre cada polígono y sus datos es la parte delicada del sistema.
Hay una red de seguridad para no romperlo sin darse cuenta:

```bash
node herramientas/verificar-equivalencia.js
```

Resuelve las 17.614 parcelas y compara contra una línea base registrada. Si
dice `SIN CAMBIOS`, el cambio no alteró ningún resultado. Si algo cambió, dice
en qué parcela y en qué difiere.

Para verificar el código que realmente corre en el navegador (no la copia del
script), el encabezado de ese archivo explica el procedimiento con `--hash`.

---

## Estado y pendientes

**Funcionando:** mapa con las parcelas, búsqueda por padrón, ficha catastral con
todos los titulares, plancheta imprimible, filtros por superficie y edificación.

**Publicado en Vercel:** <https://plataforma-muni.vercel.app> — se despliega solo
en cada push a `main`. Ahí el mapa funciona, pero las fichas salen sin titular:
Vercel está en internet y la base municipal es una red privada. Para que
funcionen hace falta que la API corra en una máquina de la Municipalidad
publicada con un túnel, y apuntar `web/js/config.js` a esa dirección. **Antes de
publicar la API hay que ponerle autenticación**: tal como está, cualquiera con
la URL podría leer los datos de todos los titulares del padrón.

**Pendiente principal:** al hacer clic en una parcela, el sistema todavía
determina de qué parcela se trata buscando el punto de nomenclatura más cercano,
en lugar de usar el `NRO_RENTA` que el propio polígono ya tiene como atributo.
Eso hace que 9 parcelas muestren hoy los datos de una parcela vecina, sin ningún
error visible. Corregirlo es el próximo paso.

---

## Base de datos

SQL Server, acceso de **solo lectura** sobre cuatro vistas:

- `VI_GIS_CATASTRO_PADRON` — datos de la parcela
- `VI_CPAR_PROPIETARIOS` — titulares (varios por parcela)
- `VI_CPAR_FRENTES` — zonificación
- `VI_GIS_DEUDA` — número de cuenta

Es un sistema contratado a un proveedor: las tablas no se modifican, solo se
consultan.

Los datos de conexión (nombre del servidor, IP, versión, credenciales) no se
documentan acá: este repositorio es público y esa información solo sirve para
que alguien de afuera arme un mapa de la red municipal. Están en el `.env` del
servidor, que no se versiona.
