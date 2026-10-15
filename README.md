# EspaciaV2

> **Sistema Integral de Gestión de Reservas para Consultorios**  
> Refactorización robusta, modular y segura de *Espacia*, migrada hacia una arquitectura basada en funciones serverless (Netlify), validación estricta en backend, integración oficial con Google Calendar y persistencia transaccional con control de concurrencia en GitHub.

---

## 📌 Estado del Proyecto
* **Versión actual:** `0.2.0` (En fase de desarrollo activo / Backend implementado con pruebas automáticas)
* **Stack tecnológico:** Node.js (>=20), Netlify Functions (`netlify/functions`), Google Calendar API (`googleapis`), GitHub Contents API (para el almacenamiento de usuarios) y el sistema de pruebas nativo de Node.js (`node:test`).

---

## 🏗️ Arquitectura y Estructura del Repositorio

El proyecto separa claramente la lógica pura de negocio, los permisos y las conexiones de red (restringidas exclusivamente a los módulos de integración con servicios externos).

```text
EspaciaV2/
├── .github/workflows/
│   └── pruebas.yml              # Pipeline de CI que ejecuta las pruebas automáticas en cada push/PR
├── compartido/
│   └── reglas.json              # Fuente única de verdad: horarios, días, duraciones y antelaciones
├── documentacion/
│   └── reglas_de_negocio.md     # Documentación detallada de políticas y decisiones de diseño
├── netlify/functions/nucleo/
│   ├── configuracion.js         # Carga y validación segura de variables de entorno (ESPACIAV2_*)
│   ├── github_usuarios.js       # Repositorio de usuarios con control anti-concurrencia (SHA de Git)
│   ├── google_calendario.js     # Adaptador oficial de Google Calendar y mapeo de eventos antiguos
│   ├── permisos.js              # Control de acceso basado en roles (usuario, gestor, admin)
│   ├── reglas_de_negocio.js     # Lógica pura de validación (fechas, solapamientos, límites)
│   └── reservas_servicio.js     # Casos de uso transaccionales (crear, cancelar, bloquear con reintento)
├── pruebas/
│   ├── ayudas/                  # Simuladores en memoria de Google Calendar y GitHub API
│   ├── *.prueba.js              # Pruebas unitarias e integrales por módulo
│   └── todas.prueba.js          # Orquestador general de la suite de pruebas
└── package.json
```

---

## ⚙️ Reglas de Negocio Clave

1. **Validación Centralizada en Servidor:** Toda la lógica de negocio (días laborables, horarios de apertura/cierre, tramos de 30 minutos, duraciones permitidas de 60/90 minutos y restricciones de antelación) se valida rigurosamente en el backend.
2. **Roles y Permisos (`permisos.js`):**
   * **Usuario:** Puede gestionar sus propias reservas y consultar exclusivamente su historial.
   * **Gestor:** Puede operar sobre reservas y bloqueos, crear usuarios comunes y cerrar el día anterior dentro del margen establecido.
   * **Administrador:** Control total del sistema, incluyendo agendamientos en el pasado y asignación de roles.
3. **Control de Concurrencia y Cohesión Transaccional:**
   * **En Google Calendar:** Mecanismo de reintento determinista (`confirmarSinCarrera`) que resuelve condiciones de carrera ante reservas simultáneas en el mismo horario.
   * **En GitHub (Usuarios):** Uso obligatorio de verificación de `sha` para evitar sobrescrituras accidentales si múltiples administradores actualizan la base de datos de usuarios al mismo tiempo.

---

## 🚀 Pruebas Automáticas

El proyecto cuenta con una cobertura de pruebas exhaustiva que simula de forma aislada tanto Google Calendar como GitHub (sin tocar datos reales de producción).

Para correr la suite completa de pruebas en tu entorno local:

```bash
npm test
```

Las pruebas se ejecutan automáticamente en cada subida de código mediante GitHub Actions (`.github/workflows/pruebas.yml`).

---

## 🔧 Configuración de Variables de Entorno (Netlify)

El sistema valida estrictamente la presencia de las variables requeridas al iniciar. Si falta alguna, el servidor responde con un código `500` indicando exactamente el nombre del parámetro faltante (sin exponer nunca valores sensibles).

* `ESPACIAV2_MODO` (`produccion` o `pruebas`)
* `ESPACIAV2_SESION_SECRETO` (Mínimo 32 caracteres)
* `ESPACIAV2_GOOGLE_CUENTA_EMAIL`
* `ESPACIAV2_GOOGLE_CLAVE_PRIVADA`
* `ESPACIAV2_GOOGLE_CALENDARIO_ID` *(o `ESPACIAV2_GOOGLE_CALENDARIO_PRUEBAS_ID` si el modo es pruebas)*
* `ESPACIAV2_GITHUB_TOKEN`
* `ESPACIAV2_GITHUB_REPO`
* `ESPACIAV2_GITHUB_RUTA_USUARIOS`