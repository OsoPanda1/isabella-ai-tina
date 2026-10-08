# 04 — Licenciamiento y Modelos Legales

> **Estado:** Vigente (PLAN) — **Propietario:** Legal — **Revisión:** 2026-10-07
> Plantillas ejecutables en [`09-plantillas-y-artefactos.md`](09-plantillas-y-artefactos.md) (sección "Contratos y cláusulas").

## 1. Licenciamiento por artefacto

| Artefacto | Licencia recomendada | Observaciones |
| --- | --- | --- |
| Código de la plataforma (librerías core) | Apache License 2.0 por defecto; licencia Sovereign para módulos propietarios | Reutilizar matriz `LICENSES.md` y `LICENSE-SOVEREIGN.md` |
| Documentación técnica | CC BY 4.0 | Alineado con `legal/LICENSES/DOCS/README.md` |
| Contenido de usuarios (papers, datasets) | El autor elige; la plataforma solo lo licencia para procesar | DUA obligatorio para datasets |
| Modelos de ML nativos y pesos | Términos específicos por modelo; opcional CC BY-NC en pesos | Gouvernance de modelos (`docs/ml/DRIFT.md`) |
| Sellos/certificados | Bien inmaterial propio; emisión regida por términos de servicio | Uso registrado y verificable |
| Datos curados por la plataforma | CC0 o CC BY según fuente | Atribución requerida |

## 2. Términos de servicio (acuerdo de uso, TOS)

1. **Uso del API:** tokens por cliente, límites de concurrencia, licencia no exclusiva revocable.
2. **Contenido:** el usuario garantiza que posee los derechos o cuenta con permisos; la plataforma
   no adquiere titularidad de contenidos de usuario (licencia limitada para el procesamiento).
3. **Prohibiciones:** extracción masiva no autorizada, evasión de controles de acceso, uso del sistema
   para desinformación o fraude académico.
4. **Garantías y limitación:** resultados de verificación son "mejores esfuerzos"; no conceder como certeza.
5. **Terminación:** suspensión por violaciones; datos del usuario exportables/eliminables bajo DPA.

## 3. Acuerdo de procesamiento de datos (DPA)

Elementos: roles procesadores/encargados, finalidad de tratamiento, categorías de datos, subencargados
permitidos, medidas de seguridad, derechos del interesado, notificación de brecha (≤ 72 h GDPR),
transferencias internacionales estandarizadas (SCC/IDPF), duración y supresión al término.
Compatibilizar con `legal/DPA.md` y `legal/PRIVACY-NOTICE.md`.

## 4. Acuerdo de uso/cesión de datos (DUA)

Para datasets con datos personales o sensibles: finalidades permitidas, prohibición de re-identificación,
sub-cesión prohibida, salvaguardas (cifrado, segregación), obligación de notificación, responsabilidad
por abuso, término y destino de los datos al fin.

## 5. Contrato de revisores (Acuerdo de Revisión)

- Confidencialidad de manuscritos y revisión.
- Ausencia de COI declarada y verificada.
- Independencia, objetividad y plazos.
- No uso del contenido para fines propios sin permiso.
- Protección de datos personales (solo finalidad de revisión).

## 6. Acuerdos con proveedores (plagio, verificación, hosting)

- SLA con métricas definidas (disponibilidad, P95).
- Tratamiento de datos según DPA del proveedor.
- Derecho de auditoría y logs de calidad.
- Cláusula de incidentes de seguridad y notificación.
- Terminación sin penalización ante incumplimiento de integridad o privacidad.

## 7. Política de propiedad intelectual y marcas

- Marca "Librerías Isabella / Isabella Veracidad" protegida; uso solo con licencia de marca.
- Reutilizar `LICENSE-CONTROL.md`, `legal/LICENSES/MARKS/TRADEMARK-POLICY.md` y `TRADEMARK POLICY`.
- En caso de disputa de derechos sobre contenido, procedimiento de DC (DMCA) y baja consultiva.

## 8. Matriz de riesgos legales y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
| --- | --- | --- | --- |
| Reclamación por sello erróneo (responsabilidad) | Media | Alto | Limitación de responsabilidad, "mejores esfuerzos", seguros E&O |
| Infracción de copyright de revisores/IA | Media | Alto | DUA, cribadores, revisión legal por país |
| Fuga de datos personales | Baja | Alto | Cifrado, tokenización, DPA, notificación 72 h |
| Uso indebido para desinformación | Media | Alto | Playbooks de fraude, auditoría externa, retractación |
| Litigio de propiedad de sellos | Baja | Medio | TOS claros, registro marcas, uso registrado |
| No conformidad regulatoria regional | Media | Alto | Matriz de cumplimiento y revisión legal continua |

Detalle ampliado del mapa de riesgos de proyecto en [`08-hoja-de-ruta-cronograma-y-piloto.md`](08-hoja-de-ruta-cronograma-y-piloto.md).