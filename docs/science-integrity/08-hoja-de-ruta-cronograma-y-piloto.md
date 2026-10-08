# 08 — Hoja de Ruta, Cronograma y Plan Piloto

> **Estado:** Vigente (PLAN) — **Propietario:** Gobernanza / Operaciones — **Revisión:** 2026-10-07
> El cronograma con **recursos y costos detallados (CSV)** se integrará como módulo canónico entregado por el
> responsable (ver `00-INDICE.md` §8 — registro de entregas). Este documento fija fases, pilotaje y riesgos.

## 1. Fases de la hoja de ruta

| Fase | Nombre | Entregables | Salida verificable |
| --- | --- | --- | --- |
| 0 | Fundaciones | Este paquete documental + contratos OpenAPI + plantillas legales | Repo integrado, gates verdes |
| 1 | Plataforma núcleo | Ingest, ledger, search, auth | Ingest→ledger e2e |
| 2 | Verificación automática | Verificadores (plagio, refs, imágenes, NLP) + reglas de decisión | Pipeline con report JSON |
| 3 | Verificación humana | Workflow revisores, firma, COI | Revisión firmada en ledger |
| 4 | Reproducibilidad | Sandbox + `environment_spec` + assertions | `reproducibility_report` |
| 5 | Certificación y VC | Sellos, verificación pública, revocación | VC emitida y verificada |
| 6 | Auditoría y gobernanza | Auditoría externa, KPIs, acreditación | Informe de auditoría |

> La **Fase B** de librerías nativas (Hypercore + ML nativo) se ejecuta en paralelo según
> `10-integracion-hypercore-ml-nativo.md` §6.

## 2. Plan piloto (beta cerrada)

- **Duración:** 6 meses (fases 2–4 del roadmap pueden solaparse con el piloto).
- **Volumen objetivo:** 100–200 contenidos reales de disciplinas heterogéneas (para calibrar umbrales por área).
- **Participantes:** panel cerrado de autores, revisores experimentados y 1 auditor externo de prueba.
- **Métricas del piloto**
  - Tiempo medio de ingestación→verificación.
  - Precisión/recall de clasificación automática vs. decisión humana (acuerdo entre anotadores).
  - Tasa de sellos emitidos y revocados; tasa de apelaciones.
  - Usabilidad de paneles (NPS interno).
- **Actividades clave**
  - Calibrar umbrales por disciplina con los verificadores nativos.
  - Probar el flujo completo nativo (ledger → ML → revisión → sello) en staging.
  - Ejercicio de retractación y apelación para validar gobernanza.
- **Criterio de salida del piloto:** acuerdo inter-anotadores ≥ umbral definido, FP ≤ 2% en sellos y apelaciones
  resueltas ≥ 90%.

## 3. Matriz de riesgos del programa

| Categoría | Riesgo | Prob. | Impacto | Mitigación |
| --- | --- | --- | --- | --- |
| Legal | Responsabilidad por sellos erróneos | Media | Alto | TOS/DPA/DUA, limitación de responsabilidad, seguro E&O |
| Técnico | Drift de verificadores ML | Media | Alto | Canary, DRIFT, umbrales por disciplina |
| Operativo | RTO/RPO no alcanzables | Baja | Medio | Runbooks probados, DR trimestral, chaos |
| Datos | Brecha de datos personales | Baja | Alto | Cifrado, DPA, notificación 72 h, HSM |
| Mercado | Adopción baja de sellos | Media | Medio | Alineación con COPE/FAIR/W3C VC y pilotos abiertos |
| Reputacional | Sello falso difundido | Baja | Alto | Retractación pública, auditoría, kill-switch |
| Cumplimiento | Cambios regulatorios regionales | Media | Alto | Matriz regulatoria + revisión legal continua |

## 4. KPIs de programa

Ver `02-manual-tecnico-operativo.md` §8 (tabla de KPIs y SLOs). Objetivos piloto:

| KPI | Meta piloto |
| --- | --- |
| Acuerdo inter-anotadores | ≥ 0.80 (Cohen κ) |
| Falsos positivos en sellos | ≤ 2% |
| Apelaciones resueltas | ≥ 90% en plazo |
| Tiempo medio ingest→verificable | P95 ≤ 15 s |
| Disponibilidad | ≥ 99.9% (staging) |

## 5. Recursos y costos

- Detalle de **recursos por fase, esfuerzo y costos orientativos** se incorporará cuando se integre el módulo
  cronograma/CSV entregado por el responsable (registro pendiente en `00-INDICE.md` §8).
- Premisas de costeo: infra como código, HSM/KMS, servicios de plagio, auditoría externa anual y equipo de revisión
  humana. Los montos se validarán contra escalas de mercado antes de fijar presupuesto.

## 6. Mejora continua

- Revisión trimestral de umbrales, KPIs y playbooks (comité de gobernanza).
- Roadmap de mejora: ampliar corpus de calibración, acreditar Nivel 4, integrar más repositorios (Zenodo/Figshare)
  y habilitar revisión en doble ciego.
- Las correcciones de revisión (bitácora §7 de `07-playbooks-operativos.md`) se incorporan al ciclo de
  actualización de los anexos legales y técnicos.