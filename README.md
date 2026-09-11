# Plataforma MUNI — Sistema catastral de Villa de Merlo

Visor web de las parcelas de Villa de Merlo (San Luis) para la Municipalidad.
Mapa interactivo sobre Leaflet, con la ficha catastral de cada parcela
consultada en vivo contra la base municipal.

---

## Instalarlo en una computadora de la Municipalidad

**Dos doble clics, sin saber programar:**

1. Descargar el ZIP con el botón verde **Code → Download ZIP**
2. Descomprimirlo en una carpeta fija (por ejemplo `C:\VisorCatastral`)
3. Doble clic en **`INSTALAR.bat`** — una sola vez
4. Doble clic en **`INICIAR.bat`** — cada vez que se quiera usar

`INSTALAR.bat` verifica que esté Node.js, baja los componentes y abre una
ventana para cargar los datos de conexión —con la contraseña oculta y un botón
para probar la conexión antes de guardar, parecida al cuadro de conexión de SQL
Server Management Studio—. Al final prueba la conexión y dice el motivo si algo
falla.

`INICIAR.bat` levanta el visor y lo abre en el navegador.

`CONFIGURAR.bat` vuelve a abrir esa ventana para corregir el servidor, el
usuario o la contraseña sin reinstalar nada.

`ACTUALIZAR.bat` baja la última versión y la aplica **conservando la
configuración de la base y los componentes ya instalados**. Es la forma
recomendada de actualizar: bajar el ZIP y descomprimir a mano falla de maneras
que no se notan —se descomprime en otra carpeta, o Windows omite archivos al
reemplazar— y la computadora queda ejecutando la versión anterior sin que nadie
se dé cuenta.

`DIAGNOSTICO.bat` genera un informe con el estado real de la instalación:
versión, carpeta desde la que se ejecuta, si quedaron copias viejas del programa
en la computadora, qué contienen los archivos y si los servidores de mapas
responden desde esa red. **Cuando algo "sigue sin andar" después de actualizar,
correr esto primero.**

### Saber qué versión está corriendo

La versión figura **abajo a la derecha del mapa**, al lado del sistema de
coordenadas. También al arrancar el servidor, y en `/version` del puerto en el que esté
corriendo (el que anuncia la ventana negra, normalmente el 8001).

Si algo que ya se corrigió sigue fallando, lo primero es mirar ese número.

La guía completa, con los problemas frecuentes y qué hacer en cada caso, está en
**[docs/instalacion-en-la-muni.md](docs/instalacion-en-la-muni.md)**. Está
escrita para alguien que no programa.

> La computadora tiene que estar **en la red de la Municipalidad**. Si no, el
> mapa se ve igual pero las fichas salen sin datos: la base no es accesible
> desde afuera.

---

## Puesta en marcha a mano (desarrollo)

Equivale a lo que hace `INSTALAR.bat`, para quien prefiera la consola:

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

Abrir `http://localhost:` seguido del puerto que anuncia el servidor al
arrancar. El estado de la conexión se puede consultar en `/health`.

### Lo único que no viene en el repositorio

`servidor/.env`, porque tiene las credenciales de la base. Se crea a partir de
`servidor/.env.example`, o lo genera `INSTALAR.bat` preguntando los datos.

Los GeoJSON **sí** están (`web/datos/`, 19,4 MB optimizados): al descargar, el
mapa funciona enseguida.

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
INSTALAR.bat             instalación en un doble clic (una sola vez)
INICIAR.bat              arranca el visor y lo abre en el navegador
CONFIGURAR.bat           cambia los datos de conexión a la base
ACTUALIZAR.bat           baja la última versión conservando la configuración
DIAGNOSTICO.bat          informe del estado real de la instalación
VERSION.txt              versión del programa

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
  verificar-equivalencia.js   que un refactor no cambie ningún resultado
  verificar-funcionalidad.js  que no se haya perdido nada del programa original
  probar-conexion.js          diagnóstico de la base desde Node
  diagnostico.sql             el mismo diagnóstico para SSMS
  consultas-pendientes.sql    preguntas abiertas, para correr en la muni
  optimizar-datos.js          achica los GeoJSON del mes
  comparar-datos.js           verifica que optimizar no cambie nada
  revisar-plano.js            revisa un plano nuevo antes de ponerlo en uso
  linea-base.json             referencia del test de equivalencia

docs/                    documentación
  instalacion-en-la-muni.md   guía paso a paso para quien no programa
  actualizar-el-plano.md      cómo cargar parcelas nuevas en el visor
  conexion-con-la-base.md     qué campo sale de qué vista y qué falta confirmar
```

### Documentos que emite el visor

Desde la ficha de una parcela se imprimen dos documentos distintos, para
trámites distintos:

- **Plancheta catastral** — la ficha del inmueble con el plano de la parcela
  dentro de su manzana. Entra en una hoja.
- **Constancia de Libre de Deuda (Juzgado de Faltas)** — certifica que el
  titular no registra infracciones. Es solo texto, sin mapa, y su redacción
  sale de la plantilla `LIBRE__DEUDA__DE__FALTAS.docx` de la Municipalidad:
  **no se modifica**, porque es un documento con valor administrativo.

En los dos, los campos quedan editables antes de imprimir. En el libre de
deuda, el N° de ticket se completa a mano.

> Cuando la parcela tiene más de un titular, el libre de deuda se completa con
> el primero —está redactado en singular— y aparece un aviso **en pantalla, que
> no se imprime**, listando a todos, para que el agente corrija si corresponde.

### Actualizar el plano con parcelas nuevas

El procedimiento completo está en
**[docs/actualizar-el-plano.md](docs/actualizar-el-plano.md)**. En resumen son
tres pasos: revisar el archivo, copiarlo a `web/datos/` y cambiar su nombre en
el bloque `ARCHIVOS DEL PLANO` de `web/js/app.js`, que es el único lugar del
programa donde figuran esos nombres.

La revisión previa no es opcional:

```bash
node herramientas/revisar-plano.js "C:\ruta\PlanoNuevo.json"
node herramientas/revisar-plano.js "C:\ruta\PlanoNuevo.json" --comparar
```

Avisa de polígonos sin padrón, padrones repetidos o mal escritos, geometrías
rotas y archivos exportados en el sistema de coordenadas equivocado. Con
`--comparar` además dice **qué padrones existen en la base pero no están
dibujados**: son las parcelas que después "no se pintan" al filtrar.

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

Y para confirmar que no se perdió nada del programa original:

```bash
node herramientas/verificar-funcionalidad.js
```

Compara contra la copia del visor original que se conserva en `docs/` y avisa
si quedó algún botón llamando a una función que ya no existe, algún elemento
que el código busca y el HTML no tiene, o alguna capacidad que desapareció.
Ese tipo de rotura no se ve al abrir el visor: se ve el día que alguien aprieta
ese botón.

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

**Pendiente principal:** al hacer clic en una parcela, el sistema determina de
qué parcela se trata buscando el punto de nomenclatura más cercano, en lugar de
usar la clave que el propio polígono ya tiene como atributo.

Comparando ambos archivos: 9 parcelas reciben un padrón equivocado y **375
reciben una nomenclatura que apunta a otra parcela**. Como el titular se busca
por nomenclatura, en esas 375 la ficha podría estar mostrando el propietario
equivocado, sin ningún error visible.

**No está corregido a propósito.** Falta saber cuál de los dos archivos coincide
con la base: si es el polígono, el cambio arregla esas fichas; si es el punto,
las rompería. Lo resuelve una consulta de treinta segundos:

```
herramientas/consultas-pendientes.sql   (pregunta 1)
```

Ese archivo junta todas las preguntas que quedaron abiertas y que solo se pueden
responder desde una computadora de la Municipalidad.

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
