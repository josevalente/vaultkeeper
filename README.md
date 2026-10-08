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

## Datos y respaldo
Todo vive en el `localStorage` del teléfono. En **Ajustes → Exportar respaldo** descargas un `.json`; con **Importar** lo cargas en otro teléfono.

## Fuentes
- Cartas, imágenes y precios: [TCGdex](https://tcgdex.dev) (precios de TCGplayer en USD y Cardmarket en EUR), respaldo [pokemontcg.io](https://pokemontcg.io).
- Tipo de cambio: [mindicador.cl](https://mindicador.cl) (dólar observado), respaldo [open.er-api.com](https://open.er-api.com).

## Limitaciones conocidas
- Los precios son de cartas en **inglés** (TCGplayer). Las japonesas se pueden registrar buscando su equivalente, pero el precio será el de la versión en inglés.
- El gráfico guarda un punto por día en que la app actualiza precios; la historia empieza el día que empiezas a usarla.
- TCGplayer “market” es el precio de venta reciente en EE.UU.; en Chile el precio real de reventa puede ser distinto. Ajusta la comisión en Ajustes.

## Desarrollo local
```bash
python -m http.server 8765
```
y abre http://localhost:8765. No hay build: HTML + CSS + módulos JS.
