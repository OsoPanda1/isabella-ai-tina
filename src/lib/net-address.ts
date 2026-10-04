/**
 * VALIDACIÓN DE DIRECCIONES IP (src/lib/net-address.ts)
 * -----------------------------------------------------
 * Reimplementación pura de `net.isIP` de Node: el módulo `node:net` no existe
 * en el navegador y su import rompía el arranque del cliente. Devuelve 4, 6 o 0
 * con la misma semántica que Node, sin dependencias de runtime.
 */
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIPv6(value: string): boolean {
  if (!value.includes(":")) return false;
  const zoneless = value.split("%")[0] ?? value;
  const parts = zoneless.split("::");
  if (parts.length > 2) return false;
  const expand = (chunk: string): string[] => (chunk === "" ? [] : chunk.split(":"));
  const head = expand(parts[0] ?? "");
  const tail = parts.length === 2 ? expand(parts[1] ?? "") : [];
  const groups = [...head, ...tail];
  // Un grupo final puede ser una dirección IPv4 embebida (::ffff:127.0.0.1).
  const last = groups[groups.length - 1];
  const embedded = last !== undefined && last.includes(".");
  if (embedded && !IPV4.test(last)) return false;
  const hexGroups = embedded ? groups.slice(0, -1) : groups;
  if (hexGroups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  const total = hexGroups.length + (embedded ? 2 : 0);
  return parts.length === 2 ? total <= 8 : total === 8;
}

/** Igual que `net.isIP`: 4 para IPv4, 6 para IPv6, 0 si no es una IP válida. */
export function isIP(value: string): 0 | 4 | 6 {
  if (IPV4.test(value)) return 4;
  if (isIPv6(value)) return 6;
  return 0;
}
