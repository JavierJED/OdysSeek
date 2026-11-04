<div align="center">
  <img src="logos/icon128.png" alt="Logotipo de OdysSeek" width="112" height="112">

  # OdysSeek

  **Herramientas de investigación académica desde tu navegador.**

  Extensión para Google Chrome · Manifest V3 · JavaScript, HTML y CSS

  **Versión:** `3.4.3` · **Estado:** desarrollo / pruebas previas a publicación

  [English](README.en.md) · [Instalación](#instalación-para-desarrollo) · [Problemas conocidos](docs/PROBLEMAS_CONOCIDOS.md) · [Privacidad](docs/PRIVACIDAD.md)
</div>

---

## ¿Qué es OdysSeek?

OdysSeek es una extensión de navegador orientada a facilitar la lectura y organización de fuentes académicas. Permite buscar y resaltar texto, guardar referencias y notas, organizar recursos y exportar información para trabajar con documentos de investigación.

El proyecto está **en desarrollo**. Esta versión puede instalarse manualmente para pruebas; todavía no se anuncia como una versión estable de Chrome Web Store.

## Funciones incluidas

- **Búsqueda y resaltado:** localización de términos, navegación entre coincidencias y resaltados personalizables en páginas web.
- **Google Scholar:** filtros y reordenación de resultados en la interfaz de Scholar; su comportamiento depende de la estructura de esa página.
- **Lectura de PDF:** visor integrado basado en PDF.js, extracción de texto y selección de párrafos relevantes mediante reglas heurísticas.
- **Referencias:** recopilación de citas y presentación en formatos APA, MLA, Chicago y Vancouver. **Verifica siempre los metadatos y el formato antes de citar.**
- **Notas y recursos:** anotaciones asociadas a páginas, historial y papelera con restauración.
- **Exportación:** archivos `.doc` compatibles con procesadores de texto y XML de fuentes bibliográficas para Word. **No genera archivos `.docx` nativos.**
- **IA opcional:** asistencia para redactar relevancia o referencias con una clave API propia de Gemini o DeepSeek; está desactivada por defecto y requiere conexión con el proveedor.

> La selección de párrafos del motor PDF es **heurística**, no un sistema de embeddings ni una garantía de comprensión semántica. Las respuestas de IA pueden contener errores.

## Instalación para desarrollo

No hace falta Node.js ni compilar el proyecto para utilizar la extensión.

1. Descarga este repositorio desde **Code → Download ZIP** o clónalo con Git.
2. Descomprime el ZIP si corresponde.
3. Abre `chrome://extensions/` en Chrome.
4. Activa **Modo de desarrollador**.
5. Haz clic en **Cargar descomprimida** y selecciona la carpeta que contiene `manifest.json`.
6. Fija OdysSeek en la barra de extensiones y pruébala en una página web.

**Precaución:** prueba primero en páginas y PDFs públicos. El visor PDF puede fallar en ciertos sitios, especialmente cuando existen bloqueos, redirecciones o sesiones autenticadas. Consulta [problemas conocidos](docs/PROBLEMAS_CONOCIDOS.md).

## Uso básico

1. Abre una página web y haz clic en el icono de OdysSeek.
2. Escribe un concepto en **Buscar** para localizar y resaltar contenido.
3. Utiliza **Citas**, **Notas** o **Recursos** para guardar información relacionada con la investigación.
4. Exporta los registros cuando necesites llevarlos a un documento.
5. En **Configuración**, personaliza los colores y, solo si lo deseas, habilita un proveedor de IA con tu propia clave.

## Arquitectura

```text
OdysSeek/
├── manifest.json             # Configuración de la extensión (MV3)
├── background.js             # Service worker, menús contextuales y PDF
├── content.js                # Funciones sobre páginas y Google Scholar
├── content-styles.css        # Estilos de resaltado
├── popup.html / popup.js     # Interfaz y lógica de usuario
├── styles.css                # Estilos del popup
├── pdf-engine.js             # Clasificación heurística de texto PDF
├── pdf-viewer/               # Visor y recursos PDF.js (terceros + integración)
├── pdf.min.js                # PDF.js incluido
├── pdf.worker.min.js         # Worker PDF.js incluido
├── logos/                    # Iconos
├── privacidad.html           # Aviso de privacidad dentro de la extensión
├── docs/                     # Documentación del proyecto
├── scripts/                  # Validación y empaquetado
└── .github/                  # Plantillas y comprobaciones automáticas
```

Más detalles en [Arquitectura](docs/ARQUITECTURA.md).

## Permisos y privacidad

La extensión utiliza `activeTab`, `scripting`, `storage`, `tabs` y `contextMenus`, además de acceso a sitios mediante `<all_urls>` para sus funciones sobre páginas y documentos. **El alcance de este permiso debe revisarse antes de publicar.**

Las citas, notas, recursos, historial y preferencias se almacenan localmente con `chrome.storage.local`. Si activas la asistencia con IA y realizas una solicitud, se envían los datos necesarios y tu clave API al proveedor elegido. La clave se conserva en el almacenamiento local del navegador **sin cifrado adicional por OdysSeek**.

Lee la [política de privacidad](docs/PRIVACIDAD.md) antes de usar funciones que procesen información sensible. No introduzcas claves API en capturas, incidencias o commits.

## Desarrollo y validación

Requisitos opcionales para contribuir: **Node.js 22+** y **Python 3.10+**. No se necesita instalar dependencias de npm.

```bash
node --check background.js
node --check content.js
node --check popup.js
node --check pdf-engine.js
node --check pdf-viewer/web/viewer-loader.js
python3 scripts/validate_repo.py
python3 -m unittest discover -s tests -v
python3 scripts/package_webstore.py
```

El último comando crea `dist/OdysSeek_v3.4.3_WEBSTORE.zip`, con `manifest.json` en la raíz. **Que pase la validación estática no significa que el visor PDF haya superado pruebas funcionales en Chrome.**

## Estado y próximos pasos

- [x] Código de la versión 3.4.3 organizado para GitHub.
- [x] Documentación, avisos de terceros y comprobaciones estáticas.
- [ ] Corregir los errores de carga de PDF.js observados en Chrome.
- [ ] Probar el visor y las exportaciones con documentos reales.
- [ ] Revisar permisos, política de privacidad pública y compatibilidad de APIs de IA.
- [ ] Preparar una versión candidata para Chrome Web Store.

Consulta [Hoja de ruta](docs/HOJA_DE_RUTA.md) y [Registro de cambios](CHANGELOG.md).

## Autor y publicación

OdysSeek es un proyecto de desarrollo independiente. El titular puede añadir aquí su perfil público de GitHub y los agradecimientos a colaboradores con contribuciones verificables.

Consulta [Cómo publicar en GitHub](docs/PUBLICAR_EN_GITHUB.md) para preparar el repositorio, decidir su visibilidad y realizar el primer commit.

## Colaboración y seguridad

Se aceptan propuestas e informes reproducibles de errores. Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de proponer cambios y [SECURITY.md](SECURITY.md) para reportar vulnerabilidades sin publicar información sensible.

## Licencias y atribución

OdysSeek contiene código propio y componentes de terceros, especialmente **PDF.js (Mozilla Foundation)** bajo Apache 2.0 y recursos con licencias específicas. Sus avisos se conservan en el repositorio: [licencias de terceros](docs/LICENCIAS_TERCEROS.md).

**El titular del proyecto todavía debe elegir la licencia aplicable al código original de OdysSeek.** La presencia del código en GitHub no autoriza automáticamente su reutilización. Consulta [decisión de licencia](docs/LICENCIA_PENDIENTE.md).

---

<sub>Proyecto independiente para apoyar la investigación académica. La calidad de las referencias y los resultados debe comprobarse antes de utilizarlos en trabajos formales.</sub>
