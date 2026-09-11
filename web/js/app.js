/* ============================================================================
   app.js  —  TODA LA LÓGICA DEL VISOR (mapa, ficha, plancheta, filtros)
   ----------------------------------------------------------------------------
   Es un archivo largo. Para ubicarte, sus partes principales (buscá el nombre):

     MAPAS BASE ............. de dónde salen las calles del fondo, con respaldo
     ÍNDICE... (x4) ......... búsquedas rápidas: por punto, por padrón, por manzana
     encuadrarParcela() .... al hacer clic, muestra la parcela dentro de su manzana
     showModalData() ....... arma la ficha que aparece en pantalla
     procesarParcela() ..... decide qué mostrar (parcela simple o propiedad horizontal)
     imprimirFicha() ....... la PLANCHETA catastral (el PDF con el mapa)
     imprimirLibreDeuda() .. la constancia del Juzgado de Faltas
     aplicarFiltros() ...... búsqueda por superficie / zona / barrio
     paintMapFromFilter() .. pinta en el mapa el resultado de un filtro
     loadData() ............ carga los archivos del plano al arrancar
     const PLANO ........... LOS NOMBRES DE LOS ARCHIVOS DEL PLANO van acá
     buscarPadron() ........ el buscador de arriba

   Cada parte tiene su propio comentario explicando QUÉ hace y POR QUÉ así.
   OJO: a qué servidor se le piden los datos NO se cambia acá, sino en config.js
   ============================================================================ */

        // ====================================================================
        // MAPAS BASE
        // --------------------------------------------------------------------
        // POR QUE NO SE USAN LOS SERVIDORES DE OPENSTREETMAP
        //   Antes el mapa de calles se pedía directamente a
        //   tile.openstreetmap.org, y en la Municipalidad el mapa aparecía
        //   cubierto de carteles "Access blocked - Referer is required by tile
        //   usage policy of OpenStreetMap's volunteer-run servers".
        //
        //   No es un error de configuración: es la política de uso de OSM. Sus
        //   servidores los mantienen voluntarios y están para el sitio de
        //   OpenStreetMap, no para aplicaciones de terceros. Bloquean según el
        //   volumen y el origen de las consultas, así que puede funcionar desde
        //   una red y estar bloqueado desde otra —exactamente lo que pasó acá,
        //   donde andaba en desarrollo y no en la red municipal—.
        //
        //   CARTO y Esri publican estos mismos mapas para que los usen
        //   aplicaciones. Los datos siguen siendo de OpenStreetMap; cambia
        //   quién sirve las imágenes. Por eso la atribución los nombra a los
        //   dos.
        // ====================================================================
        const ATRIB_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

        // --------------------------------------------------------------------
        // MAPA DE CALLES CON RESPALDO AUTOMATICO
        //
        // Un solo proveedor es un punto unico de falla: si esa red bloquea ese
        // dominio -o el proveedor bloquea a esa red, como hizo OpenStreetMap-,
        // el mapa queda cubierto de carteles de error y no hay nada que el
        // usuario pueda hacer.
        //
        // Ahora hay una lista. Si el proveedor activo falla al traer las
        // imagenes, el visor pasa solo al siguiente y lo deja anotado en la
        // consola. Con que uno de los tres responda, el mapa se ve.
        // --------------------------------------------------------------------
        // --------------------------------------------------------------------
        // ORDEN DE LA LISTA
        //   Primero Esri. Ninguno de estos servicios pide clave ni cuenta: se
        //   comprobó que los tres entregan las imágenes sin credencial alguna,
        //   así que cuando el mapa no aparece no es que "falte una API", es que
        //   la red desde la que se está usando no deja salir a ese dominio.
        //
        //   Esri sirve las imágenes desde un único servidor propio
        //   (server.arcgisonline.com). CARTO las sirve desde una red de
        //   distribución de contenido (cartocdn.com), y los filtros de red
        //   corporativos suelen bloquear ese tipo de dominios por categoría, sin
        //   que nadie lo haya decidido para este caso en particular. En la
        //   Municipalidad el mapa no aparecía justamente por eso.
        //
        //   OpenStreetMap va último porque bloquea por política de uso, no por
        //   red: es el que más chances tiene de fallar en cualquier lado.
        // --------------------------------------------------------------------
        const PROVEEDORES_CALLE = [
            {
                nombre: 'Esri',
                url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
                opciones: { attribution: 'Esri' }
            },
            {
                nombre: 'CARTO',
                url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
                opciones: { subdomains: 'abcd', attribution: ATRIB_OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>' }
            },
            {
                nombre: 'OpenStreetMap',
                url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                opciones: { subdomains: 'abc', attribution: ATRIB_OSM }
            }
        ];

        let proveedorActual = 0;

        function crearCapaCalles(indice) {
            const p = PROVEEDORES_CALLE[indice];
            const capa = L.tileLayer(p.url, Object.assign({ maxZoom: 22, maxNativeZoom: 19 }, p.opciones));

            // Si fallan varias imagenes seguidas, este proveedor no sirve en
            // esta red. Se cuenta y se cambia; un error suelto puede ser una
            // imagen que no existe en ese zoom y no justifica cambiar.
            let fallas = 0;
            capa.on('tileerror', () => {
                fallas++;
                if (fallas === 4 && indice === proveedorActual) usarProveedor(indice + 1);
            });

            capa.on('load', () => { fallas = 0; });
            return capa;
        }

        /** Cambia el mapa de calles al proveedor indicado. */
        function usarProveedor(indice) {
            if (indice >= PROVEEDORES_CALLE.length) { avisarSinMapaBase(); return; }

            const anterior = window.__capaCalles;
            const nueva = crearCapaCalles(indice);
            proveedorActual = indice;
            window.__capaCalles = nueva;
            console.log(`🗺️ Mapa de calles: ${PROVEEDORES_CALLE[indice].nombre}`);

            if (anterior && map.hasLayer(anterior)) {
                map.removeLayer(anterior);
                nueva.addTo(map);
                nueva.bringToBack();
            }
        }

        // --------------------------------------------------------------------
        // COMPROBACION AL ARRANCAR
        //
        // Esperar a que fallen las imágenes para cambiar de proveedor funciona,
        // pero mientras tanto el usuario ve el mapa cubierto de recuadros de
        // error, y si el bloqueo de la red hace que las consultas queden
        // colgadas en vez de fallar rápido, el aviso de error puede no llegar
        // nunca y el mapa se queda gris para siempre. Eso es lo que se veía en
        // la Municipalidad.
        //
        // Por eso, al abrir el visor se pide UNA imagen de prueba a cada
        // proveedor, las tres al mismo tiempo, y se usa el primero de la lista
        // que haya contestado. Si ninguno contesta en 6 segundos, se avisa en
        // pantalla en vez de dejar un mapa vacío sin explicación.
        // --------------------------------------------------------------------
        const TESELA_PRUEBA = { z: 13, x: 2616, y: 4872 };   // cae sobre Villa de Merlo

        function urlDePrueba(p) {
            const sub = (p.opciones && p.opciones.subdomains) ? p.opciones.subdomains[0] : 'a';
            return p.url
                .replace('{s}', sub)
                .replace('{z}', TESELA_PRUEBA.z)
                .replace('{x}', TESELA_PRUEBA.x)
                .replace('{y}', TESELA_PRUEBA.y)
                .replace('{r}', '');
        }

        function proveedorResponde(p) {
            return new Promise((resolve) => {
                const img = new Image();
                let resuelto = false;
                const terminar = (ok) => { if (!resuelto) { resuelto = true; resolve(ok); } };
                const plazo = setTimeout(() => terminar(false), 6000);
                img.onload  = () => { clearTimeout(plazo); terminar(true); };
                img.onerror = () => { clearTimeout(plazo); terminar(false); };
                img.src = urlDePrueba(p);
            });
        }

        async function elegirProveedorQueResponda() {
            const respuestas = await Promise.all(PROVEEDORES_CALLE.map(proveedorResponde));

            PROVEEDORES_CALLE.forEach((p, i) => {
                if (!respuestas[i]) console.warn(`⚠️ El mapa de ${p.nombre} no responde desde esta red.`);
            });

            const elegido = respuestas.findIndex(Boolean);
            if (elegido === -1) { avisarSinMapaBase(); return; }
            if (elegido !== proveedorActual) usarProveedor(elegido);
            else console.log(`🗺️ Mapa de calles: ${PROVEEDORES_CALLE[elegido].nombre}`);
        }

        /**
         * Ningún proveedor responde. El visor sigue siendo utilizable -las
         * parcelas son archivos locales y se dibujan igual-, pero sin las
         * calles de fondo cuesta ubicarse, así que hay que decirlo: un mapa
         * gris sin explicación parece un programa roto.
         */
        function avisarSinMapaBase() {
            console.error('❌ Ningún proveedor de mapa de calles responde desde esta red.');
            if (document.getElementById('aviso-sin-mapa')) return;

            const aviso = document.createElement('div');
            aviso.id = 'aviso-sin-mapa';
            aviso.style.cssText = 'position:absolute; top:12px; left:50%; transform:translateX(-50%);' +
                'z-index:900; max-width:520px; background:#fef3c7; border:1px solid #f59e0b;' +
                'color:#78350f; padding:10px 14px; border-radius:8px; font-size:12px;' +
                'line-height:1.5; box-shadow:0 2px 8px rgba(0,0,0,.15);';
            aviso.innerHTML =
                '<b>No se pudo cargar el mapa de calles.</b><br>' +
                'Las parcelas se ven igual, pero el fondo con las calles queda vacío. ' +
                'La causa habitual es que la red de la Municipalidad no deje salir a los ' +
                'servidores de mapas. Para solucionarlo hay que pedirle a sistemas que ' +
                'permitan el acceso a <b>server.arcgisonline.com</b>.' +
                '<span style="float:right; cursor:pointer; font-weight:700; margin-left:10px;" ' +
                'onclick="this.parentNode.remove()">✕</span>';

            const contenedor = document.getElementById('map');
            if (contenedor) contenedor.appendChild(aviso);
        }

        const osm = crearCapaCalles(0);
        window.__capaCalles = osm;

        const sat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            maxZoom: 22,
            maxNativeZoom: 19,
            attribution: '&copy; Google'
        });

        const topo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 22,
            maxNativeZoom: 19,
            attribution: 'Esri'
        });

        const map = L.map('map', { 
            zoomControl: false, 
            layers: [osm], 
            preferCanvas: true,
            zoomSnap: 0.25,          
            zoomDelta: 0.5,          
            wheelPxPerZoomLevel: 120 
        }).setView([-32.3435, -65.0112], 15);
        
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        // Se comprueba cuál de los proveedores de mapa de calles responde desde
        // esta red y se usa el primero que conteste. No hace esperar a nada: el
        // visor sigue cargando mientras tanto.
        elegirProveedorQueResponda();

        const geojsonLayer = L.featureGroup().addTo(map); 
        const labelsLayer = L.layerGroup(); 
        const manzanasLayer = L.layerGroup().addTo(map); 
        const barriosLayer = L.featureGroup().addTo(map); 
        const barriosLabelsLayer = L.layerGroup(); 
        const edificadoLayer = L.featureGroup(); 
        
        let currentFeatureProps = null; 
        let selectedLayer = null; 

        // En labelsData almacenaremos los Puntos (MerloPuntosNomeclaParcelasV2.json)
        // que contienen la cardinalidad de la Propiedad Horizontal
        let labelsData = []; 
        let manzanasData = [];
        let barriosData = []; 
        
        let showLabels = false;
        let showManzanas = false;
        let showBarrios = true; 
        let showEdificado = false;

        // Algoritmo Ray-casting para determinar si un punto cae dentro de un polígono
        function isPointInPolygon(point, polygonCoords) {
            const x = point[1], y = point[0]; 
            let inside = false;
            for (let i = 0, j = polygonCoords.length - 1; i < polygonCoords.length; j = i++) {
                const xi = polygonCoords[i][0], yi = polygonCoords[i][1];
                const xj = polygonCoords[j][0], yj = polygonCoords[j][1];
                const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        // ====================================================================
        // ÍNDICE ESPACIAL DE PUNTOS DE NOMENCLATURA
        // --------------------------------------------------------------------
        // Antes, cada clic recorría los 17.512 puntos del padrón para encontrar
        // el que cae dentro de la parcela. Ahora los puntos se reparten una
        // sola vez en una grilla de celdas de ~0,002° (unos 200 m), y cada clic
        // solo mira las celdas que tocan el bounding box de la parcela: ~1,4
        // puntos en promedio.
        //
        // EL RESULTADO ES EL MISMO, y hay una razón por la que hay que tener
        // cuidado: 35 polígonos tienen MÁS DE UN punto adentro. En esos casos
        // el algoritmo original devuelve el primero según el orden del archivo,
        // así que la grilla guarda el índice original de cada punto y los
        // candidatos se ordenan por ese índice antes de evaluarlos. Sin eso, el
        // resultado cambiaría en esos 35 casos sin que nadie lo note.
        // ====================================================================
        const CELDA_INDICE = 0.002;
        let indicePuntos = null;
        let indicePuntosOrigen = null;

        function claveCelda(lng, lat) {
            return Math.floor(lng / CELDA_INDICE) + ':' + Math.floor(lat / CELDA_INDICE);
        }

        function construirIndicePuntos(features) {
            const grilla = new Map();
            for (let idx = 0; idx < features.length; idx++) {
                const pt = features[idx];
                if (!pt.geometry || pt.geometry.type !== 'Point') continue;
                const lng = pt.geometry.coordinates[0];
                const lat = pt.geometry.coordinates[1];
                const clave = claveCelda(lng, lat);
                let celda = grilla.get(clave);
                if (!celda) { celda = []; grilla.set(clave, celda); }
                celda.push({ idx, lng, lat, pt });
            }
            indicePuntos = grilla;
            indicePuntosOrigen = features;
            console.log(`🗂️  Índice espacial construido: ${features.length} puntos en ${grilla.size} celdas.`);
            return grilla;
        }

        // ====================================================================
        // ÍNDICE DE BÚSQUEDA POR PADRÓN
        // --------------------------------------------------------------------
        // Antes, cada búsqueda recorría los 17.512 puntos y, por cada uno,
        // probaba los 50 PADRON_x de propiedad horizontal: hasta 875.600
        // comparaciones por tecleo. Ahora es un Map armado una sola vez.
        //
        // EQUIVALENCIA: el .find() original devuelve el PRIMER punto del
        // archivo que coincide por cualquiera de sus campos. El Map se arma
        // recorriendo en el mismo orden y sin pisar lo ya cargado
        // (if (!mapa.has(clave))), así que para cada valor guarda exactamente
        // ese mismo primer punto.
        // ====================================================================
        let indiceBusqueda = null;

        function construirIndiceBusqueda(features) {
            const mapa = new Map();
            const registrar = (valor, pt) => {
                const clave = String(valor || '').trim();
                if (clave !== '' && !mapa.has(clave)) mapa.set(clave, pt);
            };

            for (const pt of features) {
                const p = pt.properties || {};
                registrar(p.PADRON, pt);
                registrar(p.NRO_RENTA || p.PADRON, pt);
                registrar(p.TEXTSTRING, pt);
                for (let i = 1; i <= 50; i++) registrar(p[`PADRON_${i}`], pt);
            }

            indiceBusqueda = mapa;
            console.log(`🔎 Índice de búsqueda construido: ${mapa.size} claves.`);
            return mapa;
        }

        // ====================================================================
        // ÍNDICE DE MANZANAS Y ENCUADRE CON CONTEXTO
        // --------------------------------------------------------------------
        // La nomenclatura catastral tiene forma SECCIÓN(4) + MANZANA(6) +
        // PARCELA(6) + SUBPARCELA(6) = 22 caracteres. Los primeros 10
        // identifican la manzana, así que agrupar por ahí es determinístico:
        // sale de la clave del propio polígono, no de un cálculo espacial.
        //
        // Sirve para que al abrir una parcela se vea la manzana entera y las
        // calles que la rodean, en vez de un polígono suelto sin referencias.
        // ====================================================================
        const ESTILO_BASE = { color: '#13f8bc', weight: 0.8, fillOpacity: 0.05, fillColor: '#10abb9' };
        const ESTILO_MANZANA = { color: '#0ea5e9', weight: 1.6, fillOpacity: 0.12, fillColor: '#0ea5e9' };
        const ESTILO_SELECCION = { color: '#f59e0b', weight: 3, fillOpacity: 0.4, fillColor: '#f59e0b' };

        // ====================================================================
        // CUANTO SE PUEDE ALEJAR EL MAPA PARA MOSTRAR LA MANZANA
        // --------------------------------------------------------------------
        // Medido en NIVELES DE ZOOM, no en un número de zoom fijo. Esto último
        // fue un error que costó dos intentos, y vale la pena dejarlo anotado:
        //
        //   El criterio era "mostrar la manzana entera salvo que haya que bajar
        //   de tal zoom". Primero ese tope fue 17 y dejaba sin mostrar 141
        //   manzanas de tamaño corriente -una de 16 parcelas se perdía por
        //   necesitar 16,8-. Al bajarlo a 15 esas manzanas pasaron a mostrarse
        //   completas, pero con un efecto peor: parcelas que se ven a zoom 19
        //   quedaban encuadradas a 15, o sea a un dieciseisavo del ancho. La
        //   manzana se veía entera y la parcela no se veía.
        //
        //   El problema es que un zoom fijo no dice nada por sí solo: que 15
        //   sea mucho o poco depende del tamaño de la parcela. Lo que importa
        //   es cuánto detalle se PIERDE al alejarse, y eso es una diferencia,
        //   no un valor absoluto.
        //
        // Con 2 niveles, la parcela nunca baja de ocupar un cuarto del ancho de
        // la pantalla. Medido sobre el plano, 1.013 de las 1.131 manzanas con
        // más de una parcela entran dentro de ese margen y se muestran enteras;
        // en las 118 restantes se centra en la parcela y alrededor se ve la
        // parte de la manzana que entre, ya pintada de azul.
        // ====================================================================
        const MAXIMO_ALEJAMIENTO = 2;

        const indiceManzanas = new Map();
        let manzanaResaltada = [];

        function claveManzana(props) {
            const nomen = String((props && (props.NOMENCLA || props.NOMENCLATURA || props.NOMENCLATU)) || '').trim();
            return nomen.length >= 10 ? nomen.substring(0, 10) : null;
        }

        function registrarEnManzana(feature, layer) {
            const clave = claveManzana(feature.properties);
            if (!clave) return;
            let grupo = indiceManzanas.get(clave);
            if (!grupo) { grupo = []; indiceManzanas.set(clave, grupo); }
            grupo.push(layer);
        }

        function limpiarResaltadoManzana() {
            for (const l of manzanaResaltada) {
                try { l.setStyle(ESTILO_BASE); } catch (e) { /* capa ya removida */ }
            }
            manzanaResaltada = [];
        }

        // ====================================================================
        // ÍNDICE DE PARCELAS POR PADRÓN
        // --------------------------------------------------------------------
        // POR QUE EXISTE
        //   Pintar el resultado de un filtro consistía en recorrer las 17.614
        //   parcelas y llamar setStyle en todas: en las que coincidían para
        //   resaltarlas, y en las demás para devolverlas al estilo normal. Con
        //   un filtro amplio -por ejemplo terrenos de 1000 a 1500 m2, que son
        //   miles- eso son decenas de miles de repintados encadenados, todos en
        //   el mismo bloque de código. El navegador no puede atender nada
        //   mientras tanto: la pantalla se congela y parece que el programa se
        //   colgó.
        //
        //   Con este índice, pintar toca únicamente las parcelas involucradas:
        //   las que hay que resaltar (se buscan por padrón, directo) y las que
        //   quedaron pintadas de la búsqueda anterior (se anotan al pintarlas).
        //   El costo pasa a depender de cuántas parcelas cambian de color, no
        //   de cuántas hay en el municipio.
        //
        //   Se arma mientras Leaflet crea las capas, igual que el de manzanas,
        //   así que no cuesta un recorrido extra al abrir el visor.
        //
        // POR QUE UNA LISTA POR PADRON Y NO UNA CAPA
        //   Un mismo padrón puede tener más de un polígono (propiedad
        //   horizontal, parcelas divididas). Si se guardara una sola capa por
        //   padrón, esas parcelas quedarían a medio pintar.
        // ====================================================================
        const indicePadrones = new Map();
        let parcelasPintadas = [];

        // Resultado del último pintado, para poder explicarlo en pantalla:
        // cuántas se pintaron y qué padrones no tienen dibujo en el plano.
        let ultimoPintado = { pintadas: 0, sinDibujo: [] };

        // Qué lista de parcelas está pintada en este momento.
        //
        // Sirve para no repintar lo mismo dos veces. Al hacer la búsqueda el
        // resultado ya se pinta; el botón "Pintar en Mapa" volvía a pintar
        // exactamente lo mismo, sin que cambiara nada en pantalla. El cálculo
        // en sí es barato (unos 7 ms para 2.100 parcelas), pero obliga a
        // Leaflet a redibujar el plano completo, y eso en las computadoras de
        // la Municipalidad se nota. Trabajo de más que no aporta nada.
        let datosPintados = null;

        /**
         * Deja un padrón en una forma comparable.
         *
         * POR QUE NO ALCANZA CON trim() Y MAYUSCULAS
         *   El mismo padrón no siempre está escrito igual en los dos lados. En
         *   el plano figura como `13-958934`, y la base puede devolverlo sin el
         *   guión, con espacios de más o con ceros adelante. Comparando el texto
         *   tal cual, esos casos no coinciden con ninguna parcela y el visor no
         *   las pinta, aunque la parcela esté perfectamente cargada.
         *
         *   Por eso se compara solo por letras y números. Se verificó sobre el
         *   plano completo que esto NO junta dos padrones distintos en uno: las
         *   17.134 claves siguen siendo 17.134 después de normalizar. O sea que
         *   tolera diferencias de escritura sin volverse ambiguo.
         */
        function normalizarPadron(valor) {
            return String(valor == null ? '' : valor).toUpperCase().replace(/[^A-Z0-9]/g, '');
        }

        function clavePadron(props) {
            return normalizarPadron((props && (props.NRO_RENTA || props.PADRON)) || '');
        }

        function registrarEnPadron(feature, layer) {
            const clave = clavePadron(feature.properties);
            if (!clave) return;
            let grupo = indicePadrones.get(clave);
            if (!grupo) { grupo = []; indicePadrones.set(clave, grupo); }
            grupo.push(layer);
        }

        /** Devuelve al estilo normal solo lo que había quedado pintado. */
        function limpiarPintadoFiltro() {
            for (const l of parcelasPintadas) {
                try { l.setStyle(ESTILO_BASE); } catch (e) { /* capa ya removida */ }
            }
            parcelasPintadas = [];
            datosPintados = null;
        }

        /**
         * Encuadra el mapa mostrando la parcela dentro de su manzana.
         *
         * El caso complicado son las manzanas enormes: hay una de 558 parcelas.
         * Encuadrarla entera dejaría la parcela como un punto invisible, que es
         * justo lo contrario de lo que se busca. Por eso, si el zoom necesario
         * para mostrar toda la manzana cae por debajo del umbral en que se leen
         * los nombres de calle, se encuadra la parcela con un margen de
         * contexto en lugar de la manzana completa.
         */
        function encuadrarParcela(layerParcela, feature, opciones) {
            limpiarResaltadoManzana();

            const boundsParcela = layerParcela.getBounds();
            const clave = claveManzana(feature.properties);
            const grupo = clave ? indiceManzanas.get(clave) : null;

            let objetivo = boundsParcela;

            if (grupo && grupo.length > 1) {
                // ------------------------------------------------------------
                // RESALTAR Y ENCUADRAR SON DOS DECISIONES DISTINTAS
                //
                //   Antes las dos estaban juntas: la manzana se pintaba de azul
                //   SOLO si además entraba entera y legible en pantalla. El
                //   efecto era que 5.009 parcelas -el 28% del plano- no
                //   resaltaban su manzana al seleccionarlas, y no por ser casos
                //   raros: alcanzaba con que la manzana necesitara zoom 16,8
                //   teniendo el umbral en 17. Manzanas de 16 o 22 parcelas,
                //   completamente normales, quedaban sin pintar por dos
                //   décimas de zoom.
                //
                //   Que la manzana no entre completa en pantalla no es motivo
                //   para no pintarla: se ve la parte que entra, y si el
                //   operador se aleja aparece el resto. Así que ahora se pinta
                //   SIEMPRE, y el zoom decide únicamente qué se encuadra.
                // ------------------------------------------------------------
                for (const l of grupo) {
                    if (l === layerParcela) continue;
                    try { l.setStyle(ESTILO_MANZANA); manzanaResaltada.push(l); } catch (e) { /* ignorar */ }
                }

                const boundsManzana = L.latLngBounds([]);
                for (const l of grupo) {
                    if (l.getBounds) boundsManzana.extend(l.getBounds());
                }

                if (boundsManzana.isValid()) {
                    const margen = L.point(60, 60);

                    // Zoom al que la parcela sola llena la pantalla: es el
                    // máximo detalle que tiene sentido, y la referencia contra
                    // la que se mide cuánto cuesta alejarse.
                    const zoomParcela = Math.min(map.getBoundsZoom(boundsParcela, false, margen), 19);
                    const zoomManzana = map.getBoundsZoom(boundsManzana, false, margen);

                    if (zoomParcela - zoomManzana <= MAXIMO_ALEJAMIENTO) {
                        // Alejarse hasta abarcar la manzana cuesta poco detalle:
                        // se muestra completa, que es lo que más ayuda a
                        // ubicarse.
                        objetivo = boundsManzana;
                    } else {
                        // La manzana es mucho más grande que la parcela (zona
                        // rural, o manzanas que agrupan parcelas dispersas).
                        // Mostrarla entera dejaría la parcela como un punto.
                        //
                        // Se centra en la parcela y se retrocede solo lo
                        // permitido: la parcela se sigue viendo con buen tamaño
                        // y alrededor aparece la parte de la manzana que entre,
                        // ya pintada de azul más arriba.
                        map.setView(boundsParcela.getCenter(), zoomParcela - MAXIMO_ALEJAMIENTO, {
                            animate: !(opciones && opciones.animate === false)
                        });
                        return;
                    }
                }
            } else {
                // Parcela sin manzana identificable (nomenclatura vacía o
                // corta): se le da igual un margen para que no quede sola.
                objetivo = boundsParcela.pad(0.35);
            }

            map.fitBounds(objetivo, {
                padding: [60, 60],
                maxZoom: 19,
                animate: !(opciones && opciones.animate === false)
            });
        }

        // Recupera el punto exacto asociado al polígono haciendo un análisis topológico espacial
        function getPointInLayer(layer, features) {
            if (!features || features.length === 0) return null;

            const bounds = layer.getBounds();
            const geojson = layer.toGeoJSON();

            let polygonCoords = [];
            if (geojson.geometry && geojson.geometry.type === "Polygon") {
                polygonCoords = geojson.geometry.coordinates[0];
            } else if (geojson.geometry && geojson.geometry.type === "MultiPolygon") {
                polygonCoords = geojson.geometry.coordinates[0][0];
            }

            let bestMatch = null;
            let minDistance = Infinity;
            const center = bounds.getCenter();

            // Candidatos: del índice si está disponible para ESTE conjunto de
            // puntos; si no, se recorre todo como antes (red de seguridad).
            let candidatos;
            if (indicePuntos && indicePuntosOrigen === features) {
                const sw = bounds.getSouthWest();
                const ne = bounds.getNorthEast();
                const gx0 = Math.floor(sw.lng / CELDA_INDICE), gx1 = Math.floor(ne.lng / CELDA_INDICE);
                const gy0 = Math.floor(sw.lat / CELDA_INDICE), gy1 = Math.floor(ne.lat / CELDA_INDICE);

                candidatos = [];
                for (let gx = gx0; gx <= gx1; gx++) {
                    for (let gy = gy0; gy <= gy1; gy++) {
                        const celda = indicePuntos.get(gx + ':' + gy);
                        if (celda) candidatos.push(...celda);
                    }
                }
                // CRÍTICO: restaurar el orden del archivo (ver comentario arriba).
                candidatos.sort((a, b) => a.idx - b.idx);
            } else {
                candidatos = [];
                for (let idx = 0; idx < features.length; idx++) {
                    const pt = features[idx];
                    if (!pt.geometry || pt.geometry.type !== 'Point') continue;
                    candidatos.push({ idx, lng: pt.geometry.coordinates[0], lat: pt.geometry.coordinates[1], pt });
                }
            }

            for (const c of candidatos) {
                const lng = c.lng, lat = c.lat;

                // Optimizador: solo analizar puntos dentro del Bounding Box de la parcela
                if (bounds.contains(L.latLng(lat, lng))) {
                    if (polygonCoords.length > 0 && isPointInPolygon([lat, lng], polygonCoords)) {
                        return c.pt;
                    }
                    // Fallback: el más cercano al centro si el polígono es deforme
                    const dist = Math.pow(lat - center.lat, 2) + Math.pow(lng - center.lng, 2);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestMatch = c.pt;
                    }
                }
            }
            return bestMatch;
        }

        function mergeProperties(polyProps, pointProps, sqlProps) {
            const merged = {};
            for (let key in polyProps) {
                if (polyProps[key] !== null && polyProps[key] !== undefined && String(polyProps[key]).trim() !== "") {
                    merged[key.toUpperCase()] = polyProps[key];
                }
            }
            for (let key in pointProps) {
                const upperKey = key.toUpperCase();
                if (pointProps[key] !== null && pointProps[key] !== undefined && String(pointProps[key]).trim() !== "") {
                    if (!merged[upperKey]) merged[upperKey] = pointProps[key];
                }
            }
            for (let key in sqlProps) {
                const upperKey = key.toUpperCase();
                if (sqlProps[key] !== null && sqlProps[key] !== undefined && String(sqlProps[key]).trim() !== "") {
                    if (!merged[upperKey]) merged[upperKey] = sqlProps[key];
                }
            }
            return merged;
        }

        function showModalLoading(title) {
            const modal = document.getElementById('parcel-modal');
            document.getElementById('modal-title').innerText = title || 'Cargando...';
            document.getElementById('modal-geo-info').innerHTML = `
                <div class="bg-blue-900 border border-blue-600/50 px-3 py-1.5 rounded-none font-semibold text-blue-200">SECCIÓN: <strong class="text-white font-black text-[11px]">-</strong></div>
                <div class="bg-blue-900 border border-blue-600/50 px-3 py-1.5 rounded-none font-semibold text-blue-200">MANZANA: <strong class="text-white font-black text-[11px]">-</strong></div>
                <div class="bg-blue-900 border border-blue-600/50 px-3 py-1.5 rounded-none font-semibold text-blue-200">PARCELA: <strong class="text-white font-black text-[11px]">-</strong></div>
            `;
            document.getElementById('modal-content').innerHTML = `
                <div class="flex flex-col items-center justify-center h-48 text-slate-400">
                    <div class="animate-spin rounded-full h-12 w-12 border-4 border-emerald-600 border-t-transparent mb-4"></div>
                    <p class="text-xs font-bold uppercase tracking-widest pulse-loading">Consultando Base de Datos...</p>
                </div>
            `;
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function closeModal() {
            const modal = document.getElementById('parcel-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        function showModalData(props) {
            document.getElementById('modal-title').innerText = props.NRO_RENTA || props.PADRON || props.NOMENCLA || props.NOMENCLATURA || props.NOMENCLATU || 'S/P';

            let nomenCompleta = String(props.NOMENCLA || props.NOMENCLATURA || props.NOMENCLATU || '').trim();
            let seccionValor = props.SECCION || '-';
            let manzanaValor = props.MANZANA || '-';
            let parcelaValor = props.PARCELA_ME || props.PARCELA || '-';

            if (nomenCompleta.length >= 16) {
                seccionValor = nomenCompleta.substring(0, 4);
                manzanaValor = nomenCompleta.substring(4, 10);
                parcelaValor = nomenCompleta.substring(10, 16);
            } else {
                if (seccionValor !== '-' && /^\d+$/.test(String(seccionValor).trim())) seccionValor = String(seccionValor).trim().padStart(4, '0');
                if (manzanaValor !== '-' && /^\d+$/.test(String(manzanaValor).trim())) manzanaValor = String(manzanaValor).trim().padStart(6, '0');
                if (parcelaValor !== '-' && /^\d+$/.test(String(parcelaValor).trim())) parcelaValor = String(parcelaValor).trim().padStart(6, '0');
            }

            const chip = (etiqueta, valor) => `
                <div class="chip-geo"><span>${etiqueta}</span><strong>${valor}</strong></div>
            `;

            let htmlGeoInfo = chip('SECCIÓN', seccionValor) + chip('MANZANA', manzanaValor) + chip('PARCELA', parcelaValor);

            // Si proviene de una PH, agregamos el tag de sub-parcela
            if (props.SUBPARCELA && String(props.SUBPARCELA).trim() !== '') {
                htmlGeoInfo += `<div class="chip-geo chip-geo-ph"><span>SUB-PARC</span><strong>${props.SUBPARCELA}</strong></div>`;
            }

            document.getElementById('modal-geo-info').innerHTML = htmlGeoInfo;

            /**
             * Campo de la ficha.
             *
             * Antes cada campo ocupaba una fila entera, así que ver los ~20
             * datos de una parcela obligaba a un scroll largo. Ahora van en dos
             * columnas y los que necesitan aire (nombres, nomenclatura) se
             * marcan como anchos. Un valor ausente se muestra en gris tenue
             * para que se distinga de un dato real corto.
             */
            const campo = (etiqueta, valor, ancho) => {
                const v = (valor === null || valor === undefined) ? '' : String(valor).trim();
                const vacio = v === '' || v === '-';
                return `
                    <div class="campo${ancho ? ' campo-ancho' : ''}">
                        <span class="campo-et">${etiqueta}</span>
                        <span class="campo-vl${vacio ? ' campo-vacio' : ''}">${vacio ? 'sin dato' : v}</span>
                    </div>
                `;
            };

            const bloque = (icono, titulo, contenido) => `
                <section class="bloque">
                    <header class="bloque-cab">
                        <span class="material-icons">${icono}</span>
                        <h4>${titulo}</h4>
                    </header>
                    <div class="bloque-cuerpo">${contenido}</div>
                </section>
            `;

            /**
             * Bloque de titulares.
             *
             * Una parcela puede tener varios: condominios, sucesiones y
             * propiedad horizontal. Sobre la base real son 4.645 parcelas con
             * más de un titular (el 23,5% de las que tienen titular), y una
             * llega a 29. Antes se mostraba solamente el primero y el resto
             * desaparecía sin ningún aviso, así que una ficha de tres
             * condóminos se veía completa mostrando uno.
             *
             * Si la respuesta trae la lista (TITULARES), se listan todos. Si no
             * la trae —una versión vieja del backend, por ejemplo— se cae al
             * titular suelto de siempre, para no quedar peor que antes.
             */
            const listaTitulares = Array.isArray(props.TITULARES) && props.TITULARES.length
                ? props.TITULARES
                : (props.APELLIDO || props.NOMBRE
                    ? [{ APELLIDO: props.APELLIDO, NOMBRE: props.NOMBRE, CALLE: props.CALLE,
                         NUMERACION: props.NUMERACION, BARRIO: props.BARRIO,
                         CODIGO_POS: props.CODIGO_POS, PROVINCIA: props.PROVINCIA }]
                    : []);

            const nombreDe = (t) => [t.APELLIDO, t.NOMBRE]
                .filter(x => x && String(x).trim()).join(' ').trim();

            const domicilioDe = (t) => {
                const partes = [];
                const calle = [t.CALLE, t.NUMERACION].filter(x => x && String(x).trim()).join(' ').trim();
                if (calle) partes.push(calle);
                const unidad = [
                    t.PISO && String(t.PISO).trim() ? 'Piso ' + String(t.PISO).trim() : '',
                    t.DEPARTAMENTO && String(t.DEPARTAMENTO).trim() ? 'Dpto ' + String(t.DEPARTAMENTO).trim() : ''
                ].filter(Boolean).join(' ');
                if (unidad) partes.push(unidad);
                const loc = [t.BARRIO, t.LOCALIDAD, t.PROVINCIA]
                    .filter(x => x && String(x).trim()).join(', ');
                if (loc) partes.push(loc);
                return partes.join(' · ');
            };

            let htmlTitulares;
            if (listaTitulares.length === 0) {
                htmlTitulares = '<div class="campo campo-ancho"><span class="campo-vl campo-vacio">sin titular registrado</span></div>';
            } else {
                htmlTitulares = '<div class="lista-titulares">' + listaTitulares.map((t, i) => {
                    const doc = [t.TIPO_DOCUMENTO, t.DOCUMENTO]
                        .filter(x => x && String(x).trim()).join(' ').trim();
                    const dom = domicilioDe(t);
                    const nombre = nombreDe(t);
                    return `
                        <div class="titular">
                            <span class="titular-orden">${i + 1}</span>
                            <div class="titular-datos">
                                <span class="titular-nombre">${nombre || '<span class="campo-vacio">sin nombre</span>'}</span>
                                ${doc ? `<span class="titular-doc">${doc}</span>` : ''}
                                ${dom ? `<span class="titular-dom">${dom}</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('') + '</div>';
            }

            // Cuando hay más de uno conviene decirlo en el encabezado: es la
            // diferencia entre "el titular" y "uno de varios".
            const tituloTitulares = listaTitulares.length > 1
                ? `Titulares <span class="contador">${listaTitulares.length}</span>`
                : 'Titular';

            const contenedorFicha = document.getElementById('modal-content');
            // Al abrir otra parcela el contenido se reemplaza pero el scroll se
            // queda donde estaba, así que la ficha nueva aparecía empezada por
            // la mitad. Se vuelve arriba siempre.
            contenedorFicha.scrollTop = 0;

            contenedorFicha.innerHTML =
                (props._DEMO ? `
                    <div class="aviso-demo">
                        <span class="material-icons">science</span>
                        <div>
                            <strong>Datos de prueba</strong>
                            <span>No hay conexión con la base municipal. Lo que se muestra es inventado y no corresponde a ninguna parcela real.</span>
                        </div>
                    </div>
                ` : '') +

                bloque('person', tituloTitulares, htmlTitulares) +

                bloque('landscape', 'Parcela', [
                    campo('NOMENCLATURA', props.NOMENCLA || props.NOMENCLATURA || props.NOMENCLATU, true),
                    campo('NRO. RENTA', props.NRO_RENTA || props.PADRON),
                    campo('CUENTA', props.CUENTA),
                    campo('SUPERFICIE TERRENO', props.SUP_TER),
                    campo('METROS DE FRENTE', props.MET_FRENTE),
                    campo('ZONIFICACIÓN', props.ZONIFICACION || props.CONCEPTO),
                    campo('ESQ. MEDIAL', props.ESQ_MED),
                    campo('BAL. EDIFICIO', props.BAL_EDIF),
                    campo('ACTIVO', props.ACTIVO === '1' || props.ACTIVO === 1 ? 'Sí' : props.ACTIVO),
                    // Datos de propiedad horizontal: estaban en la vista y no se
                    // mostraban. Solo aparecen cuando la parcela realmente es PH.
                    (Number(props.UNIDADES_LOCATIVAS) > 1
                        ? campo('UNIDADES LOCATIVAS', props.UNIDADES_LOCATIVAS) : ''),
                    (props.PORCENTAJE_COPROPIEDAD
                        ? campo('% COPROPIEDAD', props.PORCENTAJE_COPROPIEDAD) : '')
                ].join('')) +

                bloque('place', 'Ubicación', [
                    campo('CALLE', props.CALLE1),
                    campo('NRO', props.NRO),
                    campo('BARRIO', props.BARRIO1),
                    campo('DESIG. OFICIAL', props.DESIG_OFI, true)
                ].join(''));
        }

        /**
         * Captura el mapa para la plancheta.
         *
         * Antes se capturaba #map tal cual, así que la imagen salía con los
         * controles de zoom, el selector de capas y el cartel de atribución
         * encima. En un documento que se archiva o se entrega al vecino eso es
         * ruido. Acá se ocultan esos elementos, se saca la foto y se restauran.
         */
        // Proporción (ancho / alto) del marco donde entra el mapa en la
        // plancheta. Sale de las medidas reales de la hoja A4 apaisada: el
        // marco mide unos 146 mm de ancho por 135 de alto.
        const PROPORCION_MARCO_MAPA = 146 / 135;

        async function capturarMapaLimpio() {
            const contenedor = document.getElementById('map');
            const aOcultar = contenedor.querySelectorAll(
                '.leaflet-control-container, .leaflet-control-zoom, .leaflet-control-attribution'
            );
            const previos = [];

            aOcultar.forEach(el => {
                previos.push([el, el.style.visibility]);
                el.style.visibility = 'hidden';
            });

            // --------------------------------------------------------------
            // El mapa en pantalla es apaisado (más o menos 2,5 de ancho por 1
            // de alto) y el marco de la plancheta es casi cuadrado. Si se
            // captura tal cual y después se encaja en el marco, hay que
            // recortarle los costados: el terreno aparece cortado.
            //
            // Por eso, antes de la foto, se le da al mapa la MISMA proporción
            // que el marco de destino y se vuelve a encuadrar. Así la imagen
            // entra entera, sin recortar nada, y la parcela queda centrada.
            //
            // El cambio dura lo que tarda la captura y se deshace enseguida;
            // mientras tanto el usuario ve el indicador de carga.
            // --------------------------------------------------------------
            const anchoPrevio = contenedor.style.width;
            const altoPrevio = contenedor.style.height;
            const alto = contenedor.offsetHeight;
            const anchoObjetivo = Math.round(alto * PROPORCION_MARCO_MAPA);

            try {
                contenedor.style.width = anchoObjetivo + 'px';
                map.invalidateSize({ animate: false });

                // Con el nuevo tamaño hay que reencuadrar: si no, la parcela
                // queda descentrada o directamente fuera de la vista.
                if (selectedLayer && selectedLayer.feature) {
                    encuadrarParcela(selectedLayer, selectedLayer.feature, { animate: false });
                }
                await new Promise(r => setTimeout(r, 900)); // que carguen los tiles

                const canvas = await html2canvas(contenedor, { useCORS: true, scale: 2, logging: false });
                return canvas.toDataURL('image/jpeg', 0.85);
            } finally {
                contenedor.style.width = anchoPrevio;
                contenedor.style.height = altoPrevio;
                map.invalidateSize({ animate: false });
                previos.forEach(([el, valor]) => { el.style.visibility = valor; });
            }
        }

        // ====================================================================
        // CONSTANCIA DE LIBRE DE DEUDA (JUZGADO DE FALTAS)
        // --------------------------------------------------------------------
        // Documento distinto de la plancheta catastral y para otro trámite:
        // certifica que el titular no registra infracciones. El texto, el orden
        // y la redacción vienen de la plantilla LIBRE__DEUDA__DE__FALTAS.docx
        // que usa la Municipalidad, así que NO se tocan: es un documento con
        // valor administrativo y tiene que salir como lo esperan en la mesa de
        // entrada.
        //
        // A diferencia de la plancheta, es solo texto: no lleva captura del
        // mapa, así que no interviene html2canvas.
        //
        // Los campos van editables a propósito (contenteditable), para que el
        // agente pueda corregir cualquier dato antes de imprimir, y el N° de
        // ticket queda en blanco porque se completa a mano.
        // ====================================================================
        const DIAS_EN_LETRAS = [
            '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
            'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
            'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE', 'TREINTA', 'TREINTA Y UNO'
        ];
        const MESES_EN_LETRAS = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
        function diaEnLetras(dia) { return DIAS_EN_LETRAS[dia] || String(dia); }

        async function imprimirLibreDeuda() {
            if (!currentFeatureProps) return;
            closeModal();
            document.getElementById('loader').style.display = 'flex';

            try {
                const p = currentFeatureProps;
                const nomen = p.NOMENCLA || p.NOMENCLATURA || p.NOMENCLATU || 'S/N';

                // Misma descomposición de la nomenclatura que la plancheta.
                let nomenCompleta = String(nomen).trim();
                let seccionValor = p.SECCION || '-';
                let manzanaValor = p.MANZANA || '-';
                let parcelaValor = p.PARCELA_ME || p.PARCELA || '-';

                if (nomenCompleta.length >= 16) {
                    seccionValor = nomenCompleta.substring(0, 4);
                    manzanaValor = nomenCompleta.substring(4, 10);
                    parcelaValor = nomenCompleta.substring(10, 16);
                } else {
                    if (seccionValor !== '-' && /^\d+$/.test(String(seccionValor).trim())) seccionValor = String(seccionValor).trim().padStart(4, '0');
                    if (manzanaValor !== '-' && /^\d+$/.test(String(manzanaValor).trim())) manzanaValor = String(manzanaValor).trim().padStart(6, '0');
                    if (parcelaValor !== '-' && /^\d+$/.test(String(parcelaValor).trim())) parcelaValor = String(parcelaValor).trim().padStart(6, '0');
                }

                // Fecha redactada como la exige el formato protocolar:
                // "A LOS VEINTICINCO DÍAS DEL MES DE JUNIO DEL AÑO 2026".
                const hoy = new Date();
                const diaTexto = diaEnLetras(hoy.getDate());
                const mesTexto = MESES_EN_LETRAS[hoy.getMonth()];
                const anioTexto = hoy.getFullYear();

                // --------------------------------------------------------
                // De dónde salen los datos del titular.
                //
                // La lista TITULARES es la fuente buena: una parcela puede
                // tener varios condóminos. El documento, en cambio, está
                // redactado en singular ("EL/LA SR./SRA. ..."), que es como lo
                // usa el Juzgado, así que se completa con el primero y el campo
                // queda editable.
                //
                // Cuando hay más de uno se avisa EN PANTALLA, en la zona que no
                // se imprime: sin eso, la constancia saldría a nombre de un
                // solo condómino sin que nadie lo note. Es el mismo problema de
                // fondo que ya arreglamos en la ficha, y acá importa más porque
                // el papel se entrega.
                // --------------------------------------------------------
                const titulares = Array.isArray(p.TITULARES) && p.TITULARES.length
                    ? p.TITULARES
                    : (p.APELLIDO || p.NOMBRE
                        ? [{ APELLIDO: p.APELLIDO, NOMBRE: p.NOMBRE, CALLE: p.CALLE,
                             NUMERACION: p.NUMERACION, DOCUMENTO: p.DOCUMENTO }]
                        : []);
                const titular = titulares[0] || {};

                const nombreTitular = `${titular.APELLIDO || ''} ${titular.NOMBRE || ''}`.trim() || 'S/D';
                const domicilioTitular = `${titular.CALLE || 'S/D'} N° ${titular.NUMERACION || '---'}`;
                const numdocumento = `${titular.DOCUMENTO || ''}`;

                const origen = CONFIG.API_BASE || window.location.origin;

                // Escapado defensivo, igual que en la plancheta: los datos
                // vienen de la base y se insertan en HTML.
                const esc = (v) => String(v === null || v === undefined ? '' : v)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

                const avisoVariosTitulares = titulares.length > 1 ? `
                    <div class="aviso-condominos no-print">
                        <b>Atención:</b> esta parcela tiene ${titulares.length} titulares registrados.
                        La constancia se completó con el primero
                        (${esc(nombreTitular)}). Si corresponde nombrar a otro, o a todos,
                        corregilo en el documento antes de imprimir: los campos se editan
                        haciendo clic.
                        <div class="lista-condominos">
                            ${titulares.map((t, i) => `<div>${i + 1}. ${esc(`${t.APELLIDO || ''} ${t.NOMBRE || ''}`.trim())}${t.DOCUMENTO ? ` — DNI ${esc(t.DOCUMENTO)}` : ''}</div>`).join('')}
                        </div>
                    </div>` : '';

                const printWindow = window.open('', '_blank');
                if (!printWindow) {
                    alert('El navegador bloqueó la ventana del documento.\n\nHabilitá las ventanas emergentes para este sitio y volvé a intentar.');
                    return;
                }

                printWindow.document.write(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Libre de Deuda de Faltas - ${esc(p.NRO_RENTA || p.PADRON || '')}</title>
<style>
    /* SIN DEPENDENCIAS EXTERNAS
       La versión anterior de este documento cargaba Tailwind desde internet
       para dos o tres clases. En una computadora municipal sin salida a
       internet eso deja el documento sin estilos justo cuando hay que
       imprimirlo. Acá está todo el CSS que necesita, escrito a mano. */
    @media print {
        @page { size: A4 portrait; margin: 18mm; }
        .no-print { display: none !important; }
        body { -webkit-print-color-adjust: exact; }
    }
    body { font-family: 'Arial', sans-serif; font-size: 13px; color: #000; line-height: 1.6; margin: 0; padding: 18mm; }

    /* El escudo queda fijo en su posición original (borde izquierdo del
       encabezado): se saca del flujo con position:absolute para que no empuje
       ni condicione al bloque de texto. El título y el subtítulo, al ser un
       bloque normal a ancho completo, se centran sobre toda la hoja de forma
       independiente de dónde está el escudo. */
    .header-faltas { position: relative; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 24px; }
    .escudo-box { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; }
    .escudo-box img { max-width: 100%; max-height: 100%; }
    .titulo-faltas { font-size: 26px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; line-height: 1; text-align: center; }
    .subtitulo-faltas { font-size: 13px; font-weight: 700; margin-top: 4px; text-align: center; }
    .titulo-doc { text-align: center; font-size: 16px; font-weight: 800; text-decoration: underline; text-transform: uppercase; margin-bottom: 24px; }
    .cuerpo-parrafo { text-align: justify; text-transform: uppercase; margin-bottom: 18px; }

    /* Campos corregibles: subrayado punteado sutil, y resaltan en amarillo al
       hacer foco, para que se vea de un vistazo qué se puede editar. */
    .campo-editable { outline: none; cursor: text; border-bottom: 1px dashed #94a3b8; padding: 0 2px; }
    .campo-editable:focus { background: #fef9c3; border-bottom: 1px solid #ca8a04; }
    .obs-linea { margin-bottom: 15px; }
    .ticket-field {
        outline: none; cursor: text; font-weight: 800; border: 1px solid #000;
        padding: 3px 15px; display: inline-block; min-width: 180px;
    }
    .ticket-field:focus { background: #fef9c3; }
    .ticket-field:empty:before { content: attr(data-placeholder); color: #9ca3af; font-weight: 400; }
    .firma-block { margin-top: 70px; font-size: 13px; }
    .firma-linea { margin-bottom: 12px; }

    /* Aviso de condóminos: solo pantalla, nunca sale impreso. */
    .aviso-condominos {
        background: #fef3c7; border: 1px solid #f59e0b; color: #78350f;
        padding: 10px 14px; margin-bottom: 20px; font-size: 12px; line-height: 1.5;
    }
    .lista-condominos { margin-top: 6px; font-weight: 700; }

    .pie-acciones { margin-top: 60px; text-align: center; }
    .boton-imprimir {
        background: #4338ca; color: #fff; border: none; cursor: pointer;
        padding: 12px 32px; font-weight: 800; font-size: 11px;
        text-transform: uppercase; letter-spacing: .1em;
        box-shadow: 0 4px 12px rgba(67,56,202,.25);
    }
    .boton-imprimir:hover { background: #3730a3; }
    .nota-pie { font-size: 10px; color: #6b7280; margin-top: 8px; }
</style>
</head>
<body>
    ${avisoVariosTitulares}

    <div class="header-faltas">
        <div class="escudo-box">
            <img src="${origen}/img/escudoMerlo.jpg" alt="Escudo de Villa de Merlo">
        </div>
        <div>
            <div class="titulo-faltas">Juzgado de Faltas</div>
            <div class="subtitulo-faltas">Villa de Merlo</div>
        </div>
    </div>

    <div class="titulo-doc">Constancia de Libre de Deuda</div>

    <p class="cuerpo-parrafo">
        POR LA PRESENTE SE DEJA CONSTANCIA QUE
        <span class="campo-editable" contenteditable="true">EL/LA SR./SRA.</span>
        <span class="campo-editable" contenteditable="true">${esc(nombreTitular)}</span>,
        D.N.I. N°<span class="campo-editable" contenteditable="true">${esc(numdocumento)}</span>,
        CON DOMICILIO EN CALLE <span class="campo-editable" contenteditable="true">${esc(domicilioTitular)}</span>,
        VILLA DE MERLO, SAN LUIS, PROPIETARIO/A DEL INMUEBLE QUE SE DESIGNA COMO SECCIÓN
        <span class="campo-editable" contenteditable="true">${esc(seccionValor)}</span>,
        MANZANA <span class="campo-editable" contenteditable="true">${esc(manzanaValor)}</span>,
        PARCELA <span class="campo-editable" contenteditable="true">${esc(parcelaValor)}</span>,
        NO REGISTRA ANTECEDENTES MOTIVADOS EN INFRACCIONES DETECTADAS POR INSPECTORES DE LA
        MUNICIPALIDAD DE LA VILLA DE MERLO, SAN LUIS. --------
    </p>

    <p class="cuerpo-parrafo">
        LA VIGENCIA DE LA CONSTANCIA SE EXTIENDE POR EL TÉRMINO DE <b>48 HORAS</b>, PARA SER
        PRESENTADOS ANTE LA AUTORIDAD MUNICIPAL REQUIRENTE; EN LA VILLA DE MERLO, SAN LUIS,
        A LOS <span class="campo-editable" contenteditable="true">${esc(diaTexto)}</span> DÍAS DEL MES DE
        <span class="campo-editable" contenteditable="true">${esc(mesTexto)}</span> DEL AÑO
        <span class="campo-editable" contenteditable="true">${esc(anioTexto)}</span>.
    </p>

    <div class="obs-linea">
        <u>OBSERVACIONES:</u> N° DE TICKET DE LIBRE DE DEUDA:
        <span class="ticket-field" contenteditable="true" data-placeholder="Completar N°"></span>
    </div>

    <div class="firma-block">
        <div class="firma-linea">Firma del solicitante: ...........................</div>
        <div class="firma-linea">Aclaración: ..................................</div>
        <div class="firma-linea">DNI: ...............</div>
    </div>

    <div class="pie-acciones no-print">
        <button class="boton-imprimir" onclick="window.print()">Imprimir Libre Deuda</button>
        <p class="nota-pie">
            Revise y complete los campos editables (resaltan en amarillo al hacer clic)
            antes de imprimir, especialmente el N° de Ticket.
        </p>
    </div>
</body>
</html>
                `);
                printWindow.document.close();
            } catch (e) {
                console.error('❌ No se pudo generar el Libre de Deuda:', e);
            } finally {
                document.getElementById('loader').style.display = 'none';
            }
        }

        async function imprimirFicha() {
            if (!currentFeatureProps) return;
            closeModal();
            document.getElementById('loader').style.display = 'flex';

            try {
                // Se espera un instante a que el modal termine de cerrarse para
                // que no aparezca su sombra en la captura.
                await new Promise(r => setTimeout(r, 250));

                // capturarMapaLimpio() se encarga de reencuadrar la parcela
                // dentro de su manzana antes de la foto, con el mapa ya puesto
                // en la proporción del marco de la plancheta.
                const imgData = await capturarMapaLimpio();

                const p = currentFeatureProps;
                const nomen = p.NOMENCLA || p.NOMENCLATURA || p.NOMENCLATU || 'S/N';

                let nomenCompleta = String(nomen).trim();
                let seccionValor = p.SECCION || '-';
                let manzanaValor = p.MANZANA || '-';
                let parcelaValor = p.PARCELA_ME || p.PARCELA || '-';

                if (nomenCompleta.length >= 16) {
                    seccionValor = nomenCompleta.substring(0, 4);
                    manzanaValor = nomenCompleta.substring(4, 10);
                    parcelaValor = nomenCompleta.substring(10, 16);
                } else {
                    if (seccionValor !== '-' && /^\d+$/.test(String(seccionValor).trim())) seccionValor = String(seccionValor).trim().padStart(4, '0');
                    if (manzanaValor !== '-' && /^\d+$/.test(String(manzanaValor).trim())) manzanaValor = String(manzanaValor).trim().padStart(6, '0');
                    if (parcelaValor !== '-' && /^\d+$/.test(String(parcelaValor).trim())) parcelaValor = String(parcelaValor).trim().padStart(6, '0');
                }

                const subparc = p.SUBPARCELA || '---';
                const padron = p.NRO_RENTA || p.PADRON || '-';
                const origen = CONFIG.API_BASE || window.location.origin;

                const ahora = new Date();
                const fechaEmision = ahora.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const horaEmision = ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

                // Escapado defensivo: los datos vienen de la base municipal y
                // se insertan en HTML. Sin esto, un apellido con "&" o "<"
                // rompería el documento.
                const esc = (v) => String(v === null || v === undefined ? '' : v)
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const dato = (v) => { const s = esc(v).trim(); return s === '' ? '<span class="vacio">—</span>' : s; };

                const titular = [p.APELLIDO, p.NOMBRE].map(x => esc(x || '').trim()).filter(Boolean).join(' ');

                // Un domicilio sin calle ni altura debe mostrar un solo guion,
                // no "— N.º —", que parece un dato a medias en vez de un vacio.
                const armarDomicilio = (calle, numero) => {
                    const c = esc(calle || '').trim();
                    const n = esc(numero || '').trim();
                    if (!c && !n) return '<span class="vacio">&mdash;</span>';
                    if (!n) return c;
                    if (!c) return 'N.º ' + n;
                    return c + ' &nbsp;N.º ' + n;
                };
                const domicilioInmueble = armarDomicilio(p.DIRECCION || p.CALLE1, p.NRO || p.NUMERACION || p.ALTURA);
                const domicilioPostal   = armarDomicilio(p.CALLE, p.NUMERACION);

                // ------------------------------------------------------------
                // TABLA DE TITULARES
                //
                // Se listan TODOS. Una plancheta con un solo nombre donde hay
                // tres condóminos es un documento incorrecto, y se entrega al
                // vecino. Si son muchos la tabla crece y puede pasar a una
                // segunda hoja: preferible dos hojas completas a una incompleta.
                //
                // El campo de nombre queda editable, como estaba antes, para
                // poder corregir a mano sobre el documento.
                // ------------------------------------------------------------
                const titulares = Array.isArray(p.TITULARES) && p.TITULARES.length
                    ? p.TITULARES
                    : (p.APELLIDO || p.NOMBRE
                        ? [{ APELLIDO: p.APELLIDO, NOMBRE: p.NOMBRE, CALLE: p.CALLE,
                             NUMERACION: p.NUMERACION, BARRIO: p.BARRIO,
                             CODIGO_POS: p.CODIGO_POS, PROVINCIA: p.PROVINCIA }]
                        : []);

                const tituloSeccionTitulares = titulares.length > 1
                    ? `Titulares (${titulares.length})`
                    : 'Datos del titular';

                // ------------------------------------------------------------
                // La plancheta tiene que entrar en UNA hoja.
                //
                // El alto disponible para esta tabla es fijo, así que en vez de
                // dejar que crezca y desborde, la densidad se ajusta a la
                // cantidad: con pocos titulares las filas van cómodas, con
                // muchos se compactan. Pasado cierto punto ya no se puede
                // achicar más sin volverlo ilegible, y ahí se listan los que
                // entran y se deja constancia de cuántos faltan (nunca se
                // ocultan en silencio: el aviso es parte del documento).
                // ------------------------------------------------------------
                // Los topes salen de medir el alto real del documento contra el
                // alto útil de una A4 apaisada (192 mm ≈ 726 px), no de una
                // estimación: con 12 titulares y filas compactas el contenido
                // se pasaba 158 px y saltaba a una segunda hoja.
                // Medido: con la columna de datos por encima de ~568 px la hoja
                // se parte en dos. Cada fila de titular ocupa unos 20 px, así
                // que ocho es el máximo que entra dejando lugar al resto de las
                // secciones.
                let densidad, tope;
                if (titulares.length <= 4)      { densidad = 'comoda';       tope = 4; }
                else if (titulares.length <= 6) { densidad = 'compacta';     tope = 6; }
                else                            { densidad = 'muy-compacta'; tope = 7; }

                const visibles = titulares.slice(0, tope);
                const ocultos = titulares.length - visibles.length;

                let tablaTitulares;
                if (titulares.length === 0) {
                    tablaTitulares = `
                        <table class="datos">
                            <tr>
                                <td colspan="3">
                                    <span class="et">Apellido y nombre / Razón social</span>
                                    <span class="vl editable" contenteditable="true"></span>
                                </td>
                            </tr>
                        </table>`;
                } else {
                    const filas = visibles.map((t, i) => {
                        const nombre = [t.APELLIDO, t.NOMBRE]
                            .map(x => esc(x || '').trim()).filter(Boolean).join(' ');
                        const doc = [t.TIPO_DOCUMENTO, t.DOCUMENTO]
                            .map(x => esc(x || '').trim()).filter(Boolean).join(' ');
                        const dom = armarDomicilio(t.CALLE, t.NUMERACION);
                        const lugar = [t.BARRIO, t.LOCALIDAD, t.PROVINCIA, t.CODIGO_POS]
                            .map(x => esc(x || '').trim()).filter(Boolean).join(', ');

                        // Con las filas compactas el domicilio va en una sola
                        // línea: dos líneas por titular multiplican el alto.
                        // Con densidad cómoda entra el domicilio completo en dos
                        // líneas. Compactado, se recorta a calle + número +
                        // barrio y se fuerza UNA sola línea: dos líneas por
                        // titular duplican el alto de la tabla y es lo que
                        // empujaba la plancheta a una segunda hoja.
                        const barrio = esc(t.BARRIO || '').trim();
                        const domCompleto = densidad === 'comoda'
                            ? `<span class="vl">${dom}</span>${lugar ? `<span class="sub">${lugar}</span>` : ''}`
                            : `<span class="vl una-linea">${dom}${barrio ? ' · ' + barrio : ''}</span>`;

                        return `
                            <tr>
                                <td class="col-orden">${titulares.length > 1 ? (i + 1) : ''}</td>
                                <td class="col-nombre">
                                    <span class="vl editable${densidad === 'comoda' ? '' : ' una-linea'}" contenteditable="true">${nombre || ''}</span>
                                    ${doc ? `<span class="sub">${doc}</span>` : ''}
                                </td>
                                <td class="col-domicilio">${domCompleto}</td>
                            </tr>`;
                    }).join('');

                    const aviso = ocultos > 0
                        ? `<tr class="resto">
                               <td class="col-orden"></td>
                               <td colspan="2">y ${ocultos} titular${ocultos > 1 ? 'es' : ''} más, no listado${ocultos > 1 ? 's' : ''} por espacio — consultar la ficha completa en el visor</td>
                           </tr>`
                        : '';

                    tablaTitulares = `
                        <table class="datos tabla-titulares ${densidad}">
                            <tr class="cab">
                                <td class="col-orden">${titulares.length > 1 ? '#' : ''}</td>
                                <td class="col-nombre"><span class="et">Apellido y nombre / Razón social</span></td>
                                <td class="col-domicilio"><span class="et">Domicilio postal</span></td>
                            </tr>
                            ${filas}
                            ${aviso}
                        </table>`;
                }

                const printWindow = window.open('', '_blank');
                if (!printWindow) {
                    alert('El navegador bloqueó la ventana de la plancheta.\n\nHabilitá las ventanas emergentes para este sitio y volvé a intentar.');
                    return;
                }

                printWindow.document.write(`
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Plancheta Catastral ${esc(padron)} - Villa de Merlo</title>
<style>
    /* ================================================================
       PLANCHETA CATASTRAL - hoja A4 apaisada
       ----------------------------------------------------------------
       Sin dependencias externas: todo el estilo va acá. Antes esta
       ventana cargaba Tailwind desde un CDN, así que si la conexión
       fallaba el documento salía impreso sin ningún formato. Un
       documento que se archiva no puede depender de una descarga.
       ================================================================ */
    @page { size: A4 landscape; margin: 9mm; }

    :root {
        --tinta:      #111827;
        --tenue:      #6b7280;
        --linea:      #9ca3af;
        --linea-fina: #d1d5db;
        --institucional: #064e3b;
        --realce:     #f3f4f6;
    }

    * { box-sizing: border-box; }

    body {
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        font-size: 9.5px;
        line-height: 1.35;
        color: var(--tinta);
        margin: 0;
        padding: 14px 16px;
        background: #fff;
    }

    /* ---------- Encabezado ---------- */
    .encabezado {
        display: flex;
        justify-content: space-between;
        align-items: stretch;
        gap: 14px;
        border-bottom: 2.5px solid var(--institucional);
        padding-bottom: 7px;
        margin-bottom: 8px;
    }
    .escudo {
        width: 54px; height: 54px;
        flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        border: 1px solid var(--linea-fina);
        padding: 3px; background: #fff;
    }
    .escudo img { max-width: 100%; max-height: 100%; }

    .titulo-bloque { flex-grow: 1; }
    .titulo {
        font-size: 15px; font-weight: 700;
        letter-spacing: .07em; text-transform: uppercase;
        color: var(--institucional);
        margin-bottom: 2px;
    }
    .subtitulo { font-size: 8.5px; color: var(--tenue); letter-spacing: .04em; }

    .organismo { text-align: right; font-size: 8.5px; line-height: 1.45; flex-shrink: 0; }
    .organismo .fuerte { font-weight: 700; font-size: 9.5px; color: var(--tinta); }

    /* Identificación destacada: lo primero que se busca en la hoja */
    .identificacion {
        display: flex; gap: 0; margin-bottom: 8px;
        border: 1.5px solid var(--institucional);
    }
    .ident-celda {
        padding: 5px 11px;
        border-right: 1px solid var(--linea-fina);
        flex: 1;
    }
    .ident-celda:last-child { border-right: none; }
    /* EL PADRON NO LLEVA FONDO DE COLOR
       Es el dato que más se busca en la hoja, así que la primera versión lo
       destacaba con el verde institucional de fondo y el número en blanco. En
       pantalla se veía bien, pero estas planchetas se imprimen casi siempre en
       blanco y negro: ahí el verde se convierte en una mancha gris oscura y el
       número, que era blanco, queda ilegible.
       Se destaca con el tamaño y el grosor de la tipografía, que se ven igual
       en cualquier impresora y no dependen del color. */
    .ident-celda.principal { flex: 0 0 27%; }
    .ident-celda .et {
        font-size: 7px; text-transform: uppercase; letter-spacing: .11em;
        display: block; margin-bottom: 2px; color: var(--tenue);
    }
    .ident-celda .vl { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    /* La nomenclatura tiene 22 digitos: se achica lo justo para no partirse. */
    .ident-celda.nomenclatura { flex: 0 0 24%; }
    .ident-celda.nomenclatura .vl { font-size: 11px; letter-spacing: -.01em; }
    .ident-celda.principal .vl {
        font-size: 17px; letter-spacing: .01em;
        font-weight: 800; color: var(--institucional);
    }

    /* ---------- Cuerpo en dos columnas ---------- */
    .cuerpo { display: flex; gap: 11px; align-items: flex-start; }
    .col-datos { width: 46%; flex-shrink: 0; }
    .col-mapa  { width: 54%; display: flex; flex-direction: column; }

    .seccion-titulo {
        font-size: 8px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .13em; color: var(--institucional);
        margin: 5px 0 2px; padding-bottom: 2px;
        border-bottom: 1px solid var(--institucional);
    }
    .seccion-titulo:first-child { margin-top: 0; }

    /* table-layout: fixed mantiene las columnas alineadas entre filas y entre
       tablas. Sin esto cada tabla reparte el ancho según su contenido y las
       secciones quedan desalineadas entre sí. */
    table.datos { width: 100%; border-collapse: collapse; border: 1px solid var(--linea); table-layout: fixed; }
    table.datos td {
        border: 1px solid var(--linea-fina);
        padding: 4px 6px;
        vertical-align: top;
    }
    .et {
        font-size: 7px; font-weight: 600; text-transform: uppercase;
        letter-spacing: .07em; color: var(--tenue);
        display: block; margin-bottom: 1px;
    }
    .vl {
        font-size: 10.5px; font-weight: 600; color: var(--tinta);
        display: block; min-height: 13px; word-break: break-word;
    }
    .vl.numero { font-variant-numeric: tabular-nums; }
    /* Una línea con puntos suspensivos: mantiene el alto de la fila previsible */
    .vl.recorte { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .vacio { color: #c5cad3; font-weight: 400; }

    /* Campos que el operador completa a mano sobre el documento */
    .editable {
        outline: none; cursor: text;
        background: #fffdf3;
        border-bottom: 1px dashed #d6c48a;
        min-height: 13px;
    }
    .editable:focus { background: #fff9e0; }

    /* ---------- Marca de datos de prueba ----------
       Va IMPRESA, no solo en pantalla. Una plancheta de demostración se ve
       igual que una real: si alguien la imprime y la archiva sin esta franja,
       queda un documento falso circulando. Por eso se imprime en rojo, arriba
       de todo y con print-color-adjust, para que salga aunque el navegador
       intente ahorrar tinta. */
    .franja-demo {
        background: #b91c1c;
        color: #fff;
        text-align: center;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .16em;
        padding: 5px 8px;
        margin-bottom: 9px;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    /* ---------- Tabla de titulares ----------
       Una parcela puede tener uno o treinta titulares, y la plancheta tiene
       que entrar SIEMPRE en una hoja. La densidad de las filas se ajusta a la
       cantidad (clases .comoda / .compacta / .muy-compacta que pone el JS).

       table-layout: fixed es lo que mantiene las columnas alineadas: sin eso
       el navegador reparte el ancho según el contenido y cada fila queda con
       las columnas corridas respecto de la anterior. */
    .tabla-titulares { table-layout: fixed; }
    .tabla-titulares td { padding: 3px 6px; vertical-align: top; }
    .tabla-titulares tr.cab td { background: var(--realce); padding: 2px 6px; }

    .tabla-titulares .col-orden {
        width: 18px; text-align: center;
        font-size: 8.5px; font-weight: 700; color: var(--tenue);
        font-variant-numeric: tabular-nums;
    }
    .tabla-titulares .col-nombre    { width: 47%; }
    .tabla-titulares .col-domicilio { width: 47%; }

    .tabla-titulares .vl {
        font-size: 10px; min-height: 0;
        overflow-wrap: break-word;
    }
    .tabla-titulares .sub {
        display: block;
        font-size: 8px; color: var(--tenue);
        font-variant-numeric: tabular-nums;
        margin-top: 0;
        overflow-wrap: break-word;
    }

    /* Densidades: mismo diseño, distinto aire según cuántos titulares haya */
    .tabla-titulares.comoda td       { padding: 4px 6px; }
    .tabla-titulares.comoda .vl      { font-size: 10.5px; line-height: 1.3; }

    .tabla-titulares.compacta td     { padding: 2px 6px; }
    .tabla-titulares.compacta .vl    { font-size: 9.5px; line-height: 1.2; }
    .tabla-titulares.compacta .sub   { font-size: 7.5px; line-height: 1.15; }

    .tabla-titulares.muy-compacta td   { padding: 1px 5px; }
    .tabla-titulares.muy-compacta .vl  { font-size: 8.5px; line-height: 1.15; }
    .tabla-titulares.muy-compacta .sub { font-size: 7px; line-height: 1.1; }

    /* Una sola línea, recortando con puntos suspensivos si no entra.
       Garantiza que cada titular ocupe un alto fijo y previsible. */
    .tabla-titulares .una-linea {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Aviso de los que no entraron: nunca se ocultan sin decirlo */
    .tabla-titulares tr.resto td {
        font-size: 7.5px; font-style: italic; color: var(--tenue);
        background: var(--realce); padding: 3px 6px;
    }

    /* Una fila no se parte entre dos hojas */
    .tabla-titulares tr { page-break-inside: avoid; break-inside: avoid; }

    .caja-observaciones {
        border: 1px solid var(--linea);
        min-height: 52px; padding: 5px;
    }
    .caja-observaciones div { outline: none; min-height: 42px; font-size: 9.5px; }

    /* ---------- Mapa ---------- */
    .mapa-cabecera {
        display: flex; justify-content: space-between; align-items: baseline;
        margin-bottom: 3px;
    }
    .mapa-rotulo {
        font-size: 8px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .13em; color: var(--institucional);
    }
    .mapa-nota { font-size: 7.5px; color: var(--tenue); }
    .marco-mapa {
        border: 1.5px solid var(--linea);
        padding: 3px; background: #fff;
        flex-grow: 1; min-height: 330px;
    }
    /* 'contain' y no 'cover': la imagen ya viene con la proporción del marco
       (ver PROPORCION_MARCO_MAPA), así que llena el espacio sin que se recorte
       nada. Si alguna vez la proporción no coincidiera, es preferible una
       banda de aire antes que un terreno cortado. */
    .marco-mapa img { width: 100%; height: 100%; object-fit: contain; display: block; }

    .referencias {
        display: flex; gap: 13px; margin-top: 5px;
        font-size: 7.5px; color: var(--tenue); align-items: center;
    }
    .muestra { display: inline-block; width: 15px; height: 9px; margin-right: 3px; vertical-align: middle; border: 1px solid rgba(0,0,0,.35); }
    .muestra.parcela { background: rgba(245,158,11,.55); border-color: #f59e0b; }
    .muestra.manzana { background: rgba(14,165,233,.28); border-color: #0ea5e9; }

    /* ---------- Pie ---------- */
    .pie {
        margin-top: 6px; padding-top: 4px;
        border-top: 1px solid var(--linea-fina);
        display: flex; justify-content: space-between;
        font-size: 7.5px; color: var(--tenue);
    }

    /* ---------- Barra de acciones (no se imprime) ---------- */
    .acciones {
        position: fixed; top: 0; left: 0; right: 0;
        background: var(--institucional); color: #fff;
        padding: 9px 16px;
        display: flex; justify-content: space-between; align-items: center;
        box-shadow: 0 2px 9px rgba(0,0,0,.22);
        z-index: 99;
    }
    .acciones .leyenda { font-size: 11px; letter-spacing: .03em; }
    .acciones .leyenda strong { font-weight: 700; }
    .acciones .grupo { display: flex; gap: 8px; }
    .boton {
        border: none; cursor: pointer;
        padding: 7px 17px;
        font-size: 11px; font-weight: 700;
        letter-spacing: .05em; text-transform: uppercase;
        font-family: inherit;
    }
    .boton.principal { background: #fff; color: var(--institucional); }
    .boton.principal:hover { background: #d1fae5; }
    .boton.secundario { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.55); }
    .boton.secundario:hover { background: rgba(255,255,255,.14); }

    body { padding-top: 60px; }

    @media print {
        .acciones { display: none !important; }
        body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .editable { background: transparent; border-bottom: 1px solid var(--linea-fina); }
    }
</style>
</head>
<body>

<div class="acciones">
    <div class="leyenda">
        Plancheta lista. Para guardarla como PDF elegí <strong>Guardar como PDF</strong> en el destino de impresión.
    </div>
    <div class="grupo">
        <button class="boton principal" onclick="window.print()">Descargar / Imprimir PDF</button>
        <button class="boton secundario" onclick="window.close()">Cerrar</button>
    </div>
</div>

${p._DEMO ? `
<div class="franja-demo">
    DOCUMENTO SIN VALIDEZ &middot; DATOS DE PRUEBA &middot; NO CORRESPONDE A NINGUNA PARCELA REAL
</div>` : ''}

<div class="encabezado">
    <div class="escudo">
        <img src="${origen}/img/escudoMerlo.jpg" alt="Escudo de Villa de Merlo">
    </div>
    <div class="titulo-bloque">
        <div class="titulo">Plancheta Catastral</div>
        <div class="subtitulo">Ficha descriptiva y gráfica de la parcela</div>
    </div>
    <div class="organismo">
        <div class="fuerte">Municipalidad de Villa de Merlo</div>
        <div>Secretaría de Ordenamiento Territorial y Planificación Urbana</div>
        <div>Dirección de Catastro</div>
        <div>Provincia de San Luis</div>
    </div>
</div>

<div class="identificacion">
    <div class="ident-celda principal">
        <span class="et">Padrón / Nro. Renta</span>
        <span class="vl">${esc(padron)}</span>
    </div>
    <div class="ident-celda nomenclatura">
        <span class="et">Nomenclatura catastral</span>
        <span class="vl numero">${esc(nomen)}</span>
    </div>
    <div class="ident-celda">
        <span class="et">Sección</span>
        <span class="vl numero">${esc(seccionValor)}</span>
    </div>
    <div class="ident-celda">
        <span class="et">Manzana</span>
        <span class="vl numero">${esc(manzanaValor)}</span>
    </div>
    <div class="ident-celda">
        <span class="et">Parcela</span>
        <span class="vl numero">${esc(parcelaValor)}</span>
    </div>
</div>

<div class="cuerpo">
    <div class="col-datos">

        <div class="seccion-titulo">Datos del inmueble</div>
        <table class="datos">
            <tr>
                <td colspan="4">
                    <span class="et">Domicilio del inmueble</span>
                    <span class="vl">${domicilioInmueble}</span>
                </td>
            </tr>
            <tr>
                <td width="25%"><span class="et">Superficie terreno</span><span class="vl numero">${dato(p.SUP_TER)}${p.SUP_TER ? ' m²' : ''}</span></td>
                <td width="25%"><span class="et">Metros de frente</span><span class="vl numero">${dato(p.MET_FRENTE)}</span></td>
                <td width="25%"><span class="et">Esquina / Medial</span><span class="vl">${dato(p.ESQ_MED)}</span></td>
                <td width="25%"><span class="et">Estado edificación</span><span class="vl">${dato(p.BAL_EDIF)}</span></td>
            </tr>
            <tr>
                <td colspan="2"><span class="et">N.º de contribuyente</span><span class="vl numero">${dato(p.CUENTA)}</span></td>
                <td colspan="2"><span class="et">Designación oficial</span><span class="vl recorte">${dato(p.DESIG_OFI)}</span></td>
            </tr>
            <tr>
                <td colspan="2">
                    <span class="et">Sub-parcela (PH)</span>
                    <span class="vl editable" contenteditable="true">${esc(subparc)}</span>
                </td>
                <td colspan="2">
                    <span class="et">Plano de mensura</span>
                    <span class="vl editable" contenteditable="true">---</span>
                </td>
            </tr>
        </table>

        <div class="seccion-titulo">${tituloSeccionTitulares}</div>
        ${tablaTitulares}

        <div class="seccion-titulo">Datos de la finca</div>
        <table class="datos">
            <tr>
                <td width="50%"><span class="et">Barrio</span><span class="vl">${dato(p.BARRIO1)}</span></td>
                <td width="50%">
                    <span class="et">Contribuyente</span>
                    <span class="vl editable" contenteditable="true">${titular}</span>
                </td>
            </tr>
            <tr>
                <td><span class="et">Zonificación</span><span class="vl">${dato(p.CONCEPTO || p.ZONIFICACION)}</span></td>
                <td><span class="et">Estado registral</span><span class="vl">${dato(p.ACTIVO === 1 || p.ACTIVO === '1' ? 'Activo' : p.ACTIVO)}</span></td>
            </tr>
        </table>

        <div class="seccion-titulo">Observaciones</div>
        <div class="caja-observaciones">
            <div contenteditable="true">${esc(p.OBSERVACIONES || '')}</div>
        </div>

    </div>

    <div class="col-mapa">
        <div class="mapa-cabecera">
            <span class="mapa-rotulo">Ubicación · ${esc(p.BARRIO1 || p.BARRIO || 'Villa de Merlo')}</span>
            <span class="mapa-nota">POSGAR 98 / Argentina Zona 3</span>
        </div>
        <div class="marco-mapa">
            <img src="${imgData}" alt="Croquis de ubicación de la parcela">
        </div>
        <div class="referencias">
            <span><span class="muestra parcela"></span>Parcela consultada</span>
            <span><span class="muestra manzana"></span>Manzana que la contiene</span>
        </div>
    </div>
</div>

<div class="pie">
    <span>Sistema de Información Geográfica · Dirección de Catastro · Municipalidad de Villa de Merlo</span>
    <span>Emitida el ${fechaEmision} a las ${horaEmision}</span>
</div>

</body>
</html>
                `);
                printWindow.document.close();
            } catch (e) { console.error(e); }
            finally { document.getElementById('loader').style.display = 'none'; }
        }

        function renderDynamicLabels() {
            const zoom = map.getZoom();
            const bounds = map.getBounds();

            barriosLabelsLayer.clearLayers();
            if (showBarrios && zoom >= 15) {
                barriosData.forEach(feature => {
                    const p = feature.properties;
                    const textValue = p.Nombre || p.NOMBRE || p.nombre || p.BARRIO || "";
                    if (textValue && feature.center) {
                        if (bounds.contains(feature.center)) {
                            L.marker(feature.center, {
                                icon: L.divIcon({ className: 'barrio-label', html: `<span>${textValue}</span>`, iconSize: [0, 0] }),
                                interactive: false, pane: 'markerPane'
                            }).addTo(barriosLabelsLayer);
                        }
                    }
                });
            }

            manzanasLayer.clearLayers();
            if (showManzanas && zoom >= 15) {
                manzanasData.forEach(f => {
                    if (!f.geometry || !f.geometry.coordinates) return;
                    const coord = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
                    if (bounds.contains(L.latLng(coord))) {
                        L.marker(coord, {
                            icon: L.divIcon({ className: 'manzana-label', html: `<span>${f.properties.TEXTSTRING || f.properties.MANZANA || ''}</span>`, iconSize: [0, 0] }),
                            interactive: false
                        }).addTo(manzanasLayer);
                    }
                });
            }

            labelsLayer.clearLayers();
            if (showLabels && zoom >= 16) {
                let count = 0;
                for (let f of labelsData) {
                    if (!f.geometry || !f.geometry.coordinates) continue;
                    const coord = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
                    if (bounds.contains(L.latLng(coord))) {
                        const numParcela = f.properties.PARCELA || f.properties.PARCELA || f.properties.TEXTSTRING || '';
                        if (numParcela) {
                            L.marker(coord, {
                                icon: L.divIcon({ className: 'parcel-label', html: `<span>${numParcela}</span>`, iconSize: [0, 0] }),
                                interactive: false
                            }).addTo(labelsLayer);
                            count++;
                        }
                    }
                    if (count > 800) break; 
                }
            }
        }


        // Esta función procesa la ejecución contra SQL después de que el Padrón (simple o PH) ha sido resuelto.
        async function procesarParcela(padronId, nomenclaturaId, f, l, propsAdicionales, subparcela) {
            
            // Reconstruir nomenclatura si está vacía
            if (nomenclaturaId === "" && propsAdicionales.SECCION && propsAdicionales.MANZANA && (propsAdicionales.PARCELA_ME || propsAdicionales.PARCELA)) {
                const sec = String(propsAdicionales.SECCION).trim().toUpperCase().padStart(4, '0');
                const manz = String(propsAdicionales.MANZANA).trim().padStart(6, '0');
                const parc = String(propsAdicionales.PARCELA_ME || propsAdicionales.PARCELA).trim().padStart(6, '0');
                nomenclaturaId = `${sec}${manz}${parc}000000`;
            }

            showModalLoading(padronId || nomenclaturaId);

            let datosSQL = {};
            if ((padronId && padronId !== "") || (nomenclaturaId && nomenclaturaId !== "")) {
                try {
                    const params = new URLSearchParams({ padron: padronId, nomenclatura: nomenclaturaId });
                    const urlApi = CONFIG.url(`api/catastro?${params.toString()}`);
                    const response = await fetch(urlApi);
                    if (response.ok) datosSQL = await response.json();
                } catch (error) {
                    console.warn("⚠️ No se pudo consultar la base municipal (/api/catastro).", error);
                }
            }

            // Unir propiedades combinando el GeoJSON de la parcela, el Punto con datos y la respuesta SQL
            currentFeatureProps = mergeProperties(f.properties, propsAdicionales, datosSQL);
            
            // Garantizar que siempre haya nomenclatura (sección, manzana, parcela) sacándola del archivo de puntos
            if ((!currentFeatureProps.SECCION || String(currentFeatureProps.SECCION).trim() === "") && propsAdicionales.SECCION) {
                currentFeatureProps.SECCION = propsAdicionales.SECCION;
            }
            if ((!currentFeatureProps.MANZANA || String(currentFeatureProps.MANZANA).trim() === "") && propsAdicionales.MANZANA) {
                currentFeatureProps.MANZANA = propsAdicionales.MANZANA;
            }
            if ((!currentFeatureProps.PARCELA || String(currentFeatureProps.PARCELA).trim() === "") && (propsAdicionales.PARCELA_ME || propsAdicionales.PARCELA)) {
                currentFeatureProps.PARCELA = propsAdicionales.PARCELA_ME || propsAdicionales.PARCELA;
            }
            if (!currentFeatureProps.NRO_RENTA && padronId !== "") {
                currentFeatureProps.NRO_RENTA = padronId;
            }

            // Inyectamos la sub-parcela (Si proviene de una PH)
            currentFeatureProps.SUBPARCELA = subparcela;

            showModalData(currentFeatureProps);
            // Encuadre con contexto: la parcela dentro de su manzana, con las
            // calles del entorno visibles (ver encuadrarParcela).
            encuadrarParcela(l, f);
        }

        // Abre el modal intermedio permitiendo al usuario elegir la sub-unidad (PH)
        function mostrarModalPH(phList, f, l, propsAdicionales) {
            const phModal = document.getElementById('ph-modal');
            const container = document.getElementById('ph-list-container');
            
            let html = `<div class="grid grid-cols-2 md:grid-cols-3 gap-3">`;
            phList.forEach(ph => {
                html += `
                    <button onclick="seleccionarPH('${ph.padron}', '${ph.index}')" 
                        class="flex flex-col items-center justify-center p-3 bg-white border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 transition-all rounded-none shadow-sm cursor-pointer group">
                        <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest group-hover:text-emerald-600 transition-colors">Sub-Parcela ${ph.index}</span>
                        <span class="text-sm font-bold text-slate-700 mt-1">${ph.padron}</span>
                    </button>
                `;
            });
            html += `</div>`;
            
            // Guardamos el contexto actual en el objeto window para usarlo después del clic
            window.currentPHContext = { f, l, propsAdicionales };

            container.innerHTML = html;
            phModal.classList.remove('hidden');
            phModal.classList.add('flex');
        }

        window.seleccionarPH = function(padronId, subparcela) {
            closePhModal();
            const { f, l, propsAdicionales } = window.currentPHContext;
            
            /* 
             * NUEVO: Buscar nomenclatura específica de la sub-parcela (PH) seleccionada.
             * Contemplamos la limitación de 10 caracteres en las columnas de los shapefiles,
             * revisando tanto NOMENCLATx (1-9) como NOMENCLAx (10-50).
             */
            let phNomencla = propsAdicionales[`NOMENCLAT${subparcela}`] || propsAdicionales[`NOMENCLA${subparcela}`] || '';
            
            // Usamos la nomenclatura específica de la unidad funcional. Si está vacía, usamos la general de la parcela (Fallback)
            let nomenclaturaId = String(phNomencla || propsAdicionales.NOMENCLATU || propsAdicionales.NOMENCLA || f.properties.NOMENCLA || '').trim();
            
            procesarParcela(padronId, nomenclaturaId, f, l, propsAdicionales, subparcela);
        }

        function closePhModal() {
            document.getElementById('ph-modal').classList.add('hidden');
            document.getElementById('ph-modal').classList.remove('flex');
        }

        function closeFilterModal() {
            const modal = document.getElementById('filter-table-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        function abrirModalResultados(titulo, data, columnaValor, configPintado, tipoFiltro) {
            document.getElementById('filter-modal-title').innerHTML = `<span class="material-icons text-xl">manage_search</span> ${titulo}`;
            document.getElementById('filter-modal-count').innerText = `${data.length} Registros Encontrados`;
            document.getElementById('filter-modal-value-col').innerText = columnaValor;

            const tbody = document.getElementById('filter-modal-tbody');
            tbody.innerHTML = '';
            
            if (data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" class="px-4 py-8 text-center text-slate-400 font-bold uppercase tracking-widest">No se encontraron resultados en la Base de Datos</td></tr>`;
            } else {
                const previewData = data.slice(0, 100);
                let rowsHtml = '';
                previewData.forEach(row => {
                    const val = row[columnaValor] || '-';
                    rowsHtml += `
                        <tr class="hover:bg-slate-50 transition-colors">
                            <td class="px-5 py-2 font-mono font-bold">${row.PADRON || '-'}</td>
                            <td class="px-5 py-2 font-mono">${row.NOMENCLA || '-'}</td>
                            <td class="px-5 py-2 font-black text-emerald-600 bg-emerald-50/30">${val}</td>
                        </tr>
                    `;
                });

                if (data.length > 100) {
                    rowsHtml += `
                        <tr>
                            <td colspan="3" class="px-5 py-4 text-center text-slate-500 font-bold text-[10px] uppercase bg-slate-100 tracking-widest shadow-inner">
                                ... y ${data.length - 100} parcelas más ocultas en la tabla por rendimiento.<br>
                                <span class="text-emerald-700 mt-1 block">Haga click en "Pintar en Mapa" para visualizar la totalidad.</span>
                            </td>
                        </tr>
                    `;
                }
                tbody.innerHTML = rowsHtml;
            }

            // El cartel de "cargando" se apaga SIEMPRE, tanto si el pintado
            // sale bien como si falla. Antes se encendía y no se apagaba
            // nunca: aunque el pintado hubiera terminado, la pantalla quedaba
            // tapada por el cartel y el visor parecía colgado.
            const btnPaint = document.getElementById('btn-paint-map');
            btnPaint.onclick = () => {
                closeFilterModal();
                const cartel = document.getElementById('loader');
                cartel.style.display = 'flex';

                // El pintado se hace en el siguiente ciclo para que el
                // navegador alcance a dibujar el cartel antes de ponerse a
                // trabajar. Si se hiciera acá mismo, no se vería.
                setTimeout(() => {
                    try {
                        // Al hacer la búsqueda ya se pintó este mismo resultado.
                        // Volver a pintarlo no cambia nada en pantalla y cuesta
                        // otro segundo de mapa trabado, así que solo se pinta si
                        // por algo dejó de estarlo (por ejemplo, si se limpiaron
                        // los filtros con el listado abierto).
                        if (datosPintados !== data) {
                            paintMapFromFilter(data, configPintado);
                        }
                        encuadrarPintado();
                    } catch (error) {
                        console.error('❌ No se pudieron pintar las parcelas del filtro:', error);
                    } finally {
                        cartel.style.display = 'none';
                    }
                }, 50);
            };

            const modal = document.getElementById('filter-table-modal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        /**
         * Pinta en el mapa las parcelas que devolvió un filtro.
         *
         * Solo toca las parcelas que cambian de color: las que hay que resaltar
         * ahora -que se ubican por el índice de padrones, sin recorrer nada- y
         * las que habían quedado pintadas de la búsqueda anterior. Ver el
         * comentario del índice de padrones para el motivo.
         */
        function paintMapFromFilter(data, config) {
            const resaltado = {
                color: config.color || '#7c3aed',
                fillColor: config.fillColor || '#7c3aed',
                weight: config.weight || 2,
                fillOpacity: config.fillOpacity || 0.5
            };

            // Si por lo que sea el índice no llegó a armarse -el GeoJSON de
            // parcelas no cargó, o cambiaron los nombres de los campos-, se
            // recorre como se hacía antes. Es lento, pero pintar despacio es
            // mejor que no pintar.
            if (indicePadrones.size === 0) {
                return pintarRecorriendoTodo(data, resaltado);
            }

            limpiarPintadoFiltro();

            const pintadas = [];
            const sinDibujo = [];          // padrones que la base trae pero el plano no tiene

            for (const fila of data) {
                const clave = normalizarPadron(fila.PADRON);
                if (!clave) continue;
                const capas = indicePadrones.get(clave);
                if (!capas) { sinDibujo.push(fila.PADRON); continue; }
                for (const capa of capas) {
                    if (!capa.setStyle) continue;
                    capa.setStyle(resaltado);
                    pintadas.push(capa);
                }
            }

            parcelasPintadas = pintadas;
            ultimoPintado = { pintadas: pintadas.length, sinDibujo: sinDibujo };
            datosPintados = data;

            // Si la base devuelve parcelas que el plano no tiene dibujadas, hay
            // que decirlo: si no, el operador ve una lista de 300 resultados y
            // 280 parcelas pintadas, y no tiene forma de saber por qué faltan.
            if (sinDibujo.length > 0) {
                console.warn(
                    `⚠️ ${sinDibujo.length} parcela(s) de la búsqueda no están dibujadas en el plano ` +
                    `y por eso no se pintan. Padrones: ${sinDibujo.slice(0, 20).join(', ')}` +
                    (sinDibujo.length > 20 ? ` … y ${sinDibujo.length - 20} más` : '')
                );
            }

            return pintadas.length;
        }

        /**
         * Camino de respaldo: recorre las capas una por una.
         *
         * OJO con el recorrido: geojsonLayer es un featureGroup que contiene la
         * capa GeoJSON, y es esa capa la que contiene las parcelas. Un
         * eachLayer directo devuelve el grupo intermedio, que no tiene
         * .feature, y rompe con "cannot read properties of undefined". Hay que
         * bajar en profundidad, igual que hace el buscador.
         */
        function pintarRecorriendoTodo(data, resaltado) {
            const padrones = new Set();
            for (const fila of data) {
                const clave = normalizarPadron(fila.PADRON);
                if (clave) padrones.add(clave);
            }

            const pintadas = [];
            geojsonLayer.eachLayer(function recorrer(capa) {
                if (capa.eachLayer) { capa.eachLayer(recorrer); return; }
                if (!capa.feature || !capa.setStyle) return;

                const renta = clavePadron(capa.feature.properties);
                if (renta && padrones.has(renta)) {
                    capa.setStyle(resaltado);
                    pintadas.push(capa);
                } else {
                    capa.setStyle(ESTILO_BASE);
                }
            });

            parcelasPintadas = pintadas;
            ultimoPintado = { pintadas: pintadas.length, sinDibujo: [] };
            datosPintados = data;
            return pintadas.length;
        }

        // ====================================================================
        // ENCUADRE DEL RESULTADO DE UN FILTRO
        // --------------------------------------------------------------------
        // POR QUE HAY UN ZOOM MINIMO
        //   Encuadrar el resultado de un filtro parece inofensivo, pero cuando
        //   las parcelas que coinciden están repartidas por todo el municipio,
        //   el encuadre tiene que alejar el mapa hasta ver Merlo entero, y a ese
        //   zoom entran en pantalla las 17.614 parcelas a la vez.
        //
        //   Medido en una computadora de escritorio, ese salto de zoom bloquea
        //   unos 150 ms contra los 50 ms del zoom normal de trabajo: el triple.
        //   Y no es por una sola vez, que se aguantaría: el mapa QUEDA en ese
        //   zoom, así que cada paneo y cada rueda del mouse siguen costando lo
        //   mismo hasta que alguien vuelva a acercarse. En las computadoras de
        //   la Municipalidad, bastante más lentas, eso es lo que se siente como
        //   que el programa se trabó.
        //
        //   Es una de las dos cosas que el botón "Pintar en Mapa" hacía de más
        //   respecto de simplemente cerrar el listado -la otra era repintar lo
        //   que ya estaba pintado-, y por eso cerrar el listado se sentía bien
        //   y el botón no.
        //
        //   Ahora se calcula de antemano a qué zoom habría que ir. Si queda por
        //   debajo del mínimo, no se encuadra: el resultado está desparramado,
        //   y en ese caso acercarse a "todo" no muestra nada útil de todas
        //   formas. El pintado ya está hecho y se ve al navegar el mapa.
        // ====================================================================
        const ZOOM_MINIMO_SEGURO = 14;

        /**
         * Muestra debajo del panel de filtros por qué el mapa puede tener menos
         * parcelas pintadas que las que dice la lista. Con la lista vacía, se
         * oculta.
         */
        function mostrarAvisosDelFiltro(avisos) {
            // Se muestran en dos lugares a propósito: en el modal de resultados,
            // que es donde el operador está parado cuando decide pintar, y en el
            // panel lateral, para que sigan a mano después de cerrarlo. El panel
            // solo se colapsa, así que por sí solo no alcanza.
            const cajas = [
                document.getElementById('filtro-avisos'),
                document.getElementById('filtro-avisos-modal')
            ].filter(Boolean);

            const vacio = !avisos || avisos.length === 0;
            const html = vacio ? '' : avisos.map((texto) => `
                <div class="flex gap-2 items-start bg-amber-50 border border-amber-300 text-amber-900
                            text-[10px] leading-snug font-semibold normal-case px-3 py-2 rounded">
                    <span class="material-icons text-[13px] leading-none mt-[1px]">info</span>
                    <span>${texto}</span>
                </div>`).join('');

            for (const caja of cajas) {
                caja.innerHTML = html;
                caja.classList.toggle('hidden', vacio);
            }
        }

        /**
         * Acerca el mapa a lo que se acaba de pintar, si se puede hacer sin
         * trabar el navegador. Devuelve true si encuadró.
         */
        function encuadrarPintado() {
            if (parcelasPintadas.length === 0) return false;
            try {
                let limites = parcelasPintadas[0].getBounds();
                for (let i = 1; i < parcelasPintadas.length; i++) {
                    limites = limites.extend(parcelasPintadas[i].getBounds());
                }

                const zoomNecesario = map.getBoundsZoom(limites, false, L.point(40, 40));
                if (zoomNecesario < ZOOM_MINIMO_SEGURO) {
                    console.log('ℹ️ El resultado abarca casi todo el municipio: se deja el mapa como está para no trabar el visor.');
                    return false;
                }

                map.fitBounds(limites, { padding: [40, 40] });
                return true;
            } catch (e) {
                console.warn('No se pudo encuadrar el resultado del filtro:', e);
                return false;
            }
        }

        // ====================================================================
        // BÚSQUEDA POR FILTROS COMBINADOS
        // --------------------------------------------------------------------
        // Antes había una función por criterio y cada una hacía su consulta por
        // separado, así que no se podían cruzar. Ahora se leen todos los campos
        // del panel, se mandan juntos, y el servidor los combina con Y.
        //
        // DE DÓNDE SALEN ESTOS DATOS
        //   La superficie, los metros de frente, el estado de la finca, la
        //   zonificación y el barrio NO están en el GeoJSON: vienen todos de la
        //   base municipal, vía /api/filtrar. El visor solo sabe la forma de
        //   cada parcela, su nomenclatura y su número de renta.
        //
        //   Por eso, sin conexión a la base, el filtrado no puede hacerse del
        //   lado del navegador ni siquiera parcialmente. Lo que se pinta con
        //   MODO_DEMO son superficies inventadas por el servidor, y por eso el
        //   resultado se marca en pantalla como datos de prueba.
        // ====================================================================

        /** Lee el panel y arma los criterios. Los campos vacíos no filtran. */
        function leerFiltros() {
            const num = (id) => {
                const v = document.getElementById(id).value.trim();
                return v === '' ? null : Number(v);
            };
            const texto = (id) => document.getElementById(id).value.trim();
            const radio = document.querySelector('input[name="filtro-edificacion"]:checked');

            return {
                supMin: num('filtro-sup-min'),
                supMax: num('filtro-sup-max'),
                frenteMin: num('filtro-frente-min'),
                frenteMax: num('filtro-frente-max'),
                edificacion: radio ? radio.value : '',
                zonificacion: texto('filtro-zonificacion'),
                barrio: texto('filtro-barrio')
            };
        }

        /** Describe los filtros activos en palabras, para el título de la tabla. */
        function describirFiltros(f) {
            const partes = [];
            if (f.supMin !== null && f.supMax !== null) partes.push(`${f.supMin} a ${f.supMax} m²`);
            else if (f.supMin !== null) partes.push(`desde ${f.supMin} m²`);
            else if (f.supMax !== null) partes.push(`hasta ${f.supMax} m²`);

            if (f.frenteMin !== null && f.frenteMax !== null) partes.push(`frente ${f.frenteMin} a ${f.frenteMax} m`);
            else if (f.frenteMin !== null) partes.push(`frente desde ${f.frenteMin} m`);
            else if (f.frenteMax !== null) partes.push(`frente hasta ${f.frenteMax} m`);

            if (f.edificacion) partes.push(f.edificacion.toLowerCase());
            if (f.zonificacion) partes.push(f.zonificacion);
            if (f.barrio) partes.push(f.barrio);

            return partes;
        }

        async function aplicarFiltros() {
            const filtros = leerFiltros();
            const activos = describirFiltros(filtros);

            // Sin ningún criterio, la consulta devolvería el padrón entero.
            if (activos.length === 0) {
                const resumen = document.getElementById('filtro-resumen');
                resumen.textContent = 'Indicá al menos un criterio de búsqueda';
                resumen.classList.remove('hidden');
                return;
            }

            // Validación de rangos: si están invertidos, se corrigen en vez de
            // devolver una lista vacía que parece un "no hay resultados".
            if (filtros.supMin !== null && filtros.supMax !== null && filtros.supMin > filtros.supMax) {
                [filtros.supMin, filtros.supMax] = [filtros.supMax, filtros.supMin];
                document.getElementById('filtro-sup-min').value = filtros.supMin;
                document.getElementById('filtro-sup-max').value = filtros.supMax;
            }
            if (filtros.frenteMin !== null && filtros.frenteMax !== null && filtros.frenteMin > filtros.frenteMax) {
                [filtros.frenteMin, filtros.frenteMax] = [filtros.frenteMax, filtros.frenteMin];
                document.getElementById('filtro-frente-min').value = filtros.frenteMin;
                document.getElementById('filtro-frente-max').value = filtros.frenteMax;
            }

            document.getElementById('loader').style.display = 'flex';

            try {
                const params = new URLSearchParams();
                for (const [clave, valor] of Object.entries(filtros)) {
                    if (valor !== null && valor !== '') params.set(clave, valor);
                }

                const respuesta = await fetch(CONFIG.url(`api/filtrar?${params.toString()}`));
                if (!respuesta.ok) {
                    const detalle = await respuesta.json().catch(() => ({}));
                    throw new Error(detalle.error || 'No se pudo consultar la base municipal.');
                }

                // ¿Vienen de la base o son datos de prueba? La superficie, el
                // frente, la zonificación y el estado de la finca SIEMPRE salen
                // de la base municipal. Cuando no hay conexión y el modo de
                // prueba está activo, el servidor los inventa y lo avisa por
                // esta cabecera. Hay que decirlo en pantalla: una superficie
                // inventada tiene exactamente la misma cara que una real.
                const sonDePrueba = respuesta.headers.get('X-Datos-De-Prueba') === 'true';

                // Si la búsqueda encontró más parcelas que el tope del
                // servidor, solo llegaron las primeras. Sin este aviso, el mapa
                // queda con parcelas sin pintar y parece un error del visor.
                const tope = respuesta.headers.get('X-Resultado-Recortado');

                const datos = await respuesta.json();

                const resumen = document.getElementById('filtro-resumen');
                resumen.textContent = datos.length === 0
                    ? 'Sin resultados para esos criterios'
                    : `${datos.length} parcela${datos.length > 1 ? 's' : ''} encontrada${datos.length > 1 ? 's' : ''}`;
                resumen.classList.remove('hidden');
                resumen.classList.toggle('resumen-demo', sonDePrueba);
                if (sonDePrueba) {
                    resumen.textContent += ' · DATOS DE PRUEBA';
                }

                document.getElementById('filtros-activos').textContent = activos.length;
                document.getElementById('filtros-activos').classList.remove('hidden');

                if (datos.length > 0) {
                    const config = { color: '#7c3aed', fillColor: '#7c3aed', weight: 2, fillOpacity: 0.45 };
                    paintMapFromFilter(datos, config);

                    // Qué pasó realmente con el pintado. Que la lista diga 300
                    // y el mapa muestre 280 tiene una explicación concreta, y el
                    // operador tiene que poder verla sin abrir la consola.
                    const avisos = [];
                    if (tope) {
                        avisos.push(`Hay más de ${tope} parcelas que cumplen los criterios: se muestran las primeras ${tope}. Achicá el rango para verlas todas.`);
                    }
                    if (ultimoPintado.sinDibujo.length > 0) {
                        avisos.push(`${ultimoPintado.sinDibujo.length} parcela${ultimoPintado.sinDibujo.length > 1 ? 's' : ''} de la lista no ${ultimoPintado.sinDibujo.length > 1 ? 'están dibujadas' : 'está dibujada'} en el plano, así que no se pinta${ultimoPintado.sinDibujo.length > 1 ? 'n' : ''}: figuran en la base pero les falta el polígono.`);
                    }
                    mostrarAvisosDelFiltro(avisos);

                    const encabezado = sonDePrueba
                        ? `⚠ DATOS DE PRUEBA — ${activos.join(' · ')}`
                        : `Búsqueda: ${activos.join(' · ')}`;
                    abrirModalResultados(encabezado, datos, 'SUP_TER', config, 'combinado');
                } else {
                    mostrarAvisosDelFiltro([]);
                }

            } catch (error) {
                console.error('❌ Error en la búsqueda por filtros:', error);
                const resumen = document.getElementById('filtro-resumen');
                resumen.textContent = error.message || 'Error al consultar';
                resumen.classList.remove('hidden');
            } finally {
                document.getElementById('loader').style.display = 'none';
            }
        }

        function limpiarFiltros() {
            ['filtro-sup-min', 'filtro-sup-max', 'filtro-frente-min', 'filtro-frente-max']
                .forEach((id) => { document.getElementById(id).value = ''; });
            document.getElementById('filtro-zonificacion').value = '';
            document.getElementById('filtro-barrio').value = '';
            const todas = document.querySelector('input[name="filtro-edificacion"][value=""]');
            if (todas) todas.checked = true;

            document.getElementById('filtro-resumen').classList.add('hidden');
            document.getElementById('filtros-activos').classList.add('hidden');
            mostrarAvisosDelFiltro([]);

            // Devuelve a su estilo normal lo que estaba resaltado. Solo eso:
            // recorrer las 17.614 parcelas para repintar las pocas que
            // cambiaron congelaba la pantalla sin motivo.
            limpiarResaltadoManzana();
            limpiarPintadoFiltro();
            if (selectedLayer && selectedLayer.setStyle) {
                try { selectedLayer.setStyle(ESTILO_BASE); } catch (e) { /* capa ya removida */ }
            }
            selectedLayer = null;
        }

        /**
         * Llena las listas de zonificación y barrio con los valores que
         * existen realmente en la base, para no tener que adivinar cómo se
         * escriben. Si la base no está disponible, las listas quedan con la
         * opción "Todas" y los demás filtros siguen funcionando.
         */
        async function cargarOpcionesFiltro() {
            try {
                const respuesta = await fetch(CONFIG.url('api/opciones'));
                if (!respuesta.ok) return;

                const opciones = await respuesta.json();
                const llenar = (id, valores) => {
                    const select = document.getElementById(id);
                    if (!select || !Array.isArray(valores)) return;
                    for (const valor of valores) {
                        const opcion = document.createElement('option');
                        opcion.value = valor;
                        opcion.textContent = valor;
                        select.appendChild(opcion);
                    }
                };

                llenar('filtro-zonificacion', opciones.zonificaciones);
                llenar('filtro-barrio', opciones.barrios);
                console.log(`🔧 Opciones de filtro cargadas: ${(opciones.zonificaciones || []).length} zonificaciones, ${(opciones.barrios || []).length} barrios.`);
            } catch (error) {
                console.warn('⚠️ No se pudieron cargar las opciones de filtro:', error);
            }
        }


        // ====================================================================
        // ARCHIVOS DEL PLANO
        // --------------------------------------------------------------------
        // ESTE ES EL UNICO LUGAR DEL PROGRAMA DONDE SE NOMBRAN LOS ARCHIVOS
        // DEL PLANO. Si hay que cambiar uno, se cambia acá y en ningún otro
        // lado.
        //
        // POR QUE ESTA ASI
        //   El plano no es fijo: Catastro entrega cada tanto una versión nueva
        //   con las parcelas que se fueron incorporando, y eso va a seguir
        //   pasando. Antes el nombre de cada archivo estaba escrito a mano en
        //   seis lugares distintos del código, cada uno con su propia forma de
        //   buscarlo y de avisar si fallaba. Cambiar de versión obligaba a
        //   encontrarlos todos, y alcanzaba con que se escapara uno para que el
        //   visor cargara media capa vieja y media nueva sin avisar nada.
        //
        // COMO SE ACTUALIZA EL PLANO
        //   1. Revisar el archivo nuevo:  node herramientas/revisar-plano.js <archivo>
        //   2. Copiarlo a  web/datos/
        //   3. Cambiar el nombre en la lista de acá abajo
        //   4. Recargar el visor
        //
        //   El paso 1 no es opcional: avisa si al archivo le faltan padrones o
        //   si trae polígonos sin datos, que son parcelas que después no se van
        //   a poder consultar ni pintar. El procedimiento completo, con el
        //   detalle de qué tiene que traer cada archivo, está en
        //   docs/actualizar-el-plano.md
        //
        // QUE SIGNIFICA CADA CAMPO
        //   archivo       nombre del archivo dentro de web/datos/
        //   obligatorio   si falta, el visor no sirve (error). Si no lo es,
        //                 simplemente esa capa no se ve (aviso).
        //   alternativas  otros nombres con los que pudo haber venido, para que
        //                 una instalación vieja siga andando.
        // ====================================================================
        const PLANO = {
            parcelas: {
                archivo: 'Merlo2026Parcelas-V1.json',
                obligatorio: true,
                descripcion: 'polígonos de las parcelas'
            },
            puntos: {
                archivo: 'MerloPuntosNomeclaParcelasV2.json',
                obligatorio: true,
                descripcion: 'puntos con padrón y nomenclatura de cada parcela'
            },
            manzanas: {
                archivo: 'MerloPuntosNomeclaManzanas.json',
                obligatorio: false,
                alternativas: ['MerloTextoNomeclaManzanas.json'],
                descripcion: 'etiquetas de manzana'
            },
            barrios: {
                archivo: 'MerloBarrios.json',
                obligatorio: false,
                descripcion: 'límites de los barrios'
            },
            edificado: {
                archivo: 'Edificado2026.json',
                obligatorio: false,
                descripcion: 'superficie edificada'
            }
        };

        /**
         * Trae un archivo del plano y devuelve su contenido, o null si no está.
         *
         * Prueba cada nombre posible en web/datos/ y también en la raíz de
         * web/, porque las instalaciones viejas tenían los archivos ahí.
         *
         * El `?t=` del final evita que el navegador sirva una copia guardada:
         * sin eso, después de actualizar el plano se seguiría viendo el
         * anterior hasta que alguien vaciara la caché a mano, y el síntoma
         * -"actualicé y no cambió nada"- es muy difícil de diagnosticar.
         */
        async function traerDelPlano(clave) {
            const cfg = PLANO[clave];
            if (!cfg) { console.error(`❌ No hay ningún archivo declarado para "${clave}".`); return null; }

            const nombres = [cfg.archivo].concat(cfg.alternativas || []);
            const sinCache = `?t=${Date.now()}`;

            for (const nombre of nombres) {
                for (const ruta of [`datos/${nombre}`, nombre]) {
                    try {
                        const r = await fetch(CONFIG.url(ruta) + sinCache);
                        if (!r.ok) continue;
                        const datos = await r.json();
                        const cuantos = (datos.features || []).length;
                        console.log(`✅ ${cfg.descripcion}: ${cuantos} elementos — ${ruta}`);
                        if (cuantos === 0) {
                            console.warn(`⚠️ ${nombre} no tiene ningún elemento adentro. ¿Se exportó vacío?`);
                        }
                        return datos;
                    } catch (e) {
                        console.warn(`⚠️ ${ruta} no se pudo leer (¿archivo cortado o mal exportado?):`, e.message);
                    }
                }
            }

            const donde = nombres.join(' ni ');
            if (cfg.obligatorio) {
                console.error(`❌ Falta el archivo de ${cfg.descripcion}: no se encontró ${donde} en web/datos/. El visor no puede funcionar sin esto.`);
            } else {
                console.warn(`⚠️ Falta el archivo de ${cfg.descripcion} (${donde}): esa capa no se va a ver. El resto del visor funciona igual.`);
            }
            return null;
        }

        async function loadData() {
            try {
                const dataL = await traerDelPlano('puntos');
                if (dataL) {
                    labelsData = dataL.features;
                    // Índices: se arman una sola vez, acá. Todo lo que viene
                    // después (clics y búsquedas) los reutiliza.
                    construirIndicePuntos(labelsData);
                    construirIndiceBusqueda(labelsData);
                }

                const dataB = await traerDelPlano('barrios');
                if (dataB) {
                    L.geoJSON(dataB, {
                        style: { color: '#4338ca', weight: 2, fillOpacity: 0.1, dashArray: '5, 5' },
                        onEachFeature: (f, l) => { if (l.getBounds) f.center = l.getBounds().getCenter(); }
                    }).addTo(barriosLayer);
                    barriosData = dataB.features;
                    barriosLabelsLayer.addTo(map);
                }

                const dataE = await traerDelPlano('edificado');
                if (dataE) {
                    L.geoJSON(dataE, { style: { color: '#dc2626', weight: 1.2, fillColor: '#ef4444', fillOpacity: 0.25 } }).addTo(edificadoLayer);
                }

                const data = await traerDelPlano('parcelas');
                if (data) {
                    L.geoJSON(data, {
                        style: { color: '#13f8bc', weight: 0.8, fillOpacity: 0.05, fillColor: '#10abb9' },
                        onEachFeature: (f, l) => {
                            // Índices de manzanas y de padrones: se arman
                            // mientras Leaflet crea las capas, sin recorrer
                            // todo de nuevo después.
                            registrarEnManzana(f, l);
                            registrarEnPadron(f, l);

                            // --- EVENTO CLIC EN PARCELA REFACTORIZADO (SOPORTE PARA PH) ---
                            l.on('click', async (e) => {
                                limpiarResaltadoManzana();
                                if(selectedLayer) selectedLayer.setStyle(ESTILO_BASE);
                                l.setStyle(ESTILO_SELECCION);
                                selectedLayer = l;

                                // 1. Extraemos las propiedades del punto interno de esta parcela
                                let propsAdicionales = {};
                                if (labelsData && labelsData.length > 0) {
                                    const puntoInterno = getPointInLayer(l, labelsData);
                                    if (puntoInterno) propsAdicionales = puntoInterno.properties;
                                }

                                // 2. Verificamos la naturaleza de la parcela (Simple vs Propiedad Horizontal)
                                let isPH = false;
                                let phList = [];
                                let explicitPhPadron = null; // En caso de que se haya buscado uno específico
                                
                                if (propsAdicionales) {
                                    const mainPadron = String(propsAdicionales.PADRON || '').trim();
                                    // REGLA ARQUITECTÓNICA: Si PADRON principal está vacío, pero existe PADRON_1, es PH
                                    if (!mainPadron && propsAdicionales.PADRON_1 && String(propsAdicionales.PADRON_1).trim() !== '') {
                                        isPH = true;
                                        // Iterar sobre posibles sub-parcelas (Hasta un maximo teórico seguro de 50)
                                        for (let i = 1; i <= 50; i++) { 
                                            let phPadron = propsAdicionales[`PADRON_${i}`];
                                            if (phPadron && String(phPadron).trim() !== '') {
                                                const cleanPadron = String(phPadron).trim();
                                                
                                                // NUEVO: Capturamos la nomenclatura individual (Ej: NOMENCLAT1 o NOMENCLA10)
                                                let phNomencla = propsAdicionales[`NOMENCLAT${i}`] || propsAdicionales[`NOMENCLA${i}`] || '';
                                                
                                                phList.push({ padron: cleanPadron, index: i, nomencla: phNomencla });
                                                
                                                // Bypass: Si el usuario buscó específicamente este padron PH
                                                if (window._searchedPadron && window._searchedPadron === cleanPadron) {
                                                    explicitPhPadron = { padron: cleanPadron, index: i, nomencla: phNomencla };
                                                }
                                            }
                                        }
                                    }
                                }

                                // 3. Ruteamos el flujo según el tipo de propiedad detectado
                                if (isPH && explicitPhPadron) {
                                    // Bypass inteligente: Va directo a procesar la unidad porque se buscó específicamente
                                    // NUEVO: Priorizamos la nomenclatura específica de la unidad funcional encontrada
                                    let nomenclaturaId = String(explicitPhPadron.nomencla || propsAdicionales.NOMENCLATU || propsAdicionales.NOMENCLA || f.properties.NOMENCLA || '').trim();
                                    procesarParcela(explicitPhPadron.padron, nomenclaturaId, f, l, propsAdicionales, explicitPhPadron.index);
                                    window._searchedPadron = null; // Limpiar flag global
                                    
                                } else if (isPH && phList.length > 0) {
                                    // Mostrar modal de selección de sub-unidades al operador
                                    mostrarModalPH(phList, f, l, propsAdicionales);
                                    window._searchedPadron = null;
                                    
                                } else {
                                    // Flujo Clásico: Parcela Simple
                                    let padronId = String(propsAdicionales.PADRON || f.properties.NRO_RENTA || f.properties.PADRON || '').trim();
                                    let nomenclaturaId = String(propsAdicionales.NOMENCLATU || propsAdicionales.NOMENCLA || f.properties.NOMENCLA || '').trim();
                                    procesarParcela(padronId, nomenclaturaId, f, l, propsAdicionales, '');
                                }

                                L.DomEvent.stopPropagation(e);
                            });
                        }
                    }).addTo(geojsonLayer);
                }

                const dataM = await traerDelPlano('manzanas');
                if (dataM) manzanasData = dataM.features || [];

                const overlays = {
                    "<span class='text-sm font-bold text-slate-700 ml-1'>Barrios</span>": barriosLayer,
                    "<span class='text-sm font-bold text-slate-700 ml-1'>Plano Parcelario</span>": geojsonLayer,
                    "<span class='text-sm font-bold text-slate-700 ml-1'>Edificado 2026</span>": edificadoLayer,
                    "<span class='text-sm font-bold text-slate-700 ml-1'>Parcelas</span>": labelsLayer, 
                    "<span class='text-sm font-bold text-slate-700 ml-1'>Manzanas</span>": manzanasLayer
                };

                const ctrl = L.control.layers(null, overlays, { collapsed: false }).addTo(map);
                document.getElementById('layer-control-container').appendChild(ctrl.getContainer());

                map.on('overlayadd', (e) => {
                    if (e.name.includes("Barrios")) showBarrios = true;
                    if (e.name.includes("Parcelas") || e.name.includes("Nomenclatura")) showLabels = true;
                    if (e.name.includes("Manzanas")) showManzanas = true;
                    if (e.name.includes("Edificado")) showEdificado = true;
                    renderDynamicLabels();
                });
                map.on('overlayremove', (e) => {
                    if (e.name.includes("Barrios")) { showBarrios = false; barriosLabelsLayer.clearLayers(); }
                    if (e.name.includes("Parcelas") || e.name.includes("Nomenclatura")) showLabels = false;
                    if (e.name.includes("Manzanas")) showManzanas = false;
                    if (e.name.includes("Edificado")) showEdificado = false;
                    renderDynamicLabels();
                });

                renderDynamicLabels();

            } catch (err) { console.error("Error cargando datos catastrales:", err); }
        }

        function toggleLayers() { document.getElementById('layers-drawer').classList.toggle('active'); }
        
        function switchBaseLayer(type) {
            // La capa de calles puede haber cambiado de proveedor sola, si el
            // primero no respondia en esta red (ver crearCapaCalles). Por eso
            // se usa la vigente y no la original.
            const calles = window.__capaCalles || osm;

            map.removeLayer(calles);
            map.removeLayer(sat);
            map.removeLayer(topo);

            if(type === 'osm') map.addLayer(calles);
            if(type === 'sat') map.addLayer(sat);
            if(type === 'topo') map.addLayer(topo);

            document.getElementById('btn-osm').classList.toggle('active', type === 'osm');
            document.getElementById('btn-sat').classList.toggle('active', type === 'sat');
            document.getElementById('btn-topo').classList.toggle('active', type === 'topo');
        }

        function buscarPadron() {
            const val = document.getElementById('search-input').value.trim();
            if(!val) return;
            
            let found = false;
            let nomenclaturaEncontrada = null;
            let puntoCoordenadas = null;
            
            // Flag global para permitir un bypass inteligente del Modal PH 
            // si el usuario buscó la sub-unidad específica
            window._searchedPadron = val;

            // 1. Buscamos primero en el archivo de puntos (labelsData) que contiene toda la estructura PH
            if (labelsData && labelsData.length > 0) {
                // Búsqueda por índice (ver construirIndiceBusqueda). Si por lo
                // que fuera el índice no está armado, se recorre como antes.
                const puntoEncontrado = indiceBusqueda
                    ? indiceBusqueda.get(val)
                    : labelsData.find(pt => {
                        const padron = String(pt.properties.PADRON || '').trim();
                        const renta = String(pt.properties.NRO_RENTA || pt.properties.PADRON || '').trim();
                        const text = String(pt.properties.TEXTSTRING || '').trim();

                        if (padron === val || renta === val || text === val) return true;

                        // Si no es un padrón simple, iteramos sobre los posibles PADRON_X (Propiedad Horizontal)
                        for (let i = 1; i <= 50; i++) {
                            let phPadron = String(pt.properties[`PADRON_${i}`] || '').trim();
                            if (phPadron === val) return true;
                        }
                        return false;
                    });

                if (puntoEncontrado) {
                    // Extraemos la nomenclatura para cruzar con el polígono
                    nomenclaturaEncontrada = puntoEncontrado.properties.NOMENCLATU || puntoEncontrado.properties.NOMENCLA || puntoEncontrado.properties.NOMENCLATURA;
                    if (puntoEncontrado.geometry && puntoEncontrado.geometry.coordinates) {
                        puntoCoordenadas = L.latLng(puntoEncontrado.geometry.coordinates[1], puntoEncontrado.geometry.coordinates[0]);
                    }
                }
            }

            // 2. Ahora escaneamos la capa de polígonos dibujada para simular el click.
            //
            // FIX (búsqueda de padrones PH): antes, una coincidencia de NOMENCLA/
            // NOMENCLATURA disparaba el click SIN verificar que el polígono fuera
            // realmente el que contiene el punto buscado. Como el archivo estático
            // Merlo2026Parcelas-V1.json es el mismo para todas las sub-unidades de
            // una Propiedad Horizontal (y en algunos casos esa nomenclatura puede
            // coincidir por error de carga con la de OTRA parcela), el resultado
            // podía terminar abriendo la ficha de un padrón vecino distinto al
            // buscado. Ahora toda coincidencia que no sea un match exacto de
            // PADRON/NRO_RENTA del propio polígono debe validarse geométricamente:
            // el punto de MerloPuntosNomeclaParcelasV2.json (fuente de verdad para
            // PH, con sus PADRON_1..PADRON_50) tiene que caer DENTRO del polígono
            // usando el mismo test preciso punto-en-polígono (isPointInPolygon)
            // que ya usa getPointInLayer() al hacer click manual sobre el mapa, en
            // vez de un simple chequeo de bounding box (impreciso y propenso a
            // solapar parcelas linderas).
            const buscarEnCapa = (layer) => {
                if (found) return;
                if (layer.eachLayer) {
                    layer.eachLayer(subLayer => buscarEnCapa(subLayer));
                    return;
                }
                if (!layer.feature || !layer.feature.properties) return;

                const padron = String(layer.feature.properties.PADRON || '').trim();
                const renta = String(layer.feature.properties.NRO_RENTA || '').trim();
                const nomen = String(layer.feature.properties.NOMENCLA || layer.feature.properties.NOMENCLATURA || '').trim();

                // 2.a Coincidencia directa y exacta por Padrón/Nro Renta del propio
                // polígono: válida tal cual, sin necesidad de test espacial (parcela
                // simple, no PH).
                if ((padron && padron === val) || (renta && renta === val)) {
                    layer.fire('click');
                    found = true;
                    return;
                }

                // 2.b Candidato por bounding box: solo a partir de acá se evalúan
                // coincidencias "débiles" (nomenclatura) o el fallback espacial,
                // y siempre exigiendo que el punto esté geométricamente adentro.
                if (puntoCoordenadas && layer.getBounds && layer.getBounds().contains(puntoCoordenadas)) {
                    const geojson = layer.toGeoJSON();
                    let polygonCoords = [];
                    if (geojson.geometry && geojson.geometry.type === "Polygon") {
                        polygonCoords = geojson.geometry.coordinates[0];
                    } else if (geojson.geometry && geojson.geometry.type === "MultiPolygon") {
                        polygonCoords = geojson.geometry.coordinates[0][0];
                    }

                    // Test preciso (ray-casting). isPointInPolygon() espera [lat, lng].
                    const puntoDentroDelPoligono = polygonCoords.length > 0
                        ? isPointInPolygon([puntoCoordenadas.lat, puntoCoordenadas.lng], polygonCoords)
                        : false;

                    // Se acepta si: el punto cae realmente dentro del polígono, o
                    // -como respaldo para polígonos deformes donde el ray-casting
                    // puede fallar- si además coincide la nomenclatura general.
                    if (puntoDentroDelPoligono || (nomenclaturaEncontrada && nomen === nomenclaturaEncontrada)) {
                        layer.fire('click');
                        found = true;
                    }
                }
            };

            geojsonLayer.eachLayer(buscarEnCapa);

            // Limpieza del flag en caso de no encontrarse o finalización
            setTimeout(() => { window._searchedPadron = null; }, 500);

            if(!found) {
                const input = document.getElementById('search-input');
                input.classList.add('ring-2', 'ring-red-500');
                setTimeout(() => input.classList.remove('ring-2', 'ring-red-500'), 2000);
            }
        }

        function toggleFilter(contentId, iconId) {
            const content = document.getElementById(contentId);
            const icon = document.getElementById(iconId);
            if (content.classList.contains('hidden')) {
                content.classList.remove('hidden');
                icon.style.transform = 'rotate(180deg)'; 
            } else {
                content.classList.add('hidden');
                icon.style.transform = 'rotate(0deg)';   
            }
        }

        let moveTimer;
        map.on('moveend', () => {
            clearTimeout(moveTimer);
            moveTimer = setTimeout(renderDynamicLabels, 150);
        });

        window.onload = () => {
            loadData();
            // Las listas de zonificación y barrio se llenan aparte: si la base
            // no responde, el mapa igual carga y los demás filtros funcionan.
            cargarOpcionesFiltro();
        };
