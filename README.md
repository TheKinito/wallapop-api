# 🔧 wallapop-api — Instrucciones de despliegue

## ¿Qué es esto?
Una API que usa Playwright (navegador sin cabeza) para hacer scraping real de Wallapop, devolviendo resultados con título, precio, imagen, ubicación y descripción.

---

## 🚀 Despliegue en Railway (gratis)

### 1. Crea cuenta en Railway
Ve a https://railway.app y regístrate con GitHub.

### 2. Sube el código a GitHub
Crea un repositorio nuevo llamado `wallapop-api` y sube estos 3 archivos:
- `server.js`
- `package.json`
- `railway.toml`

### 3. Crea el proyecto en Railway
1. En Railway → **New Project** → **Deploy from GitHub repo**
2. Selecciona `wallapop-api`
3. Railway detecta Node.js automáticamente
4. El `postinstall` instala Chromium automáticamente

### 4. Obtén tu URL
Una vez desplegado, Railway te da una URL tipo:
```
https://wallapop-api-production-xxxx.up.railway.app
```

### 5. Actualiza tu web
Abre `fliptracker-repairlab.html` (tu `index.html`) y busca esta línea:
```javascript
const API_URL = 'https://TU-API.railway.app';
```
Cámbiala por tu URL real:
```javascript
const API_URL = 'https://wallapop-api-production-xxxx.up.railway.app';
```

Luego sube el `index.html` actualizado a tu repositorio de Wallapop-invetory en GitHub. Vercel lo despliega automáticamente.

---

## 📡 Endpoints disponibles

### `GET /search`
Busca productos en Wallapop.

**Parámetros:**
| Param | Tipo | Descripción |
|-------|------|-------------|
| `q` | string | Texto de búsqueda (requerido) |
| `minPrice` | number | Precio mínimo en € |
| `maxPrice` | number | Precio máximo en € |
| `condition` | string | `nuevo`, `como_nuevo`, `buen_estado`, `aceptable` |
| `order` | string | `newest`, `price_low_to_high`, `price_high_to_low` |
| `limit` | number | Máximo de resultados (default: 24) |

**Ejemplo:**
```
GET /search?q=iphone+12&minPrice=50&maxPrice=200&condition=buen_estado
```

**Respuesta:**
```json
{
  "query": "iphone 12",
  "total": 18,
  "wallapopUrl": "https://es.wallapop.com/app/search?keywords=iphone+12...",
  "items": [
    {
      "id": "abcdef123",
      "title": "iPhone 12 negro pantalla rota",
      "price": 120,
      "priceText": "120 €",
      "imageUrl": "https://cdn.wallapop.com/...",
      "location": "Madrid",
      "description": "Vendo iPhone 12 con pantalla rota...",
      "url": "https://es.wallapop.com/item/abcdef123"
    }
  ]
}
```

### `GET /item/:id`
Obtiene el detalle completo de un producto.

---

## ⚠️ Notas importantes

- Railway en plan gratuito da **500 horas/mes** de ejecución — suficiente para uso personal
- El primer arranque tarda ~30s porque descarga Chromium
- Cada búsqueda se cachea **5 minutos** para no sobrecargar Wallapop
- Si Wallapop actualiza su web, puede necesitar ajustar los selectores CSS en `server.js`

## 🔒 CORS
La API permite peticiones desde cualquier origen (`*`). Si quieres restringirlo a tu web:
```javascript
// En server.js, cambia la línea de CORS por:
res.header('Access-Control-Allow-Origin', 'https://wallapop-invetory.vercel.app');
```
