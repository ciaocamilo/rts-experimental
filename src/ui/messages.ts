import type { CommandResult, CommandType, RejectCode } from "../core/types";

/** Texto por cada código de rechazo; el tipo exhaustivo obliga a mantenerlo al día. */
export const REJECT_TEXT: Record<RejectCode, string> = {
  DUPLICATE_SEQUENCE: "orden duplicada",
  NOT_OWNER: "entidad ajena",
  UNKNOWN_ENTITY: "entidad inexistente",
  MATCH_ENDED: "la partida terminó",
  INVALID_TARGET: "destino no válido",
  INCOMPATIBLE_ENTITY: "ninguna entidad compatible con la orden",
  UNREACHABLE: "ruta imposible: el destino no es alcanzable",
  INSUFFICIENT_RESOURCES: "recursos insuficientes",
  POPULATION_LIMIT: "población al límite: construya una casa",
  QUEUE_FULL: "cola de producción llena (máximo 5)",
  INVALID_PLACEMENT: "ubicación no válida: la huella choca con el mapa, un edificio, un recurso o una unidad",
  BLOCKS_PATH: "la obra cerraría el camino entre las bases o encerraría unidades",
  SITE_BUSY: "la obra ya tiene constructor",
  NOT_COMPLETE: "el edificio aún no está terminado",
  NOT_IMPLEMENTED: "orden aún no implementada",
};

const LABEL: Record<CommandType, string> = {
  Move: "Movimiento",
  Stop: "Detener",
  Gather: "Recolección",
  Build: "Construcción",
  ResumeBuild: "Reanudar obra",
  CancelBuild: "Cancelar obra",
  Train: "Entrenamiento",
  CancelTraining: "Cancelar entrenamiento",
  Attack: "Ataque",
};

export function describeResult(result: CommandResult, type: CommandType): string {
  if (!result.accepted) return `Orden rechazada: ${REJECT_TEXT[result.code]}`;
  if (result.assigned === undefined || result.total === undefined) return `${LABEL[type]}: orden aceptada`;
  if (type === "Build") return "Construcción: obra iniciada con 1 constructor";
  if (type === "ResumeBuild") return "Reanudar obra: 1 constructor asignado";
  const missing = result.total - result.assigned;
  return `${LABEL[type]}: ${result.assigned}/${result.total} unidades${missing > 0 ? ` (${missing} sin acceso o no aplicables)` : ""}`;
}
