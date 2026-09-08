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
- **Nombre de la base (opcional)** — ver más abajo
- **Nombre de usuario**
- **Contraseña** — se escribe oculta

> **Sobre el nombre de la base:** si en SQL Server Management Studio te conectás
> dejando ese campo en `<predeterminado>`, acá **dejalo vacío**. `<predeterminado>`
> no es un nombre de base: significa "usá la que corresponde a este usuario".
>
> Si se escribe un nombre de base que no existe, SQL Server responde
> **`Login failed for user`** — el mismo error que da una contraseña equivocada.
> Es de los errores más confusos que hay, porque parece un problema de
> credenciales cuando en realidad es el nombre de la base.

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

### "Dice que no encontró ningún puerto libre"

Pasa solo si hay muchos programas usando la red. Cerrar alguno y volver a
intentar, o reiniciar la computadora.

No hace falta cerrar el visor anterior: este busca su propio puerto y los dos
pueden convivir.

### "El navegador no se abre solo"

Abrirlo a mano y entrar a <http://localhost:8000>.

---

## Actualizar a una versión nueva

Doble clic en:

```
ACTUALIZAR.bat
```

Baja la última versión y la aplica sola. **No toca la configuración de la base
ni los componentes instalados**, así que al terminar el visor funciona sin
volver a configurar nada.

Al final muestra qué versión había antes y cuál quedó.

### Cómo saber qué versión está corriendo

La versión aparece **abajo a la derecha del mapa**, junto al sistema de
coordenadas. También al arrancar, en la ventana negra.

Esto importa: si algo que ya se corrigió sigue fallando, casi siempre es que la
computadora está ejecutando una instalación vieja. Antes de buscar el problema
en otro lado, mirá ese número.

### Si la computadora no tiene internet

`ACTUALIZAR.bat` necesita salida a internet para bajar la versión nueva. Si el
equipo no la tiene, hay que hacerlo a mano desde otra máquina:

1. Bajar el ZIP de <https://github.com/FacuChiza/Plataforma-MUNI>
2. Descomprimirlo y copiar **encima** de la carpeta del visor, eligiendo
   **Reemplazar los archivos** cuando Windows pregunte
3. **No tocar `servidor\.env`**: ahí están los datos de conexión
4. Comprobar que el número de versión abajo a la derecha del mapa haya cambiado

---

## Convive con el visor anterior

Este visor **no reemplaza ni toca** al que ya estaba funcionando. Usan puertos
distintos, así que pueden estar abiertos al mismo tiempo.

El visor anterior usa el **8000**. Este busca uno libre al arrancar —8001, 8002,
8003…— y **nunca prueba el 8000**. Cuál le tocó lo dice al abrir:

```
Puerto: 8001
```

y también en la línea `Si no se abre, entrar a: http://localhost:8001`. Si en
esa computadora el 8001 ya está ocupado por otro programa, toma el siguiente
libre y sigue funcionando igual.

Eso es a propósito. Mientras este visor se esté probando, **el anterior tiene
que seguir disponible**: si algo acá no funciona, en la Municipalidad se sigue
trabajando con el de siempre sin depender de que esto ande.

Por eso:

- **No borrar la instalación anterior** hasta que esté confirmado, después de un
  tiempo de uso real, que este visor hace todo lo que hacía aquel.
- `INICIAR.bat` **no cierra ningún otro programa**. Si el puerto que iba a usar
  está ocupado, busca otro en vez de reclamarlo.
- Ninguna de las herramientas de este programa modifica la instalación anterior.

### Volver atrás

No hace falta desinstalar nada: abrir el visor anterior como siempre. Los dos
consultan la misma base de datos, en modo lectura, así que usar uno u otro no
cambia ningún dato.

---

## Qué NO hace este visor

Conviene que quede claro para no esperar de él algo que no hace:

- **No modifica nada.** Solo lee. No puede cambiar, borrar ni cargar datos en
  el sistema de catastro.
- **No toca el visor anterior.** Ni sus archivos, ni su configuración, ni lo
  cierra mientras está en uso.
- **No funciona fuera de la red municipal.** El mapa se ve, los datos no.
- **No reemplaza al sistema de catastro.** Es una forma de consultarlo sobre el
  mapa.
