/**
 * ============================================================================
 * CONFIGURACIÓN DEL VISOR
 * ----------------------------------------------------------------------------
 * Este archivo es lo ÚNICO que cambia entre un entorno y otro.
 *
 * El visor puede correr de dos maneras:
 *
 *   1. TODO JUNTO (lo habitual, y lo que corre hoy en la Municipalidad)
 *      El servidor de servidor/ sirve esta misma web y además la API.
 *      Front y API comparten origen, así que no hay que configurar nada:
 *      con API_BASE en vacío, cada consulta va al mismo servidor que entregó
 *      la página.
 *
 *   2. FRONT SEPARADO (por ejemplo publicado en Vercel)
 *      La web se sirve desde internet, pero la base de datos municipal solo
 *      es accesible desde adentro de la red de la Municipalidad. Entonces la
 *      API tiene que seguir corriendo en una máquina de la muni, publicada
 *      con un túnel, y acá se pone esa dirección.
 *
 *      API_BASE: 'https://catastro-api.villademerlo.gob.ar'
 *
 *      IMPORTANTE: en ese escenario, la API queda accesible desde internet.
 *      Antes de hacerlo hay que ponerle autenticación (por ejemplo Cloudflare
 *      Access): tal como está hoy, cualquiera con la URL puede leer el
 *      nombre, documento y domicilio de todos los titulares del padrón.
 *
 * Los archivos de datos (GeoJSON) se buscan en la misma dirección que la API,
 * porque pesan 46 MB y no se versionan ni se publican junto con la web.
 * ============================================================================
 */

window.CONFIG = {
    /**
     * Dirección del servidor que atiende /api/... y sirve los GeoJSON.
     * Vacío = el mismo origen desde el que se cargó esta página.
     * Sin barra al final.
     */
    API_BASE: '',

    /**
     * Devuelve la URL absoluta para una ruta del backend.
     * Se usa tanto para la API como para los archivos de datos.
     */
    url(ruta) {
        const limpia = String(ruta || '').replace(/^\/+/, '');
        const base = this.API_BASE ? this.API_BASE.replace(/\/+$/, '') : window.location.origin;
        return `${base}/${limpia}`;
    }
};
