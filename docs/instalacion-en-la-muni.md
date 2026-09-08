# Instalar el visor catastral en una computadora de la Municipalidad

Guía para poner el visor a funcionar en un equipo de la Municipalidad. No hace
falta saber programar: son cuatro pasos y dos doble clics.

**Requisito:** la computadora tiene que estar en la red de la Municipalidad,
la misma desde donde se accede al sistema de catastro. Sin eso el mapa se ve,
pero las fichas de las parcelas salen sin datos.

---

## 1. Descargar el programa

Entrar a <https://github.com/FacuChiza/Plataforma-MUNI>

Botón verde **Code** → **Download ZIP**.

Se baja un archivo de unos 60 MB.

## 2. Descomprimir

Clic derecho sobre el ZIP → **Extraer todo**.

Conviene dejar la carpeta en un lugar fijo y fácil de encontrar, por ejemplo
`C:\VisorCatastral`. **No dejarla en Descargas**: si alguien vacía esa carpeta,
se borra el programa.

## 3. Instalar (una sola vez)

Entrar a la carpeta y hacer doble clic en:

```
INSTALAR.bat
```

Se abre una ventana negra que va contando los pasos. Va a:

1. Verificar que Node.js esté instalado
2. Descargar los componentes que el visor necesita
3. Pedir los datos de conexión a la base
4. Probar que la conexión funcione

Cuando llegue el paso 3 se abre una ventana con cuatro campos:

- **Nombre del servidor** — el equipo donde está la base, o su IP
- **Nombre de la base**
- **Nombre de usuario**
- **Contraseña** — se escribe oculta

El botón **Probar conexión** verifica los datos antes de guardar y dice qué
falla si algo falla. Después, **Guardar**.

Si no tenés esos datos, apretá Cancelar y pedíselos a quien administre el
sistema de catastro. Se cargan una sola vez y quedan guardados.

### Si dice que falta Node.js

Es un programa gratuito que el visor necesita. Se baja de <https://nodejs.org>,
se elige la versión que dice **LTS**, y se instala aceptando todas las opciones
por defecto. Después se vuelve a ejecutar `INSTALAR.bat`.

### Si dice que no pudo instalar los componentes

Casi siempre es que la computadora no tiene salida a internet. Esos componentes
se bajan **una sola vez**; después el visor funciona sin internet, solamente con
la red interna.

Si el equipo no va a tener internet nunca, hay que copiar la carpeta
`servidor\node_modules` desde otra computadora donde sí se haya podido
instalar.

## 4. Usar el visor

Doble clic en:

```
INICIAR.bat
```

Se abre una ventana negra y, unos segundos después, el visor en el navegador.

> **La ventana negra tiene que quedar abierta.** Es el programa funcionando. Si
> se cierra, el visor deja de andar. Se puede minimizar sin problema.

Para cerrar el visor: cerrar esa ventana.

### Acceso directo en el escritorio

Para no tener que buscar la carpeta cada vez: clic derecho sobre `INICIAR.bat`
→ **Enviar a** → **Escritorio (crear acceso directo)**.

---

## Cómo saber si está funcionando bien

Buscar un padrón conocido y abrir su ficha:

- **Trae titular, superficie y número de cuenta** → funciona correctamente
- **Los campos dicen "sin dato"** → el mapa anda pero no llega a la base
- **Aparece un cartel amarillo "DATOS DE PRUEBA"** → está mostrando datos
  inventados; ver más abajo

Otra forma: entrar a <http://localhost:8000/health>. Tiene que decir
`"database": "connected"`.

---

## Problemas frecuentes

### "Los campos de la ficha salen vacíos"

El visor no está llegando a la base. Doble clic en **`CONFIGURAR.bat`**: se
abre la misma ventana de los datos de conexión, con lo que está cargado hoy, y
el botón **Probar conexión** dice exactamente qué falla. Los dos motivos más
comunes:

- la computadora no está en la red de la Municipalidad
- el usuario o la contraseña quedaron mal cargados

### "Aparece un cartel amarillo de datos de prueba"

El archivo `servidor\.env` tiene `MODO_DEMO=true`. Eso hace que el visor
invente datos cuando no puede conectarse, y sirve solo para pruebas.

En una computadora de la Municipalidad tiene que decir:

```
MODO_DEMO=false
```

Se corrige abriendo `servidor\.env` con el Bloc de notas. Si la configuración
se guardó desde `CONFIGURAR.bat`, ya queda en `false`.

Así, si algo falla, se nota, en lugar de quedar tapado por datos falsos.

### "Dice que el puerto 8000 está ocupado"

El visor ya está abierto en otra ventana. Buscarla en la barra de tareas, o
cerrar todas las ventanas negras y volver a empezar.

### "El navegador no se abre solo"

Abrirlo a mano y entrar a <http://localhost:8000>.

---

## Actualizar a una versión nueva

Cuando haya cambios, repetir los pasos 1 y 2 sobre una carpeta nueva, y después:

1. Copiar el archivo `servidor\.env` de la instalación vieja a la nueva
   (así no hay que cargar de nuevo los datos de conexión; si no aparece, está
   oculto: activar "Elementos ocultos" en la pestaña Vista del explorador)
2. Ejecutar `INSTALAR.bat` en la carpeta nueva
3. Comprobar que funcione y recién ahí borrar la carpeta vieja

---

## Qué NO hace este visor

Conviene que quede claro para no esperar de él algo que no hace:

- **No modifica nada.** Solo lee. No puede cambiar, borrar ni cargar datos en
  el sistema de catastro.
- **No funciona fuera de la red municipal.** El mapa se ve, los datos no.
- **No reemplaza al sistema de catastro.** Es una forma de consultarlo sobre el
  mapa.
