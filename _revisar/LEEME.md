# Archivos apartados para revisar

## Merlo2026Parcelas-V1 (copia hallada en img).json

Estaba suelto dentro de `VISUALIZADOR/img/`, una carpeta de imágenes de la
interfaz. **El sistema nunca lo usó**: el visor busca los GeoJSON en `datos/`
o en la raíz, nunca en `img/`.

Es una versión DISTINTA del archivo de parcelas que sí está en uso:

    este archivo          7.945.032 bytes
    web/datos/...         7.912.084 bytes   <- el que usa el visor

Las geometrías difieren desde la primera parcela, así que no es una copia:
es otra exportación del padrón, de otra fecha.

**Qué hacer:** confirmar cuál de las dos exportaciones es la correcta. Si la
que está en uso es la buena, este archivo se puede borrar. Si esta fuera más
reciente, habría que reemplazar la de `web/datos/` y volver a generar la línea
base del test de equivalencia:

    node herramientas/verificar-equivalencia.js --guardar

Esta carpeta está fuera de git.
