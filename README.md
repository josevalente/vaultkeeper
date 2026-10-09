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
| **Faltantes** | Eliges una rareza (Illustration Rare, Special Illustration Rare, Hyper Rare, Mega Hyper Rare…) y ves **todas** las cartas que existen con esa rareza, por expansión, cuáles tienes y cuáles te faltan, con precio y ordenadas de la más barata (las más fáciles de conseguir). Incluye wishlist. |
| **Intercambio** | Tus cartas (valorizadas) vs. las del otro (por foto o búsqueda, valorizadas igual) + dinero extra. Te dice si es justo, a favor o en contra, y al confirmar actualiza el vault. |
| **Lote** | Varias cartas a la vez (cámara en ráfaga, una por una o buscando): valor total, **oferta máxima** para tu margen y veredicto sobre lo que piden. “Comprar el lote” reparte lo pagado según el valor de cada carta; “Solo agregar” carga cartas que ya tenías (costo = mercado). |
| **Reporte** | Ganancia realizada por **mes**, por **feria/evento** y por **canal**, menos **gastos** (entrada, transporte, fundas, envíos…). Exporta inventario y gastos a CSV (Excel). |
| **Novedades** | En Inicio (y como número en el ícono de la app): carta de la wishlist bajo tu precio meta, carta del vault que se movió más de X% en 7 días, carta que ya rinde tu margen objetivo. |
| **Lista de venta** | En Colección: elige qué vendes, ajusta precios y comparte una imagen o texto para WhatsApp / Instagram. |

### Más funciones
- **Paga como máximo**: en cada carta, el precio que todavía te deja tu margen objetivo (Ajustes) después de la comisión de tu canal habitual. Avisa si lo que piden lo supera.
- **Estado y gradeadas**: NM / LP / MP / HP / DMG (85%, 70%, 50% y 35% del precio Near Mint, valores de referencia del mercado) y cartas gradeadas (PSA, CGC, BGS…) con el valor que ingreses tú: no hay fuente gratuita confiable para precios de gradeadas.
- **Cartas japonesas** (precio TCGplayer Japón) y **productos sellados** (cajas, ETB, sobres…), en Buscar → *Japonesas* / *Sellados*. El escáner tiene un botón **EN/JP**: en japonés busca por el número impreso (y con Claude, también por el nombre).
- **Canales de venta** con su comisión (% + monto fijo) en Ajustes; al vender eliges el canal y se descuenta solo.
- **Respaldo a iCloud** con un toque (Ajustes o el aviso semanal en Inicio): en el iPhone elige “Guardar en Archivos”.

### Cómo se elige qué vender
Puntaje = ganancia % sobre tu compra + monto de la ganancia + tendencia del precio (si el promedio de 7 días está bajo el de 30, conviene vender antes; si sube, quizás esperar) + tiempo en el vault. Las cartas marcadas como **colección** no aparecen salvo que actives “Incluir colección”.

## Reconocimiento de cartas
- **Sin configurar nada:** OCR en el teléfono (Tesseract.js). Lee el nombre y el número impreso abajo (`199/165`) y confirma uno contra el otro. Funciona mejor con buena luz, sin reflejos y con la carta llenando el marco. Siempre puedes confirmar con la imagen oficial o usar **Buscar**.
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
Abre la URL en **Safari** → botón **Compartir** → **Agregar a pantalla de inicio**. Abre a pantalla completa, funciona sin conexión con los últimos precios y iOS no borra los datos de apps instaladas.

## Qué significa cada precio
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
