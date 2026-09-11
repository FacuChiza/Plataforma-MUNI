# Archivos apartados

Cosas que se sacaron de la vista para dejar el proyecto ordenado, pero que no
se borran. Esta carpeta está **fuera de git**: nada de acá se sube al repo.

Cada archivo, qué es y qué hacer con él:

---

## Merlo2026-08.dwg  ·  (+ .dwl y .dwl2)

**NO borrar. Es la fuente del plano, no un archivo viejo.**

Es el dibujo de AutoCAD del que salen los GeoJSON de las parcelas. Cada mes
Catastro entrega uno nuevo; de ahí se exportan los `.json` que usa el visor
(ver `docs/actualizar-el-plano.md`). Se movió acá solo para no tener un archivo
de 30 MB en la raíz del proyecto.

Pesa mucho y es binario, por eso nunca se sube a git (está en `.gitignore`).

Los `.dwl` y `.dwl2` son archivos de bloqueo que crea AutoCAD al abrir el
dibujo. Son basura temporal: se pueden borrar sin problema.

---

## Guía Profesional para Publicar el SIG Catastral al Exterior.docx

Documento viejo sobre cómo publicar el visor hacia afuera. **Quedó reemplazado**
por `docs/acceso-remoto.md`, que está en el repo, actualizado y explicado paso
a paso. Se guarda por si tuviera alguna idea que no pasamos a la guía nueva.

---

## Comandos útiles de PM2-servidor.txt

Notas sueltas sobre PM2, un administrador de procesos para dejar el servidor
corriendo como servicio. El visor hoy se arranca con `INICIAR.bat`, así que
estas notas no se usan. Si algún día se quiere que el servidor levante solo con
la computadora, pueden servir de punto de partida.

---

## Merlo2026Parcelas-V1 (copia hallada en img).json

Estaba suelto dentro de una carpeta de imágenes de la interfaz. **El sistema
nunca lo usó**: el visor busca los GeoJSON en `datos/` o en la raíz, nunca en
`img/`.

Es una versión DISTINTA del archivo de parcelas que sí está en uso:

    este archivo          7.945.032 bytes
    web/datos/...         7.912.084 bytes   <- el que usa el visor

Las geometrías difieren desde la primera parcela, así que no es una copia: es
otra exportación del padrón, de otra fecha.

**Qué hacer:** confirmar cuál de las dos exportaciones es la correcta. Si la que
está en uso es la buena, este archivo se puede borrar. Si esta fuera más
reciente, habría que reemplazar la de `web/datos/` y volver a generar la línea
base del test de equivalencia:

    node herramientas/verificar-equivalencia.js --guardar
