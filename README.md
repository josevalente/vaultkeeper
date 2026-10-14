# VaultKeeper

App web (PWA) para iPhone para comprar, coleccionar y revender cartas Pokémon en ferias.
Es 100 % estática: se publica gratis en GitHub Pages y los datos quedan guardados en el teléfono.

## Qué hace

| Sección | Para qué |
|---|---|
| **Escanear** (botón central) | Foto a la carta → la identifica → precio TCGplayer (market, bajo, medio, alto) en USD y CLP + tendencia Cardmarket 7d/30d. |
| **Evaluar en feria** | Escribes cuánto piden y te dice *Ganga / Buen precio / Justo / Caro*, el % bajo mercado y cuánto ganarías revendiendo. Avisa si la carta está bajo tu rango (por defecto US$15). |
| **Registrar compra** | Precio en CLP o USD; guarda el tipo de cambio del momento (mindicador.cl, dólar observado; si no hay red usa el último guardado). Destino: reventa o colección. |
| **Inicio** | Valor del vault, invertido, ganancia no realizada y realizada. Gráfico **costo vs. valor** con franja de **% rentabilidad** debajo (mismo eje de tiempo). Ranking **top 5 para vender** (con “Mostrar todas”). |
| **Colección** | Tus cartas filtradas por rareza (con los símbolos oficiales), reventa/colección, vendidas. Vender, editar, mover. |
| **Faltantes** | Eliges una rareza (Illustration Rare, Special Illustration Rare, Hyper Rare, Mega Hyper Rare…) y ves **todas** las cartas que existen con esa rareza, por expansión, cuáles tienes y cuáles te faltan, con precio y ordenadas de la más barata (las más fáciles de conseguir). Buscador por nombre o número (ej. *Totodile*, *048*). **Ver por expansión**: todas las cartas de un set, cuáles tienes y cuáles te faltan. Incluye wishlist. |
| **Intercambio** | Tus cartas (valorizadas) vs. las del otro (por foto o búsqueda, valorizadas igual) + dinero extra. Te dice si es justo, a favor o en contra, y al confirmar actualiza el vault. |
| **Más** (barra inferior) | Lote, Intercambio, Reporte y gastos, Eventos, Respaldo y Ajustes. |
| **Vaults (Magic, Yu-Gi-Oh)** | Cada juego tiene su **propio vault**, separado del de Pokémon: sus cartas, compras, ventas, gráfico y respaldo nunca se mezclan. La **primera vez** la app pregunta qué juegos quieres manejar (ninguno viene por defecto; quien ya tenía cartas de Pokémon no ve la pregunta). El vault actual se ve siempre en la cabecera (botón con el nombre y el color del juego: tócalo para cambiar) y se agregan o quitan juegos en **Más → Vaults** o en Ajustes; al abrir la app vuelve al último vault usado. Para sumar otro juego basta una entrada en `js/vaults.js` y su adaptador en `js/tcg/games.js`. Magic: precios TCGplayer vía Scryfall, normal/foil/etched por impresión. Yu-Gi-Oh: precio de referencia por impresión (código + rareza) vía YGOPRODeck. Buscar por nombre o por código impreso (`MKM 123`, `LOB-EN001`), evaluar en feria (veredicto y "paga como máximo"), comprar, vender y ranking de venta. El escáner lee el código impreso (OCR) o usa Claude si tienes la API key. Moneda, margen, canales y API key se comparten (se cambian en Pokémon → Ajustes). |
| **Subir inventario** | Foto de cada página de tu carpeta (9, 4 o 12 bolsillos): reconoce la carta de cada bolsillo (Claude lee la página entera en una consulta; sin Claude, el OCR bolsillo por bolsillo), descarta los vacíos y te deja aprobar o corregir cada una antes de agregarlas (costo = mercado de hoy, o un total pagado repartido). |
| **QR de venta** | Desde la lista de venta: un QR (y su link) que abre una página pública con las fotos, el estado y tus precios. La lista va dentro del link: no hay servidor ni cuenta. |
| **Eventos** | Cada feria con sus compras, ventas, gastos y ganancia neta. Renombrar, unir eventos escritos distinto ("Feria Persa" / "feria persa" ya se juntan solos) y quitar. Colección se puede filtrar por evento y una venta ya registrada se puede editar (precio, canal, evento). |
| **Lote** | Varias cartas a la vez (cámara en ráfaga, una por una o buscando): valor total, **oferta máxima** para tu margen y veredicto sobre lo que piden. “Comprar el lote” reparte lo pagado según el valor de cada carta; “Solo agregar” carga cartas que ya tenías (costo = mercado). |
| **Reporte** | Ganancia realizada por **mes**, por **feria/evento** y por **canal**, menos **gastos** (entrada, transporte, fundas, envíos…). Exporta inventario y gastos a CSV (Excel). |
| **Novedades** | En Inicio: carta de la wishlist bajo tu precio meta, carta del vault que se movió más de X% en 7 días, carta que ya rinde tu margen objetivo. Con la app instalada, también como número en el ícono (actívalo en Ajustes: iPhone pide permiso de notificaciones; no se envían notificaciones). |
| **Lista de venta** | En Colección: elige qué vendes, ajusta precios y comparte una imagen o texto para WhatsApp / Instagram. |

### Más funciones
- **Paga como máximo**: en cada carta, el precio que todavía te deja tu margen objetivo (Ajustes) después de la comisión de tu canal habitual. Avisa si lo que piden lo supera.
- **Estado y gradeadas**: NM / LP / MP / HP / DMG (85%, 70%, 50% y 35% del precio Near Mint, valores de referencia del mercado) y cartas gradeadas (PSA, CGC, BGS…) con el valor que ingreses tú: no hay fuente gratuita confiable para precios de gradeadas.
- **Cartas japonesas** (precio TCGplayer Japón) y **productos sellados** (cajas, ETB, sobres…), en Buscar → *Japonesas* / *Sellados*. El escáner tiene un botón **EN/JP**: en japonés busca por el número impreso (y con Claude, también por el nombre).
- **Canales de venta** con su comisión (% + monto fijo) en Ajustes; al vender eliges el canal y se descuenta solo.
- **Respaldo a iCloud** con un toque (Más, Ajustes o el aviso semanal en Inicio): en el iPhone elige “Guardar en Archivos”. El respaldo no incluye tus API keys; al importarlo se mantienen las del teléfono.
- **Feria recordada**: la feria/evento que escribes se propone sola en las demás compras, ventas y gastos del mismo día.
- Montos al estilo chileno en ambas monedas: $320.156 · US$326,74 · €402,61.

### Cómo se elige qué vender
Puntaje = ganancia % sobre tu compra + monto de la ganancia + tendencia del precio (si el promedio de 7 días está bajo el de 30, conviene vender antes; si sube, quizás esperar) + tiempo en el vault. Las cartas marcadas como **colección** no aparecen salvo que actives “Incluir colección”.

## Reconocimiento de cartas
- **Sin configurar nada:** OCR en el teléfono (Tesseract.js). Lee el nombre y el número impreso abajo (`199/165`) y confirma uno contra el otro. Funciona mejor con buena luz, sin reflejos y con la carta llenando el marco. Siempre puedes confirmar con la imagen oficial o usar **Buscar**. Si una foto sale movida, el escáner toma otras del video (al menos 3 intentos, ~12 s) y va contando qué está leyendo. El OCR se descarga una vez con señal (~7 MB) para que también funcione en la feria sin internet.
- **Recomendado:** en Ajustes pega una API key de Anthropic (console.anthropic.com). Claude identifica la carta desde la foto: mucho más robusto con fundas, reflejos y ángulos. Cuesta fracciones de centavo de dólar por foto. La clave se guarda solo en el teléfono.

## Publicar en GitHub Pages
1. Crea un repositorio en GitHub (por ejemplo `vaultkeeper`).
2. Sube el contenido de esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "VaultKeeper"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/vaultkeeper.git
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save.
4. En un par de minutos queda en `https://TU_USUARIO.github.io/vaultkeeper/`.

> La cámara solo funciona con HTTPS (GitHub Pages lo da). En `localhost` la app funciona, pero el modo sin conexión (service worker) solo se activa en HTTPS.

## Instalar en el iPhone
Abre la URL en **Safari** → botón **Compartir** → **Agregar a pantalla de inicio**. Abre a pantalla completa, funciona sin conexión con los últimos precios y iOS no borra los datos de apps instaladas. Cuando hay una versión nueva, la app la descarga completa en segundo plano y muestra **"Hay una versión nueva · Toca para actualizar"**.

## Qué significa cada precio
- **Imágenes:** TCGdex no tiene foto de algunas cartas (por ejemplo todas las *MEP Black Star Promos* y varias promos de McDonald's). El robot busca esas cartas en TCGplayer y publica `data/imagenes.json`; la app muestra la imagen de TCGplayer en su lugar.
- **TCGplayer market:** promedio de ventas recientes en TCGplayer (EE.UU.). Es el que usa la app para valorizar y para el veredicto de feria.
- **Más barata publicada / Mediana publicada:** lo que piden hoy los vendedores en TCGplayer (no lo que se pagó). El precio más alto publicado no se muestra porque suele ser un aviso desactualizado o absurdo.
- **Cardmarket · Europa:** referencia del mercado europeo en euros, con su equivalente en pesos. Su tendencia (promedio 7 días vs 30 días) ayuda a decidir cuándo vender. Solo se usa para valorizar si no hay precio de TCGplayer.

## Cómo se calculan los montos
- **Costo:** se guarda en CLP y en USD con el dólar del momento de la compra (o del día que indiques si la registras con fecha pasada: dólar observado de mindicador.cl; si no responde, tipo de mercado de ese día). Ese costo no cambia aunque el dólar se mueva.
- **Valor:** precio TCGplayer *market* de la versión exacta (Normal / Holo / Reverse); si no hay, *mid*, luego *low*; si la carta tiene una sola versión listada se usa esa; si no hay TCGplayer, Cardmarket (EUR→USD). Nunca se toma el precio de otra versión. Sin precio, la carta cuenta a su costo.
- **Ganancia en CLP** = valor en USD × dólar de hoy − lo que pagaste en pesos (incluye el efecto del dólar). **En USD** = valor − costo en USD.
- **Venta:** se registra lo que recibes neto de la comisión configurada; la ganancia realizada es neto − costo.
- **Intercambio:** tus cartas salen a valor de mercado y las que recibes entran con ese valor (± efectivo) como costo. Si te pagan más efectivo que lo que valen tus cartas, el exceso cuenta como ganancia realizada. Siempre se cumple: Σ ventas − Σ costos nuevos = efectivo neto recibido.
- **Tipo de cambio fijado a mano** en Ajustes se respeta hasta que presiones *Actualizar*.

Pruebas: `node tests/calc.test.mjs`, `node tests/features.test.mjs`, `node tests/match.test.mjs`, `node tests/historial.test.mjs`

## Precios de expansiones nuevas (automático)
TCGdex a veces tarda semanas en cargar precios de una expansión recién salida (pasó con 30th Celebration, 30th Classic Collection y las promos MEP). Para cubrir ese hueco, el repositorio trae un robot:

- `.github/workflows/precios.yml` corre todos los días a las 21:15 UTC (y en cada push que cambie `scripts/`).
- `scripts/precios-faltantes.mjs` detecta las expansiones recientes sin precio en TCGdex, busca su equivalente en [TCGCSV](https://tcgcsv.com) (espejo diario de TCGplayer) y cruza carta por carta por número y nombre. También trae la rareza y la versión reales.
- El resultado (`data/precios-extra.json`) se publica en la rama `datos`, así nunca choca con tus push a `main`. La app lo lee desde `raw.githubusercontent.com`; la copia en `main` es solo respaldo.
- Cuando TCGdex carga sus propios precios, la app vuelve a usarlos sola.
- También publica el **catálogo de cartas japonesas** (desde US$2) y de **productos sellados** (desde US$3) de TCGplayer, en `data/catalogo/` (`scripts/tcgcsv-diario.mjs`, una sola pasada diaria de ~1.400 consultas a TCGCSV).
- El mismo robot guarda el **historial diario de precios** de TCGplayer de todas las cartas Pokémon desde US$5 (`scripts/historial.mjs` → `data/hist/` en la rama `datos`): diario los últimos 120 días y semanal antes. TCGplayer no publica historial, así que empieza a acumularse desde el 08-10-2026. En la app: toca el precio de una carta → **Historial de precio** (también suma lo que consultas en el teléfono y los promedios 1/7/30 días de Cardmarket).
- No hay nada que configurar. Para forzarlo: pestaña **Actions → Precios faltantes → Run workflow**.

Para probarlo en tu computador: `node scripts/precios-faltantes.mjs`, `node scripts/tcgcsv-diario.mjs --data data`, `node tests/match.test.mjs` y `node tests/historial.test.mjs`.

## Datos y respaldo
Todo vive en el `localStorage` del teléfono. En **Ajustes → Exportar respaldo** descargas un `.json`; con **Importar** lo cargas en otro teléfono.

## Fuentes
- Cartas, imágenes y precios: [TCGdex](https://tcgdex.dev) (precios de TCGplayer en USD y Cardmarket en EUR), respaldo [pokemontcg.io](https://pokemontcg.io) y, para expansiones nuevas, [TCGCSV](https://tcgcsv.com) (datos de TCGplayer, actualizados una vez al día).
- Tipo de cambio: [mindicador.cl](https://mindicador.cl) (dólar observado), respaldo [open.er-api.com](https://open.er-api.com).

## Limitaciones conocidas
- Cartas japonesas: precio de TCGplayer Japón (mercado de EE.UU. para cartas japonesas). Sin Claude, el escáner japonés solo puede leer el número impreso.
- Gradeadas: el valor lo ingresas tú. Notificaciones push no están activadas (las alertas aparecen al abrir la app y en el ícono).
- El gráfico guarda un punto por día en que la app actualiza precios; la historia empieza el día que empiezas a usarla.
- TCGplayer “market” es el precio de venta reciente en EE.UU.; en Chile el precio real de reventa puede ser distinto. Ajusta la comisión en Ajustes.

## Desarrollo local
```bash
python -m http.server 8765
```
y abre http://localhost:8765. No hay build: HTML + CSS + módulos JS.

### Validar el diseño en todos los iPhone

`tests/layout-check.js` revisa la pantalla abierta: piezas de la cabecera que se montan o se salen, montos cortados con "…" y cualquier cosa más ancha que la pantalla. Pégalo en la consola del navegador (o córrelo desde un navegador automatizado) con la app abierta en cada ancho: 320 (SE 1ª gen.), 360, 375 (SE / mini), 390–393 (13–16), 402 (16 Pro), 414, 430 (Plus / Pro Max) y 440 (16 Pro Max). Devuelve `{ ok, problems }`.
