# Waya Surf School - Sitio Web Estático

Sitio principal de Waya Surf School (`wayasurf.com`) construido en HTML/CSS/JS vanilla.

## Estructura

```text
wayasurf-com/
├── *.html                # Páginas públicas y panel admin
├── components/           # Header/Footer reutilizables
├── css/                  # Estilos globales y por secciones
├── js/                   # Lógica UI, i18n, blog y configuración
├── images/               # Recursos gráficos en uso
├── data/                 # Datos estáticos auxiliares
└── *.sql                 # Scripts de soporte para Supabase
```

## Ejecutar en local

```bash
cd /Users/felipecamarabarroso/.gemini/antigravity/scratch/wayasurf-com
python3 -m http.server 8001
```

Abrir: `http://localhost:8001`

## Notas de mantenimiento

- El proyecto no usa build step: los cambios se aplican directamente sobre archivos fuente.
- `js/config.js` contiene configuración pública (`anon key`) de Supabase para cliente.
- Evitar duplicar carpetas de despliegue dentro del repositorio de trabajo.
