# 08 — ISABELLA VERIFICACIÓN, CERTIFICACIÓN Y BLINDAJE DE INTEGRIDAD CIENTÍFICA

> **Estado:** Vigente (PLAN) — **Propietario:** Gobernanza / Arquitectura — **Revisión:** 2026-10-07

## 1. Propósito

Documento de cabecera del **pilar de Integridad Científica** de Isabella: filtra, verifica, certifica y blinda la
veracidad, viabilidad y respaldo de la información científica y técnica alojada o indexada por las librerías de
Isabella, con trazabilidad criptográfica, gobernanza de datos, revisión humana y auditoría externa más rigurosas que
las prácticas comunes del sector.

## 2. Directiva de doble fase

- **Fase A (completada — este paquete):** integración documental completa: blueprint, manual técnico, reglamentos,
  licenciamiento, cumplimiento regulatorio, certificación/auditoría, playbooks, roadmap/piloto y plantillas.
- **Fase B (en cola):** implementación **real y funcional** de las librerías nativas de Isabella, interconectadas con
  el **ML nativo** (`src/lib/native-ml`, `src/lib/intelligence`, `src/lib/claim-radar`, `src/lib/ncua`) y con el
  **Hypercore de Isabella** (`src/lib/acceleration/hypercore.ts`, `hypercore-adapters.ts`, `hypercore-routes.ts`).
  Contrato de integración en `docs/science-integrity/10-integracion-hypercore-ml-nativo.md`.

## 3. Guía de lectura

1. `docs/science-integrity/00-INDICE.md` — visión, objetivos, mapeo a módulos y registro de entregas.
2. `docs/science-integrity/01-blueprint-arquitectonico.md` — arquitectura (con PlantUML canónico).
3. `docs/science-integrity/02-manual-tecnico-operativo.md` — contrato OpenAPI v2, datos, pipelines, seguridad, KPIs.
4. `docs/science-integrity/03-reglamentos-y-politicas.md` — gobernanza y ética (COI, retractación, apelaciones).
5. `docs/science-integrity/04-licenciamiento-y-modelos-legales.md` — licencias y riesgos legales.
6. `docs/science-integrity/05-alineamiento-regulatorio-global.md` — GDPR, COPE, FAIR, DataCite, W3C VC, ISO 27001.
7. `docs/science-integrity/06-plan-certificacion-y-auditoria.md` — niveles 0–4 y sellos verificables.
8. `docs/science-integrity/07-playbooks-operativos.md` — playbooks por rol + bitácora de correcciones de revisión.
9. `docs/science-integrity/08-hoja-de-ruta-cronograma-y-piloto.md` — fases, piloto y matriz de riesgos.
10. `docs/science-integrity/09-plantillas-y-artefactos.md` — índice de artefactos (OpenAPI, legal, JSON-LD, VC).
11. `docs/science-integrity/10-integracion-hypercore-ml-nativo.md` — contrato del puente Hypercore + ML nativo.

## 4. Regla de honestidad

Este pilar es **documentación de plan (PLAN/DOC)**. No constituye capacidad de producción verificada hasta que la
Fase B genere código con pruebas same-commit conforme a la escala de `AGENTS.md` §0.1. Los sellos, certificados y
verificaciones descritos **no existen en producción**.

## 5. Estado de integración

Ver registro de entregas en `docs/science-integrity/00-INDICE.md` §8 (módulos recibidos, integrados y correcciones
aplicadas C1–C9). Pendientes de recibir: cronograma/CSV de costos, scripts/Dockerfile de reproducción y archivos
exportables.