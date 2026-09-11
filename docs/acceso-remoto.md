# Acceso remoto al visor (desde fuera de la red municipal)

Cómo dejar que los municipales usen el visor desde cualquier lado —la casa, el
celular, otra oficina— sin estar en la red de la Municipalidad.

> **Antes que nada, la regla que ordena todo esto:** la base de datos NO se
> expone a internet, y no se puede aunque se quisiera. Lo que se abre es el
> **visor**, con un candado, y el visor sigue consultando la base desde adentro
> de la red, como siempre. Nadie de afuera toca la base: le pide una parcela al
> visor, y el visor —que sí está en la red— la busca y devuelve solo eso.

---

## Por qué no alcanza con "subirlo a un servidor"

La base está en el servidor municipal, en una dirección **privada de la red municipal**.
Esa dirección no existe en internet: una página alojada en la nube (Vercel,
un hosting, lo que sea) no tiene forma de alcanzarla.

Por eso la parte que habla con la base —el `server.js`— **tiene que seguir
corriendo en una computadora de la Muni**, la que está conectada a la red. No
se puede mover a la nube. Lo único que hacemos es abrirle una puerta con llave
a esa computadora, para que se la pueda usar desde afuera.

Esa puerta con llave es un **túnel**.

---

## Qué es el túnel, en criollo

Un túnel es un programita (`cloudflared`) que corre en la misma computadora de
la Muni y hace de intermediario:

```
   Municipal desde su casa
            │
            ▼
   candado (login por email)          ← Cloudflare: solo pasan los autorizados
            │
            ▼
   túnel  →  computadora de la Muni  →  server.js  →  base de datos
   (internet)      (red municipal)      (el visor)     (servidor)
```

- La computadora **no abre ningún puerto** hacia afuera. Es el túnel el que
  sale a internet desde adentro, así que no hay que tocar el router ni pedir IP
  fija.
- Entre internet y la computadora hay un **candado**: Cloudflare Access pide un
  login antes de dejar pasar a nadie. Solo entran los correos que vos autorices.
- Todo viaja cifrado (HTTPS), lo pone Cloudflare solo.

Es gratis para este tamaño de uso.

---

## Las dos formas de armarlo

### Forma A — Túnel solo (RECOMENDADA)

El túnel expone el `server.js` entero, que ya sirve la web **y** la API juntas.

```
   municipal  →  candado  →  túnel  →  server.js (web + API + datos)
```

- **Un solo dominio, un solo candado, sin CORS.** Es lo más simple y lo que
  menos puede fallar.
- No hace falta Vercel.
- La web se ve un poco más lenta la primera vez (los mapas viajan desde la
  computadora de la Muni), pero después el navegador los guarda.

**Esta es la que conviene.** El resto de la guía la usa.

### Forma B — Vercel (web) + túnel (API)

La web se publica en Vercel y solo la API va por el túnel.

- La web carga más rápido y está siempre arriba, aunque la computadora de la
  Muni esté apagada (aunque sin la API no hay datos, así que la ventaja es
  relativa).
- **Cuesta más y tiene más filo**: son dos dominios, hay que configurar CORS
  (`ORIGENES_PERMITIDOS` en el `.env`) y, sobre todo, el login de Cloudflare
  vale para el dominio de la API pero no automáticamente para el de Vercel, así
  que el candado cruzado se vuelve delicado.

El código ya está preparado por si se elige esta forma (ver el final), pero para
empezar, andá por la A.

---

## Paso a paso (Forma A)

Todo esto se hace **una sola vez**, en la computadora de la Muni.

### 1. Tener el visor andando localmente

Que `INICIAR.bat` abra el visor y traiga datos reales. Si eso no anda, el
acceso remoto tampoco: primero resolver eso (ver `docs/instalacion-en-la-muni.md`).

### 2. Cerrar la API a la red

En `servidor\.env`, agregar:

```
HOST=127.0.0.1
```

Con esto la API deja de escuchar a la red municipal y solo la alcanza el túnel,
que corre en la misma computadora. Es una llave más: aunque alguien esté dentro
de la red, no llega a la API sin pasar por el candado.

> Después de tocar el `.env`, cerrar el visor y volver a abrirlo con
> `INICIAR.bat` para que tome el cambio.

### 3. Crear una cuenta de Cloudflare

Gratis, en <https://dash.cloudflare.com/sign-up>. Conviene una cuenta
**de la Municipalidad**, no personal: el acceso a los datos de los vecinos
tiene que quedar a nombre del organismo, no de una persona.

Para tener un dominio propio (`catastro.villademerlo.gob.ar`) hay que agregar
el dominio del municipio a Cloudflare. Si no se tiene a mano, Cloudflare da una
dirección `.trycloudflare.com` para probar, aunque para uso diario conviene el
dominio propio.

### 4. Instalar el túnel

Bajar `cloudflared` para Windows desde la web de Cloudflare e instalarlo. Desde
una ventana de comandos:

```
cloudflared tunnel login
cloudflared tunnel create visor-catastro
```

Eso deja un archivo de credenciales del túnel en la computadora. **Ese archivo
es una llave: no se comparte ni se sube a ningún lado.**

Después se le dice a qué apunta el túnel (al visor local). En el archivo de
configuración del túnel:

```yaml
tunnel: visor-catastro
credentials-file: C:\Users\<usuario>\.cloudflared\<id>.json

ingress:
  - hostname: catastro.villademerlo.gob.ar
    service: http://localhost:8001      # el puerto que dice INICIAR.bat
  - service: http_status:404
```

Y se arranca:

```
cloudflared tunnel run visor-catastro
```

> Para que el túnel arranque solo con la computadora (sin abrir la ventana cada
> vez), Cloudflare permite instalarlo como servicio de Windows:
> `cloudflared service install`. Recomendado para el uso diario.

### 5. Poner el candado (ESTE PASO NO ES OPCIONAL)

Sin candado, cualquiera que descubra la dirección puede leer el nombre, el
documento y el domicilio de todos los titulares del padrón. **El candado es lo
que separa "acceso remoto" de "fuga de datos".**

En el panel de Cloudflare, en **Zero Trust → Access → Applications**:

1. Agregar una aplicación de tipo *Self-hosted*.
2. Dominio: el mismo del túnel (`catastro.villademerlo.gob.ar`).
3. Crear una política que permita el acceso **solo a una lista de correos**
   (los de los municipales autorizados), o a un dominio de correo entero
   (`@villademerlo.gob.ar`) si lo tienen.

A partir de ahí, quien entre a la dirección primero ve una pantalla de
Cloudflare que le pide el correo, le manda un código, y recién con el código
correcto pasa al visor. Los accesos quedan registrados, y sacar a alguien es
borrarlo de la lista.

### 6. Listo

Los municipales entran a `https://catastro.villademerlo.gob.ar`, ponen su
correo, y usan el visor como si estuvieran en la oficina. La computadora de la
Muni tiene que estar encendida, con el visor y el túnel corriendo.

---

## Si además se quiere usar Vercel (Forma B)

El frente ya está listo para publicarse en Vercel: `vercel.json` sirve la
carpeta `web/`. Los pasos extra sobre la Forma A:

1. Publicar en Vercel apuntando el proyecto a este repositorio (carpeta `web`).
2. En `web/js/config.js`, poner en `API_BASE` la dirección del túnel:
   ```js
   API_BASE: 'https://catastro.villademerlo.gob.ar'
   ```
3. En `servidor\.env`, autorizar el dominio de Vercel:
   ```
   ORIGENES_PERMITIDOS=https://<tu-proyecto>.vercel.app
   ```
4. Resolver el candado cruzado: como el login de Cloudflare vale para el
   dominio del túnel y no para el de Vercel, hay que usar un *service token* de
   Cloudflare Access o alojar el frente bajo el mismo dominio de Cloudflare.
   Este es el punto delicado que hace que, para la mayoría de los casos,
   convenga la Forma A.

---

## Preguntas que van a surgir

**¿La base queda expuesta a internet?**
No. Lo único accesible es el visor, y con candado. El visor consulta la base
desde adentro de la red, igual que ahora. Nadie de afuera ve la base.

**¿Y si apago la computadora de la Muni?**
El visor remoto deja de funcionar hasta que se vuelva a encender. La API vive
ahí; no hay copia en la nube (no puede haberla, porque la nube no llega a la
base).

**¿Cuánto sale?**
El túnel y el candado de Cloudflare son gratis para este uso. Vercel también,
en su plan gratuito.

**¿Quién puede entrar?**
Solo los correos que estén en la política de Cloudflare Access. Se agregan y se
sacan desde el panel, sin tocar el programa.

**¿Esto no es lo mismo que la "puerta trasera" que se descartó?**
No, es lo contrario. Aquello era un acceso oculto y sin permiso a datos de
terceros. Esto es un acceso **con candado, con lista de autorizados, a nombre
del municipio y a la vista**: la diferencia es justamente que acá el dueño de
los datos sabe quién entra y puede cortarlo cuando quiera.
